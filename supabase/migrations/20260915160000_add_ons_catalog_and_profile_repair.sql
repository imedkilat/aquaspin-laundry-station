-- Add-ons catalog + transaction add-on snapshots + missing profile repair

-- Repair any Auth users that exist without an application profile.
-- This is safe to re-run and preserves existing owner/staff roles.
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email, 'Staff'),
  'staff'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Owner-managed add-on catalog. Historical transactions store snapshots, so
-- later catalog price/name changes do not rewrite old transaction history.
create table if not exists public.add_ons_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  unit_type text not null default 'piece'
    check (unit_type in ('piece', 'load', 'sachet', 'dose', 'cycle', 'kg', 'flat')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists add_ons_catalog_name_unique_idx
  on public.add_ons_catalog (lower(name));

alter table public.add_ons_catalog enable row level security;

grant select, insert, update, delete on table public.add_ons_catalog to authenticated;

drop policy if exists "add_ons_select_all" on public.add_ons_catalog;
create policy "add_ons_select_all"
  on public.add_ons_catalog
  for select
  to authenticated
  using (true);

drop policy if exists "add_ons_write_owner_only" on public.add_ons_catalog;
create policy "add_ons_write_owner_only"
  on public.add_ons_catalog
  for all
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

drop trigger if exists add_ons_catalog_set_updated_at on public.add_ons_catalog;
create trigger add_ons_catalog_set_updated_at
  before update on public.add_ons_catalog
  for each row execute function public.set_updated_at();

-- Snapshot selected add-ons with each transaction.
alter table public.transactions
  add column if not exists add_on_items jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_add_on_items_array_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_add_on_items_array_check
      check (jsonb_typeof(add_on_items) = 'array');
  end if;
end
$$;

-- Realtime keeps open staff forms synchronized when the owner changes the
-- add-on catalog or prices.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'add_ons_catalog'
  ) then
    alter publication supabase_realtime add table public.add_ons_catalog;
  end if;
end
$$;
