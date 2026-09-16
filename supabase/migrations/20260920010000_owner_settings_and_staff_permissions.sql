-- Owner-configurable shop preferences and staff-operation permissions.
-- Security-sensitive controls are enforced in Postgres so hiding a UI control
-- is never the only boundary.

create table if not exists public.shop_settings (
  id smallint primary key default 1 check (id = 1),
  shop_display_name text not null default 'Aquaspin Laundry Station'
    check (char_length(shop_display_name) between 1 and 120),
  contact_phone text
    check (contact_phone is null or char_length(contact_phone) <= 64),
  report_footer text
    check (report_footer is null or char_length(report_footer) <= 300),
  default_payment_method text not null default 'pay_later'
    check (default_payment_method in ('paid', 'gcash', 'pay_later')),
  default_dashboard_days integer not null default 7
    check (default_dashboard_days between 1 and 365),
  require_phone_number boolean not null default false,
  require_pickup_date boolean not null default false,
  require_notes_for_pay_later boolean not null default false,
  allow_manual_total_override boolean not null default true,
  staff_can_create_transactions boolean not null default true,
  staff_can_access_dashboard boolean not null default true,
  staff_can_view_full_history boolean not null default true,
  staff_can_edit_transactions boolean not null default true,
  staff_can_delete_transactions boolean not null default true,
  staff_can_view_historical_pay_later boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.shop_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.shop_settings enable row level security;

revoke all on table public.shop_settings from anon;
revoke all on table public.shop_settings from authenticated;
grant select, update on table public.shop_settings to authenticated;

drop policy if exists shop_settings_select_authenticated on public.shop_settings;
create policy shop_settings_select_authenticated
  on public.shop_settings
  for select
  to authenticated
  using (true);

drop policy if exists shop_settings_update_owner_only on public.shop_settings;
create policy shop_settings_update_owner_only
  on public.shop_settings
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create or replace function public.set_shop_settings_updated_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.set_shop_settings_updated_by() from public, anon, authenticated;

drop trigger if exists shop_settings_set_updated_by on public.shop_settings;
create trigger shop_settings_set_updated_by
  before update on public.shop_settings
  for each row execute function public.set_shop_settings_updated_by();

-- Read one of the deliberately delegable staff permissions. Owners and
-- service-role maintenance always pass. Unknown permission names fail closed.
create or replace function private.has_staff_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  s public.shop_settings%rowtype;
begin
  if auth.uid() is null then
    return true;
  end if;

  if private.is_owner() then
    return true;
  end if;

  select * into s from public.shop_settings where id = 1;
  if not found then
    return false;
  end if;

  return case p_permission
    when 'create_transactions' then s.staff_can_create_transactions
    when 'access_dashboard' then s.staff_can_access_dashboard
    when 'view_full_history' then s.staff_can_view_full_history
    when 'edit_transactions' then s.staff_can_edit_transactions
    when 'delete_transactions' then s.staff_can_delete_transactions
    when 'view_historical_pay_later' then s.staff_can_view_historical_pay_later
    else false
  end;
end;
$$;

revoke all on function private.has_staff_permission(text) from public, anon, authenticated;
grant execute on function private.has_staff_permission(text) to authenticated;

-- Staff always retain access to today's active operational rows. Historical
-- access only exists when the Owner enables Dashboard + Full History. Pay
-- Later history has its own additional switch. Soft-deleted rows stay Owner-only.
create or replace function private.can_view_transaction(
  p_transaction_date date,
  p_payment_method text,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or private.is_owner() then
    return true;
  end if;

  if p_deleted_at is not null then
    return false;
  end if;

  if p_transaction_date = (now() at time zone 'Asia/Manila')::date then
    return true;
  end if;

  if not private.has_staff_permission('access_dashboard')
     or not private.has_staff_permission('view_full_history') then
    return false;
  end if;

  if p_payment_method = 'pay_later'
     and not private.has_staff_permission('view_historical_pay_later') then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.can_view_transaction(date, text, timestamptz) from public, anon, authenticated;
grant execute on function private.can_view_transaction(date, text, timestamptz) to authenticated;

-- Replace broad transaction policies with settings-aware policies.
drop policy if exists transactions_select_all_staff on public.transactions;
drop policy if exists transactions_select_scoped on public.transactions;
create policy transactions_select_scoped
  on public.transactions
  for select
  to authenticated
  using (private.can_view_transaction(transaction_date, payment_method, deleted_at));

drop policy if exists transactions_insert_staff on public.transactions;
create policy transactions_insert_staff
  on public.transactions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_staff_permission('create_transactions')
  );

drop policy if exists transactions_update_staff on public.transactions;
create policy transactions_update_staff
  on public.transactions
  for update
  to authenticated
  using (
    private.is_owner()
    or private.has_staff_permission('edit_transactions')
    or private.has_staff_permission('delete_transactions')
  )
  with check (
    created_by is not null
    and (
      private.is_owner()
      or private.has_staff_permission('edit_transactions')
      or private.has_staff_permission('delete_transactions')
    )
  );

-- Distinguish normal edits from soft deletion so each operation can be
-- delegated independently. Restore remains owner-only in the existing audit
-- hardening trigger.
create or replace function public.enforce_transaction_staff_permissions()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or private.is_owner() then
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    if not private.has_staff_permission('delete_transactions') then
      raise exception 'Staff deletion is disabled by the Owner' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Only an owner can restore a deleted transaction' using errcode = '42501';
  end if;

  if not private.has_staff_permission('edit_transactions') then
    raise exception 'Staff transaction editing is disabled by the Owner' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transaction_staff_permissions() from public, anon, authenticated;

drop trigger if exists transactions_05_enforce_staff_permissions on public.transactions;
create trigger transactions_05_enforce_staff_permissions
  before update on public.transactions
  for each row execute function public.enforce_transaction_staff_permissions();

-- Business-preference validation also lives in Postgres so the same rules
-- apply to direct API callers and future mobile clients.
create or replace function public.enforce_transaction_shop_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.shop_settings%rowtype;
  financial_fields_changed boolean;
begin
  select * into s from public.shop_settings where id = 1;
  if not found then
    return new;
  end if;

  -- Deleting/restoring old rows is an audit operation, not a new customer
  -- intake. New requirements must never strand legacy records that predate
  -- phone/pickup/note rules.
  if tg_op = 'UPDATE' and old.deleted_at is distinct from new.deleted_at then
    return new;
  end if;

  if s.require_phone_number
     and nullif(btrim(coalesce(new.phone_number, '')), '') is null then
    raise exception 'Phone number is required by shop settings';
  end if;

  if s.require_pickup_date and new.pickup_date is null then
    raise exception 'Pickup date is required by shop settings';
  end if;

  if s.require_notes_for_pay_later
     and new.payment_method = 'pay_later'
     and nullif(btrim(coalesce(new.notes, '')), '') is null then
    raise exception 'Notes are required for Pay Later transactions';
  end if;

  financial_fields_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    financial_fields_changed :=
      new.base_amount is distinct from old.base_amount
      or new.add_ons is distinct from old.add_ons
      or new.total_amount is distinct from old.total_amount
      or new.service_id is distinct from old.service_id
      or new.kg is distinct from old.kg
      or new.no_of_loads is distinct from old.no_of_loads
      or new.add_on_items is distinct from old.add_on_items;
  end if;

  -- Old transactions that historically used a manual adjustment remain
  -- editable for non-financial corrections. Once financial fields change,
  -- strict mode requires Total = Base + Add-ons.
  if not s.allow_manual_total_override
     and financial_fields_changed
     and abs(coalesce(new.total_amount, 0) - (coalesce(new.base_amount, 0) + coalesce(new.add_ons, 0))) > 0.005 then
    raise exception 'Manual Total override is disabled by shop settings';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transaction_shop_preferences() from public, anon, authenticated;

drop trigger if exists transactions_12_enforce_shop_preferences on public.transactions;
create trigger transactions_12_enforce_shop_preferences
  before insert or update on public.transactions
  for each row execute function public.enforce_transaction_shop_preferences();

-- Live preference changes propagate to every open browser safely.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shop_settings'
  ) then
    alter publication supabase_realtime add table public.shop_settings;
  end if;
end
$$;
