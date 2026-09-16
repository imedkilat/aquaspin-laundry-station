-- Forward-only foundation. No customer identities are inferred at install time.
begin;
set local lock_timeout = '5s';

create function public.normalize_customer_phone(p_phone text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select case
    when digits ~ '^09[0-9]{9}$' then '+63' || substr(digits, 2)
    when digits ~ '^639[0-9]{9}$' then '+' || digits
    else null -- Unknown/invalid formats stay stored in phone_number; never deduped.
  end
  from (select regexp_replace(p_phone, '[[:space:]()+.-]', '', 'g') digits) s;
$$;
revoke all on function public.normalize_customer_phone(text) from public, anon;
grant execute on function public.normalize_customer_phone(text) to authenticated;

alter table public.shop_settings
  add column if not exists staff_can_manage_customers boolean not null default true;

-- Preserve every existing permission and its maintenance semantics.
create or replace function private.has_staff_permission(p_permission text)
returns boolean language plpgsql stable security definer
set search_path = public, private, pg_temp
as $$
declare s public.shop_settings%rowtype;
begin
  if auth.uid() is null then return true; end if;
  if private.is_owner() then return true; end if;
  select * into s from public.shop_settings where id = 1;
  if not found then return false; end if;
  return case p_permission
    when 'create_transactions' then s.staff_can_create_transactions
    when 'access_dashboard' then s.staff_can_access_dashboard
    when 'view_full_history' then s.staff_can_view_full_history
    when 'edit_transactions' then s.staff_can_edit_transactions
    when 'delete_transactions' then s.staff_can_delete_transactions
    when 'view_historical_pay_later' then s.staff_can_view_historical_pay_later
    when 'edit_own_profile' then s.staff_can_edit_own_profile
    when 'manage_customers' then s.staff_can_manage_customers
    else false end;
end;
$$;
revoke all on function private.has_staff_permission(text) from public, anon, authenticated;
grant execute on function private.has_staff_permission(text) to authenticated;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null default ('CUS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))),
  full_name text not null,
  phone_number text,
  normalized_phone text generated always as (public.normalize_customer_phone(phone_number)) stored,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  constraint customers_customer_code_key unique (customer_code),
  constraint customers_customer_code_check check (customer_code ~ '^CUS-[0-9A-F]{16}$'),
  constraint customers_full_name_check check (char_length(btrim(full_name)) between 1 and 120),
  constraint customers_phone_number_check check (char_length(phone_number) <= 64),
  constraint customers_notes_check check (char_length(notes) <= 2000)
);
create index customers_normalized_phone_idx on public.customers (normalized_phone) where normalized_phone is not null;
create index customers_created_by_idx on public.customers (created_by);
create index customers_updated_by_idx on public.customers (updated_by);
alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;
grant select on public.customers to authenticated;
grant insert (full_name, phone_number, notes, active), update (full_name, phone_number, notes, active)
  on public.customers to authenticated;
create policy customers_select on public.customers for select to authenticated
  using (auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid()));
create policy customers_insert on public.customers for insert to authenticated
  with check (auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid())
    and private.has_staff_permission('manage_customers'));
create policy customers_update on public.customers for update to authenticated
  using (auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid())
    and private.has_staff_permission('manage_customers'))
  with check (auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid())
    and private.has_staff_permission('manage_customers'));

create function private.stamp_customer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.customer_code, new.created_at, new.created_by)
       is distinct from (old.id, old.customer_code, old.created_at, old.created_by) then
      raise exception 'Customer identity and creation metadata are immutable' using errcode = '42501';
    end if;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.stamp_customer() from public, anon, authenticated;
create trigger customers_stamp before insert or update on public.customers
  for each row execute function private.stamp_customer();

alter table public.transactions
  add column if not exists customer_id uuid,
  add column if not exists order_status text not null default 'received';
alter table public.transactions add constraint transactions_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict not valid;
alter table public.transactions add constraint transactions_order_status_check
  check (order_status in ('received','washing','drying','ready_for_pickup','completed','on_hold','cancelled')) not valid;
alter table public.transactions validate constraint transactions_customer_id_fkey;
alter table public.transactions validate constraint transactions_order_status_check;
create index transactions_customer_date_idx on public.transactions (customer_id, transaction_date desc, id)
  where customer_id is not null;
create index transactions_active_status_date_idx on public.transactions (order_status, transaction_date desc)
  where deleted_at is null;

