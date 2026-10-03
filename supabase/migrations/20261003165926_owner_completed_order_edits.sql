begin;
set local lock_timeout = '5s';

create table public.completed_order_edits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  edited_by uuid not null references public.profiles(id) on delete restrict,
  edited_at timestamptz not null default clock_timestamp(),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  before_values jsonb not null,
  after_values jsonb not null
);
create index completed_order_edits_transaction_idx on public.completed_order_edits(transaction_id, edited_at desc);
alter table public.completed_order_edits enable row level security;
revoke all on public.completed_order_edits from public, anon, authenticated;
grant select on public.completed_order_edits to authenticated;
create policy completed_order_edits_owner_select on public.completed_order_edits
  for select to authenticated using ((select private.is_owner()));
create trigger completed_order_edits_append_only before update or delete on public.completed_order_edits
  for each row execute function private.prevent_loyalty_ledger_mutation();

create or replace function private.prevent_terminal_transaction_edit()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  lifecycle_columns text[] := array['order_status','updated_at','updated_by','deleted_at','deleted_by','delete_reason','sms_sent_at','sms_sent_by','sms_message_id'];
begin
  if old.order_status = 'completed'
     and current_setting('aquaspin.completed_order_edit', true) = 'on'
     and auth.uid() is not null and private.is_owner() then
    return new;
  end if;
  if old.order_status in ('completed', 'cancelled') then
    if current_setting('app.customer_reassignment_rpc', true) = 'on' then
      if (to_jsonb(new) - lifecycle_columns - 'customer_id') is distinct from (to_jsonb(old) - lifecycle_columns - 'customer_id') then
        raise exception 'Completed and cancelled orders cannot be edited. Reopen the order first.' using errcode = '42501';
      end if;
    elsif (to_jsonb(new) - lifecycle_columns) is distinct from (to_jsonb(old) - lifecycle_columns) then
      raise exception 'Completed and cancelled orders cannot be edited. Reopen the order first.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_terminal_transaction_edit() from public, anon, authenticated;

