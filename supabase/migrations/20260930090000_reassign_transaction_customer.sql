-- Allow an Owner to correct a transaction's customer link without rewriting
-- its historical loyalty event. The correction is represented by two signed,
-- append-only ledger events and an immutable audit record.
begin;
set local lock_timeout = '5s';

alter table public.loyalty_point_events
  add column event_type text default 'earned';

alter table public.loyalty_point_events
  drop constraint loyalty_point_events_transaction_key,
  drop constraint loyalty_point_events_points_earned_check,
  add constraint loyalty_point_events_event_type_check
    check (event_type is null or event_type in ('earned', 'correction')),
  add constraint loyalty_point_events_points_sign_check
    check (
      (coalesce(event_type, 'earned') = 'earned' and points_earned > 0)
      or (event_type = 'correction' and points_earned <> 0)
    );

create unique index loyalty_point_events_one_earned_per_transaction_idx
  on public.loyalty_point_events (transaction_id)
  where event_type = 'earned';

create table public.transaction_customer_corrections (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  old_customer_id uuid not null references public.customers(id) on delete restrict,
  new_customer_id uuid not null references public.customers(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  corrected_at timestamptz not null default clock_timestamp(),
  constraint transaction_customer_corrections_distinct_customers_check
    check (old_customer_id <> new_customer_id)
);

create index transaction_customer_corrections_transaction_idx
  on public.transaction_customer_corrections (transaction_id, corrected_at desc);

alter table public.transaction_customer_corrections enable row level security;
revoke all on table public.transaction_customer_corrections from public, anon, authenticated;
grant select on table public.transaction_customer_corrections to authenticated;
create policy transaction_customer_corrections_owner_select
  on public.transaction_customer_corrections
  for select to authenticated
  using ((select private.is_owner()));

create trigger transaction_customer_corrections_append_only
  before update or delete on public.transaction_customer_corrections
  for each row execute function private.prevent_loyalty_ledger_mutation();

-- Preserve multi-service weight accounting while changing the conflict target
-- from one event of any kind to exactly one earned event per transaction.
create or replace function private.award_loyalty_points_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points_per_kg numeric;
  v_service_items_kg numeric;
  v_total_kg numeric;
begin
  if old.order_status is distinct from new.order_status
    and new.order_status = 'completed'
    and new.customer_id is not null
    and new.deleted_at is null then
    select coalesce(sum(kg), 0)
      into v_service_items_kg
      from public.transaction_service_items
      where transaction_id = new.id;

    v_total_kg := coalesce(new.kg, 0) + v_service_items_kg;

    if v_total_kg > 0 then
      select points_per_kg
        into v_points_per_kg
        from public.loyalty_settings
        where id = 1;

      if v_points_per_kg is not null then
        insert into public.loyalty_point_events (
          customer_id, transaction_id, kg, points_earned, event_type
        ) values (
          new.customer_id, new.id, v_total_kg, v_total_kg * v_points_per_kg, 'earned'
        )
        on conflict (transaction_id) where event_type = 'earned' do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_terminal_transaction_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lifecycle_columns text[] := array[
    'order_status', 'updated_at', 'updated_by', 'deleted_at', 'deleted_by',
    'delete_reason', 'sms_sent_at', 'sms_sent_by', 'sms_message_id'
  ];
  reassignment_in_progress boolean :=
    current_setting('app.customer_reassignment_rpc', true) = 'on';
begin
  if old.order_status in ('completed', 'cancelled') then
    if reassignment_in_progress then
      if (to_jsonb(new) - lifecycle_columns - 'customer_id')
         is distinct from (to_jsonb(old) - lifecycle_columns - 'customer_id') then
        raise exception 'Completed and cancelled orders cannot be edited. Reopen the order first.'
          using errcode = '42501';
      end if;
    elsif (to_jsonb(new) - lifecycle_columns)
          is distinct from (to_jsonb(old) - lifecycle_columns) then
      raise exception 'Completed and cancelled orders cannot be edited. Reopen the order first.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_terminal_transaction_edit() from public, anon, authenticated;

create or replace function public.reassign_transaction_customer(
  p_transaction_id uuid,
  p_new_customer_id uuid,
  p_reason text
)
returns public.transaction_customer_corrections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.transactions%rowtype;
  v_old_customer_active boolean;
  v_new_customer_active boolean;
  v_previous_reassignment_flag text;
  v_earned_event public.loyalty_point_events%rowtype;
  v_correction public.transaction_customer_corrections%rowtype;
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an active Owner can reassign a transaction customer'
      using errcode = '42501';
  end if;
  if p_transaction_id is null then
    raise exception 'Transaction is required';
  end if;
  if p_new_customer_id is null then
    raise exception 'A new customer is required';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A correction reason is required';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception 'Correction reason must be 500 characters or fewer';
  end if;

  select * into v_transaction
    from public.transactions
    where id = p_transaction_id
    for update;
  if not found then
    raise exception 'Transaction not found';
  end if;
  if v_transaction.customer_id is null then
    raise exception 'Transaction has no current customer to reassign';
  end if;
  if v_transaction.customer_id = p_new_customer_id then
    raise exception 'Choose a different customer';
  end if;

  -- Lock the customer rows in a stable order. This protects the active check
  -- and avoids reverse-order customer locks from crossing reassignment calls.
  perform c.id
    from public.customers c
    where c.id in (v_transaction.customer_id, p_new_customer_id)
    order by c.id
    for update;
  select c.active into v_old_customer_active
    from public.customers c where c.id = v_transaction.customer_id;
  select c.active into v_new_customer_active
    from public.customers c where c.id = p_new_customer_id;
  if v_old_customer_active is null then
    raise exception 'Current customer not found';
  end if;
  if v_new_customer_active is not true then
    raise exception 'The new customer must be active';
  end if;

  select * into v_earned_event
    from public.loyalty_point_events e
    where e.transaction_id = v_transaction.id
      and e.event_type = 'earned'
    for update;

  v_previous_reassignment_flag := current_setting('app.customer_reassignment_rpc', true);
  perform set_config('app.customer_reassignment_rpc', 'on', true);
  update public.transactions
    set customer_id = p_new_customer_id
    where id = v_transaction.id;
  perform set_config('app.customer_reassignment_rpc', coalesce(v_previous_reassignment_flag, ''), true);

  insert into public.transaction_customer_corrections (
    transaction_id, old_customer_id, new_customer_id, reason, corrected_by
  ) values (
    v_transaction.id, v_transaction.customer_id, p_new_customer_id, btrim(p_reason), auth.uid()
  ) returning * into v_correction;

  if v_earned_event.id is not null then
    insert into public.loyalty_point_events (
      customer_id, transaction_id, kg, points_earned, event_type
    ) values
      (v_transaction.customer_id, v_transaction.id, v_earned_event.kg, -v_earned_event.points_earned, 'correction'),
      (p_new_customer_id, v_transaction.id, v_earned_event.kg, v_earned_event.points_earned, 'correction');
  end if;

  return v_correction;
end;
$$;

revoke all on function public.reassign_transaction_customer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reassign_transaction_customer(uuid, uuid, text) to authenticated;

commit;
