-- Discounts and promos with timeline scheduling, realtime catalog sync, and transaction snapshots.

create table if not exists public.discounts_promos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'discount'
    check (kind in ('discount', 'promo')),
  discount_type text not null default 'percentage'
    check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  occasion text,
  applies_to text not null default 'all'
    check (applies_to in ('all', 'service', 'add_on')),
  service_id uuid references public.services(id) on delete set null,
  add_on_id uuid references public.add_ons_catalog(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint discounts_promos_date_range_check check (ends_at > starts_at),
  constraint discounts_promos_percentage_cap_check check (
    discount_type <> 'percentage' or discount_value <= 100
  ),
  constraint discounts_promos_scope_check check (
    (applies_to = 'all' and service_id is null and add_on_id is null)
    or (applies_to = 'service' and service_id is not null and add_on_id is null)
    or (applies_to = 'add_on' and service_id is null and add_on_id is not null)
  )
);

create index if not exists discounts_promos_timeline_idx
  on public.discounts_promos (active, starts_at, ends_at);

create index if not exists discounts_promos_service_idx
  on public.discounts_promos (service_id)
  where service_id is not null;

create index if not exists discounts_promos_add_on_idx
  on public.discounts_promos (add_on_id)
  where add_on_id is not null;

alter table public.discounts_promos enable row level security;

revoke all on table public.discounts_promos from public, anon;
grant select, insert, update, delete on table public.discounts_promos to authenticated;

drop policy if exists discounts_promos_select on public.discounts_promos;
create policy discounts_promos_select
  on public.discounts_promos
  for select
  to authenticated
  using ((select private.is_owner()) or active);

drop policy if exists discounts_promos_owner_write on public.discounts_promos;
create policy discounts_promos_owner_write
  on public.discounts_promos
  for all
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

drop trigger if exists discounts_promos_set_updated_at on public.discounts_promos;
create trigger discounts_promos_set_updated_at
  before update on public.discounts_promos
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'discounts_promos'
  ) then
    alter publication supabase_realtime add table public.discounts_promos;
  end if;
end
$$;

alter table public.transactions
  add column if not exists discount_promo_id uuid
    references public.discounts_promos(id) on delete set null,
  add column if not exists discount_promo_name_snapshot text,
  add column if not exists discount_promo_kind_snapshot text,
  add column if not exists discount_type_snapshot text,
  add column if not exists discount_value_snapshot numeric(10,2),
  add column if not exists discount_amount numeric(10,2) not null default 0;

create index if not exists transactions_discount_promo_idx
  on public.transactions (discount_promo_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_discount_amount_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_discount_amount_check
      check (discount_amount >= 0 and discount_amount <= coalesce(base_amount, 0) + coalesce(add_ons, 0));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_discount_snapshot_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_discount_snapshot_check
      check (
        discount_amount = 0
        or (
          nullif(btrim(discount_promo_name_snapshot), '') is not null
          and discount_promo_kind_snapshot in ('discount', 'promo')
          and discount_type_snapshot in ('percentage', 'fixed')
          and discount_value_snapshot > 0
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_discount_percentage_snapshot_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_discount_percentage_snapshot_check
      check (discount_type_snapshot <> 'percentage' or discount_value_snapshot <= 100);
  end if;
end
$$;

create or replace function private.validate_transaction_discount_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  new.discount_amount := coalesce(new.discount_amount, 0);

  if new.discount_amount = 0 then
    new.discount_promo_id := null;
    new.discount_promo_name_snapshot := null;
    new.discount_promo_kind_snapshot := null;
    new.discount_type_snapshot := null;
    new.discount_value_snapshot := null;
    return new;
  end if;

  if new.discount_amount > coalesce(new.base_amount, 0) + coalesce(new.add_ons, 0) then
    raise exception 'Discount cannot exceed the transaction subtotal'
      using errcode = '23514';
  end if;

  if nullif(btrim(new.discount_promo_name_snapshot), '') is null
     or new.discount_promo_kind_snapshot not in ('discount', 'promo')
     or new.discount_type_snapshot not in ('percentage', 'fixed')
     or new.discount_value_snapshot is null
     or new.discount_value_snapshot <= 0 then
    raise exception 'A complete discount or promo snapshot is required'
      using errcode = '23514';
  end if;

  if new.discount_type_snapshot = 'percentage'
     and new.discount_value_snapshot > 100 then
    raise exception 'Percentage discount cannot exceed 100'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_transaction_discount_snapshot() from public, anon, authenticated;

drop trigger if exists transactions_09_validate_discount_snapshot on public.transactions;
create trigger transactions_09_validate_discount_snapshot
  before insert or update of
    discount_promo_id,
    discount_promo_name_snapshot,
    discount_promo_kind_snapshot,
    discount_type_snapshot,
    discount_value_snapshot,
    discount_amount,
    base_amount,
    add_ons
  on public.transactions
  for each row execute function private.validate_transaction_discount_snapshot();
