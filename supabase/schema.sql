-- Aquaspin Laundry Station — production schema
-- Supabase Auth + Postgres + RLS + Realtime
-- Shop timezone: Asia/Manila

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1. Staff profiles and authorization
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, update on table public.profiles to authenticated;

-- Kept outside the exposed public schema so it cannot become a public RPC.
create or replace function private.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid()) and role = 'owner'
    );
$$;

revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to authenticated;

drop policy if exists "profiles_select_own_or_owner" on public.profiles;
create policy "profiles_select_own_or_owner"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_owner()));

-- Profile role changes are owner-only. Staff cannot promote themselves.
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_owner_only" on public.profiles;
create policy "profiles_update_owner_only"
  on public.profiles
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- New Auth users always start as staff. Authorization never trusts user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email, 'Staff'),
    'staff'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent an accidental lockout by ensuring at least one owner remains.
create or replace function public.prevent_last_owner_demotion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.role = 'owner' and new.role <> 'owner' then
    if (select count(*) from public.profiles where role = 'owner') <= 1 then
      raise exception 'At least one owner account must remain.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_last_owner_demotion() from public, anon, authenticated;

drop trigger if exists profiles_prevent_last_owner_demotion on public.profiles;
create trigger profiles_prevent_last_owner_demotion
  before update of role on public.profiles
  for each row execute function public.prevent_last_owner_demotion();

-- ─────────────────────────────────────────────────────────────
-- 2. Services catalog
-- ─────────────────────────────────────────────────────────────
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  default_rate numeric(10,2) check (default_rate is null or default_rate >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

grant select, insert, update, delete on table public.services to authenticated;

drop policy if exists "services_select_all" on public.services;
create policy "services_select_all"
  on public.services
  for select
  to authenticated
  using (true);

drop policy if exists "services_write_owner_only" on public.services;
create policy "services_write_owner_only"
  on public.services
  for all
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

insert into public.services (code, label, default_rate)
values
  ('WDF', 'Wash-Dry-Fold', 195.00),
  ('SSW', 'Self-Service Wash', 90.00),
  ('SSD', 'Self-Service Dry', 90.00),
  ('CSDB', 'Comforter / Special Item', 220.00)
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. Transactions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_no bigserial unique,
  customer_name text not null,
  phone_number text,
  transaction_date date not null default ((now() at time zone 'Asia/Manila')::date),
  service_id uuid references public.services(id),
  kg numeric(6,2) check (kg is null or kg >= 0),
  no_of_loads integer check (no_of_loads is null or no_of_loads >= 0),
  base_amount numeric(10,2) not null default 0 check (base_amount >= 0),
  add_ons numeric(10,2) not null default 0 check (add_ons >= 0),
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  cash_amount numeric(10,2) not null default 0 check (cash_amount >= 0),
  gcash_amount numeric(10,2) not null default 0 check (gcash_amount >= 0),
  payment_method text not null default 'pay_later'
    check (payment_method in ('paid', 'gcash', 'pay_later')),
  pickup_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_date_idx on public.transactions (transaction_date desc);
create index if not exists transactions_customer_idx on public.transactions (customer_name);
create index if not exists transactions_payment_idx on public.transactions (payment_method);
create index if not exists transactions_created_by_idx on public.transactions (created_by);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

grant select, insert, update, delete on table public.transactions to authenticated;
grant usage, select on sequence public.transactions_transaction_no_seq to authenticated;

drop policy if exists "transactions_select_all_staff" on public.transactions;
create policy "transactions_select_all_staff"
  on public.transactions
  for select
  to authenticated
  using (true);

drop policy if exists "transactions_insert_staff" on public.transactions;
create policy "transactions_insert_staff"
  on public.transactions
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "transactions_update_staff" on public.transactions;
create policy "transactions_update_staff"
  on public.transactions
  for update
  to authenticated
  using (true)
  with check (created_by is not null);

drop policy if exists "transactions_delete_owner_only" on public.transactions;
create policy "transactions_delete_owner_only"
  on public.transactions
  for delete
  to authenticated
  using ((select private.is_owner()));

-- ─────────────────────────────────────────────────────────────
-- 4. Realtime
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end
$$;