-- Column privileges close direct API writes without changing existing edit columns.
-- Do not replace this with a caller-controlled GUC as a security boundary.
revoke update on public.transactions from authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
  from pg_attribute where attrelid = 'public.transactions'::regclass
    and attnum > 0 and not attisdropped and attname <> 'order_status';
  execute 'grant update (' || cols || ') on public.transactions to authenticated';
end;
$$;
revoke update (order_status) on public.transactions from authenticated;

create function private.guard_transaction_customer_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.order_status is distinct from 'received' then
    raise exception 'New orders must start as received' using errcode = '23514';
  end if;
  if new.customer_id is not null and
     (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    if not exists (select 1 from public.customers where id = new.customer_id and active) then
      raise exception 'Link an existing active customer' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_transaction_customer_status() from public, anon, authenticated;
create trigger transactions_01_customer_status before insert or update on public.transactions
  for each row execute function private.guard_transaction_customer_status();

-- Keep the same optimistic concurrency token, but ensure successive updates
-- within one transaction (or a long-running transaction) cannot reuse it.
create function private.advance_transaction_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function private.advance_transaction_updated_at() from public, anon, authenticated;
drop trigger transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function private.advance_transaction_updated_at();

-- Run commercial snapshot / intake checks only when those inputs are supplied.
-- A status-only RPC must not re-price or require missing legacy intake fields.
drop trigger transactions_10_normalize_add_on_snapshot on public.transactions;
create trigger transactions_10_normalize_add_on_snapshot
  before update of add_on_items, add_ons, total_amount, base_amount on public.transactions
  for each row execute function public.normalize_transaction_add_on_snapshot();
create trigger transactions_10_normalize_add_on_snapshot_insert
  before insert on public.transactions for each row execute function public.normalize_transaction_add_on_snapshot();
drop trigger transactions_12_enforce_shop_preferences on public.transactions;
create trigger transactions_12_enforce_shop_preferences
  before update of phone_number, pickup_date, notes, payment_method, base_amount, add_ons,
    total_amount, service_id, kg, no_of_loads, add_on_items, deleted_at on public.transactions
  for each row execute function public.enforce_transaction_shop_preferences();
create trigger transactions_12_enforce_shop_preferences_insert
  before insert on public.transactions for each row execute function public.enforce_transaction_shop_preferences();

create table public.transaction_status_history (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid references public.profiles(id),
  reason text,
  constraint transaction_status_history_previous_check check
    (previous_status in ('received','washing','drying','ready_for_pickup','completed','on_hold','cancelled')),
  constraint transaction_status_history_new_check check
    (new_status in ('received','washing','drying','ready_for_pickup','completed','on_hold','cancelled')),
  constraint transaction_status_history_change_check check (previous_status is distinct from new_status),
  constraint transaction_status_history_reason_check check (char_length(reason) <= 500)
);
create index transaction_status_history_transaction_date_idx
  on public.transaction_status_history (transaction_id, changed_at desc, id);
create index transaction_status_history_changed_by_idx on public.transaction_status_history (changed_by);
create unique index transaction_status_history_initial_idx on public.transaction_status_history (transaction_id)
  where previous_status is null;
alter table public.transaction_status_history enable row level security;
revoke all on public.transaction_status_history from public, anon, authenticated;
grant select on public.transaction_status_history to authenticated;
create policy transaction_status_history_select on public.transaction_status_history for select to authenticated
  using (auth.uid() is not null and exists (select 1 from public.transactions t where t.id = transaction_id));

-- Baseline is the migration-time observation, not a claim about historic work.
insert into public.transaction_status_history (transaction_id, previous_status, new_status, reason)
  select id, null, order_status, 'Legacy baseline; prior operational status unknown'
  from public.transactions;

create function private.record_transaction_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Trigger-only privilege elevation for append-only ledger inserts. No direct
  -- EXECUTE grants. UPDATE authority is restricted to the checked RPC/admin.
  if tg_op = 'INSERT' then
    insert into public.transaction_status_history (transaction_id, new_status, changed_by)
      values (new.id, new.order_status, auth.uid());
  elsif old.order_status is distinct from new.order_status then
    insert into public.transaction_status_history (transaction_id, previous_status, new_status, changed_by, reason)
      values (new.id, old.order_status, new.order_status, auth.uid(),
        nullif(current_setting('aquaspin.status_reason', true), ''));
  end if;
  return new;
end;
$$;
revoke all on function private.record_transaction_status() from public, anon, authenticated;
create trigger transactions_record_status after insert or update of order_status on public.transactions
  for each row execute function private.record_transaction_status();

create function private.reject_status_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Status history is append-only' using errcode = '42501';
end;
$$;
revoke all on function private.reject_status_history_mutation() from public, anon, authenticated;
create trigger transaction_status_history_immutable before update or delete on public.transaction_status_history
  for each row execute function private.reject_status_history_mutation();

create function public.set_transaction_status(
  p_transaction_id uuid, p_status text, p_expected_updated_at timestamptz,
  p_reason text default null, p_override boolean default false
)
returns public.transactions language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions%rowtype;
  normal_next text;
  prior_reason text := current_setting('aquaspin.status_reason', true);
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('received','washing','drying','ready_for_pickup','completed','on_hold','cancelled') then
    raise exception 'Invalid order status' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or p_override is null then
    raise exception 'Expected updated_at and explicit override flag required' using errcode = '22023';
  end if;
  if char_length(p_reason) > 500 then raise exception 'Reason exceeds 500 characters' using errcode = '22023'; end if;
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaction not available' using errcode = '42501'; end if;
  if not private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at)
     or not private.has_staff_permission('edit_transactions') then
    raise exception 'Transaction not available for editing' using errcode = '42501';
  end if;
  if t.deleted_at is not null then raise exception 'Restore transaction before changing status' using errcode = '42501'; end if;
  if t.updated_at is distinct from p_expected_updated_at then
    raise exception 'Transaction changed; reload before retrying' using errcode = '40001';
  end if;
  if t.order_status = p_status then raise exception 'Order already has this status' using errcode = '22023'; end if;
  normal_next := case t.order_status when 'received' then 'washing' when 'washing' then 'drying'
    when 'drying' then 'ready_for_pickup' when 'ready_for_pickup' then 'completed' end;
  if p_override then
    if not private.is_owner() or nullif(btrim(p_reason), '') is null then
      raise exception 'Owner override requires a reason' using errcode = '42501';
    end if;
  else
    if not (coalesce(p_status = normal_next, false)
      or (t.order_status in ('received','washing','drying','ready_for_pickup') and p_status in ('on_hold','cancelled'))
      or (t.order_status = 'on_hold' and p_status in ('received','washing','drying','ready_for_pickup','cancelled'))) then
      raise exception 'Transition requires an owner override' using errcode = '22023';
    end if;
    if (t.order_status = 'on_hold' or p_status in ('on_hold','cancelled')) and nullif(btrim(p_reason), '') is null then
      raise exception 'Hold, resume and cancellation require a reason' using errcode = '22023';
    end if;
  end if;
  perform set_config('aquaspin.status_reason', coalesce(p_reason, ''), true);
  update public.transactions set order_status = p_status where id = t.id returning * into t;
  perform set_config('aquaspin.status_reason', coalesce(prior_reason, ''), true);
  return t;