-- Definer access is limited to the private implementation: it must append to
-- immutable audit/loyalty tables unavailable for direct client writes.
create function private.edit_completed_order(
  p_transaction_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_reason text
) returns public.transactions
language plpgsql security definer set search_path = ''
as $$
declare
  original public.transactions%rowtype;
  proposed public.transactions%rowtype;
  saved public.transactions%rowtype;
  prior_flag text := current_setting('aquaspin.completed_order_edit', true);
  earned public.loyalty_point_events%rowtype;
  total_kg numeric;
  current_points numeric;
  points_delta numeric;
  balance numeric;
  allowed text[] := array['customer_name','phone_number','transaction_date','service_id','kg','no_of_loads','base_amount','add_ons','add_on_items','total_amount','cash_amount','gcash_amount','gcash_reference','payment_method','pickup_date','pickup_time','notes'];
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an active Owner can edit completed orders' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception 'An edit reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Order changes must be an object' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_changes) k where not k = any(allowed)) then
    raise exception 'Unsupported order fields' using errcode = '22023';
  end if;
  select * into original from public.transactions where id = p_transaction_id for update;
  if not found or original.deleted_at is not null or original.order_status <> 'completed' then
    raise exception 'Only completed, non-deleted orders can use this edit option' using errcode = '42501';
  end if;
  if original.updated_at is distinct from p_expected_updated_at then
    raise exception 'This order changed in another session. Refresh and try again.' using errcode = '40001';
  end if;
  select * into proposed from jsonb_populate_record(original, p_changes);
  if nullif(btrim(proposed.customer_name), '') is null then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if proposed.payment_method = 'pay_later' then
    raise exception 'A completed order must remain paid' using errcode = '22023';
  end if;
  if (to_jsonb(proposed) - array['updated_at','updated_by']) = (to_jsonb(original) - array['updated_at','updated_by']) then
    raise exception 'Make a change before saving' using errcode = '22023';
  end if;

  perform set_config('aquaspin.completed_order_edit', 'on', true);
  update public.transactions set
    customer_name = proposed.customer_name,
    phone_number = proposed.phone_number,
    transaction_date = proposed.transaction_date,
    service_id = proposed.service_id,
    kg = proposed.kg,
    no_of_loads = proposed.no_of_loads,
    base_amount = proposed.base_amount,
    add_ons = proposed.add_ons,
    add_on_items = proposed.add_on_items,
    total_amount = proposed.total_amount,
    cash_amount = proposed.cash_amount,
    gcash_amount = proposed.gcash_amount,
    gcash_reference = proposed.gcash_reference,
    payment_method = proposed.payment_method,
    pickup_date = proposed.pickup_date,
    pickup_time = proposed.pickup_time,
    notes = proposed.notes
  where id = p_transaction_id returning * into saved;
  perform set_config('aquaspin.completed_order_edit', coalesce(prior_flag, ''), true);

  -- Weight corrections use the original award rate, including when the
  -- transaction has previously been moved to a different customer.
  if original.kg is distinct from saved.kg and saved.customer_id is not null then
    perform id from public.customers where id = saved.customer_id for update;
    select * into earned from public.loyalty_point_events
      where transaction_id = saved.id and event_type = 'earned' for update;
    if found then
      select coalesce(saved.kg,0) + coalesce(sum(kg),0) into total_kg
        from public.transaction_service_items where transaction_id = saved.id;
      select coalesce(sum(points_earned),0) into current_points from public.loyalty_point_events
        where transaction_id = saved.id and customer_id = saved.customer_id;
      points_delta := round(total_kg * earned.points_earned / earned.kg, 6) - current_points;
      select coalesce(points_balance,0) into balance from public.customer_loyalty_balance where customer_id = saved.customer_id;
      if coalesce(balance,0) + points_delta < 0 then
        raise exception 'This weight correction would remove points already redeemed' using errcode = '22023';
      end if;
      if points_delta <> 0 then
        insert into public.loyalty_point_events(customer_id,transaction_id,kg,points_earned,event_type)
        values(saved.customer_id,saved.id,greatest(total_kg,earned.kg),points_delta,'correction');
      end if;
    end if;
  end if;
  insert into public.completed_order_edits(transaction_id,edited_by,reason,before_values,after_values)
    values(saved.id,auth.uid(),btrim(p_reason),to_jsonb(original),to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function private.edit_completed_order(uuid,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function private.edit_completed_order(uuid,timestamptz,jsonb,text) to authenticated;

create function public.edit_completed_order(
  p_transaction_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_reason text
) returns public.transactions language sql security invoker set search_path = ''
as $$ select * from private.edit_completed_order(p_transaction_id,p_expected_updated_at,p_changes,p_reason); $$;
revoke all on function public.edit_completed_order(uuid,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function public.edit_completed_order(uuid,timestamptz,jsonb,text) to authenticated;
-- Transfer corrected earned points when an edited order is later reassigned.
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
  v_transfer_points numeric;
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

  select coalesce(sum(points_earned), 0) into v_transfer_points
    from public.loyalty_point_events
    where transaction_id = v_transaction.id and customer_id = v_transaction.customer_id;

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

  if v_earned_event.id is not null and v_transfer_points <> 0 then
    insert into public.loyalty_point_events (
      customer_id, transaction_id, kg, points_earned, event_type
    ) values
      (v_transaction.customer_id, v_transaction.id, v_earned_event.kg, -v_transfer_points, 'correction'),
      (p_new_customer_id, v_transaction.id, v_earned_event.kg, v_transfer_points, 'correction');
  end if;

  return v_correction;
end;
$$;

revoke all on function public.reassign_transaction_customer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reassign_transaction_customer(uuid, uuid, text) to authenticated;

commit;
