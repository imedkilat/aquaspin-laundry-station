-- Phase 3 inventory foundation.
-- Inventory quantity is ledger-derived; authenticated callers cannot directly
-- mutate stock balances or append un-audited movements.

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);

create unique index if not exists inventory_categories_name_unique_idx
  on public.inventory_categories (lower(name));

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null
    check (char_length(btrim(item_name)) between 1 and 120),
  category_id uuid references public.inventory_categories(id) on delete set null,
  unit_label text not null
    check (unit_label in ('pcs', 'ml', 'L', 'g', 'kg')),
  reorder_threshold numeric(12,3) not null default 0
    check (reorder_threshold >= 0),
  average_cost numeric(12,2) not null default 0
    check (average_cost >= 0),
  active boolean not null default true,
  notes text
    check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);

create index if not exists inventory_items_category_idx
  on public.inventory_items (category_id);

create index if not exists inventory_items_active_name_idx
  on public.inventory_items (active, item_name);

create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null
    check (movement_type in ('stock_in', 'adjustment', 'consumption', 'wastage', 'correction')),
  quantity_delta numeric(12,3) not null
    check (quantity_delta <> 0),
  unit_cost numeric(12,2)
    check (unit_cost is null or unit_cost >= 0),
  reason text not null
    check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists inventory_stock_movements_item_date_idx
  on public.inventory_stock_movements (item_id, created_at desc);

create or replace function public.set_inventory_updated_by()
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

revoke all on function public.set_inventory_updated_by() from public, anon, authenticated;

drop trigger if exists inventory_categories_set_updated_by on public.inventory_categories;
create trigger inventory_categories_set_updated_by
  before update on public.inventory_categories
  for each row execute function public.set_inventory_updated_by();

drop trigger if exists inventory_items_set_updated_by on public.inventory_items;
create trigger inventory_items_set_updated_by
  before update on public.inventory_items
  for each row execute function public.set_inventory_updated_by();

-- The source of truth for quantity is the append-only movement ledger.
create or replace view public.inventory_item_summary
with (security_invoker = true)
as
select
  i.id,
  i.item_name,
  i.category_id,
  c.name as category_name,
  i.unit_label,
  i.reorder_threshold,
  i.average_cost,
  i.active,
  i.notes,
  i.created_at,
  i.updated_at,
  coalesce(sum(m.quantity_delta), 0)::numeric(12,3) as current_quantity,
  (coalesce(sum(m.quantity_delta), 0) * i.average_cost)::numeric(14,2) as stock_value,
  coalesce(max(m.created_at), i.created_at) as last_movement_at
from public.inventory_items i
left join public.inventory_categories c on c.id = i.category_id
left join public.inventory_stock_movements m on m.item_id = i.id
group by
  i.id, i.item_name, i.category_id, c.name, i.unit_label,
  i.reorder_threshold, i.average_cost, i.active, i.notes,
  i.created_at, i.updated_at;

-- Only the Owner may configure inventory and record manual movements in this
-- first foundation. A later permission slice can delegate controlled actions
-- to Staff without weakening these database boundaries.
alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_stock_movements enable row level security;

revoke all on table public.inventory_categories from anon, authenticated;
revoke all on table public.inventory_items from anon, authenticated;
revoke all on table public.inventory_stock_movements from anon, authenticated;

grant select, insert, update on table public.inventory_categories to authenticated;
grant select, insert, update on table public.inventory_items to authenticated;
grant select on table public.inventory_stock_movements to authenticated;
grant select on public.inventory_item_summary to authenticated;

drop policy if exists inventory_categories_select_authenticated on public.inventory_categories;
create policy inventory_categories_select_authenticated
  on public.inventory_categories
  for select
  to authenticated
  using (true);

drop policy if exists inventory_categories_owner_insert on public.inventory_categories;
create policy inventory_categories_owner_insert
  on public.inventory_categories
  for insert
  to authenticated
  with check ((select private.is_owner()) and created_by = (select auth.uid()));

drop policy if exists inventory_categories_owner_update on public.inventory_categories;
create policy inventory_categories_owner_update
  on public.inventory_categories
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

drop policy if exists inventory_items_select_authenticated on public.inventory_items;
create policy inventory_items_select_authenticated
  on public.inventory_items
  for select
  to authenticated
  using (true);

drop policy if exists inventory_items_owner_insert on public.inventory_items;
create policy inventory_items_owner_insert
  on public.inventory_items
  for insert
  to authenticated
  with check ((select private.is_owner()) and created_by = (select auth.uid()));

drop policy if exists inventory_items_owner_update on public.inventory_items;
create policy inventory_items_owner_update
  on public.inventory_items
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

drop policy if exists inventory_movements_select_authenticated on public.inventory_stock_movements;
create policy inventory_movements_select_authenticated
  on public.inventory_stock_movements
  for select
  to authenticated
  using (true);

create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_reason text,
  p_unit_cost numeric default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  result public.inventory_stock_movements;
  current_quantity numeric(12,3);
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an owner can record inventory movements' using errcode = '42501';
  end if;

  if p_movement_type not in ('stock_in', 'adjustment', 'consumption', 'wastage', 'correction') then
    raise exception 'Invalid inventory movement type';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Inventory movement quantity cannot be zero';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Inventory movement reason is required';
  end if;

  if p_movement_type = 'stock_in' and p_quantity_delta <= 0 then
    raise exception 'Stock in quantity must be positive';
  end if;

  if p_movement_type in ('consumption', 'wastage') and p_quantity_delta >= 0 then
    raise exception 'Consumption and wastage quantities must be negative';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id) then
    raise exception 'Inventory item not found';
  end if;

  select coalesce(sum(quantity_delta), 0)
    into current_quantity
  from public.inventory_stock_movements
  where item_id = p_item_id;

  if p_movement_type in ('consumption', 'wastage')
     and current_quantity + p_quantity_delta < 0 then
    raise exception 'Inventory movement would make stock negative';
  end if;

  insert into public.inventory_stock_movements (
    item_id, movement_type, quantity_delta, unit_cost, reason, created_by
  )
  values (
    p_item_id, p_movement_type, p_quantity_delta, p_unit_cost,
    btrim(p_reason), auth.uid()
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.record_inventory_movement(uuid, text, numeric, text, numeric)
  from public, anon, authenticated;
grant execute on function public.record_inventory_movement(uuid, text, numeric, text, numeric)
  to authenticated;