end;
$$;
revoke all on function public.set_transaction_status(uuid, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.set_transaction_status(uuid, text, timestamptz, text, boolean) to authenticated;

create view public.customer_summary with (security_invoker = true) as
select c.id as customer_id, c.customer_code, count(t.id) as total_transactions,
  coalesce(sum(t.total_amount), 0) as total_amount_spent,
  coalesce(sum(case when t.payment_method = 'pay_later'
    then greatest(t.total_amount - t.cash_amount - t.gcash_amount, 0) else 0 end), 0) as outstanding_pay_later_balance,
  max(t.transaction_date) as last_visit
from public.customers c left join public.transactions t on t.customer_id = c.id and t.deleted_at is null
group by c.id, c.customer_code;
create view public.customer_transaction_history with (security_invoker = true) as
select t.* from public.transactions t join public.customers c on c.id = t.customer_id;
revoke all on public.customer_summary, public.customer_transaction_history from public, anon, authenticated;
grant select on public.customer_summary, public.customer_transaction_history to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers') then
      alter publication supabase_realtime add table public.customers;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transaction_status_history') then
      alter publication supabase_realtime add table public.transaction_status_history;
    end if;
  end if;
  if not has_function_privilege('authenticated', 'private.has_staff_permission(text)', 'EXECUTE') then
    raise exception 'Authenticated permission helper EXECUTE must be preserved';
  end if;
end;
$$;
commit;
