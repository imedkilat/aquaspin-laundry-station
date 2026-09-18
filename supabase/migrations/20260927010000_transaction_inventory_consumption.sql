-- Require inventory usage details on new transactions and consume them once on completion.
-- New orders must identify one Liquid Detergent item and one Fabric Conditioner item.
-- Consumption is posted to the append-only inventory ledger when status changes to completed.

alter table public.transactions
  add column if not exists detergent_item_id uuid
    references public.inventory_items(id) on delete restrict,
  add column if not exists detergent_quantity numeric(12,3),
  add column if not exists fabric_conditioner_item_id uuid
    references public.inventory_items(id) on delete restrict,
  add column if not exists fabric_conditioner_quantity numeric(12,3);

alter table public.transactions
  drop constraint if exists transactions_detergent_quantity_check,
  drop constraint if exists transactions_fabric_conditioner_quantity_check,
  add constraint transactions_detergent_quantity_check
    check (detergent_quantity is null or detergent_quantity > 0),
  add constraint transactions_fabric_conditioner_quantity_check
    check (fabric_conditioner_quantity is null or fabric_conditioner_quantity > 0);

create index if not exists transactions_detergent_item_idx
  on public.transactions (detergent_item_id);

create index if not exists transactions_fabric_conditioner_item_idx
  on public.transactions (fabric_conditioner_item_id);

create table if not exists public.transaction_inventory_consumption (
  transaction_id uuid primary key references public.transactions(id) on delete restrict,
  detergent_movement_id uuid not null references public.inventory_stock_movements(id) on delete restrict,
  fabric_conditioner_movement_id uuid not null references public.inventory_stock_movements(id) on delete restrict,
  consumed_at timestamptz not null default clock_timestamp(),
  consumed_by uuid references public.profiles(id)
);

alter table public.transaction_inventory_consumption enable row level security;
revoke all on table public.transaction_inventory_consumption from public, anon, authenticated;
grant select on table public.transaction_inventory_consumption to authenticated;

drop policy if exists transaction_inventory_consumption_owner_select on public.transaction_inventory_consumption;
create policy transaction_inventory_consumption_owner_select
  on public.transaction_inventory_consumption
  for select
  to authenticated
  using ((select private.is_owner()));

create or replace function private.validate_transaction_inventory_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  detergent_category text;
  fabric_conditioner_category text;
begin
  -- Legacy rows are allowed to remain without usage details. Every new
  -- active transaction, and every transaction that supplies one usage field,
  -- must provide both complete selections.
  if tg_op = 'INSERT' and new.deleted_at is null then
    if new.detergent_item_id is null
       or new.detergent_quantity is null
       or new.detergent_quantity <= 0
       or new.fabric_conditioner_item_id is null
       or new.fabric_conditioner_quantity is null
       or new.fabric_conditioner_quantity <= 0 then
      raise exception 'Detergent and fabric conditioner item details are required before saving the transaction'
        using errcode = '23514';
    end if;
  elsif new.detergent_item_id is not null
     or new.detergent_quantity is not null
     or new.fabric_conditioner_item_id is not null
     or new.fabric_conditioner_quantity is not null then
    if new.detergent_item_id is null
       or new.detergent_quantity is null
       or new.detergent_quantity <= 0
       or new.fabric_conditioner_item_id is null
       or new.fabric_conditioner_quantity is null
       or new.fabric_conditioner_quantity <= 0 then
      raise exception 'Detergent and fabric conditioner details must be complete'
        using errcode = '23514';
    end if;
  else
    return new;
  end if;

  if new.detergent_item_id = new.fabric_conditioner_item_id then
    raise exception 'Detergent and fabric conditioner must use different inventory items'
      using errcode = '23514';
  end if;

  select lower(btrim(c.name))
    into detergent_category
  from public.inventory_items i
  join public.inventory_categories c on c.id = i.category_id
  where i.id = new.detergent_item_id
    and i.active
    and c.active;

  if detergent_category is distinct from 'liquid detergent' then
    raise exception 'Selected detergent must belong to the active Liquid Detergent category'
      using errcode = '23514';
  end if;

  select lower(btrim(c.name))
    into fabric_conditioner_category
  from public.inventory_items i
  join public.inventory_categories c on c.id = i.category_id
  where i.id = new.fabric_conditioner_item_id
    and i.active
    and c.active;

  if fabric_conditioner_category is distinct from 'fabric conditioner' then
    raise exception 'Selected fabric conditioner must belong to the active Fabric Conditioner category'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_transaction_inventory_usage() from public, anon, authenticated;

drop trigger if exists transactions_validate_inventory_usage on public.transactions;
create trigger transactions_validate_inventory_usage
  before insert or update of
    detergent_item_id,
    detergent_quantity,
    fabric_conditioner_item_id,
    fabric_conditioner_quantity
  on public.transactions
  for each row execute function private.validate_transaction_inventory_usage();

create or replace function private.consume_transaction_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  detergent_item public.inventory_items%rowtype;
  fabric_conditioner_item public.inventory_items%rowtype;
  detergent_stock numeric(12,3);
  fabric_conditioner_stock numeric(12,3);
  detergent_movement_id uuid;
  fabric_conditioner_movement_id uuid;
begin
  if old.order_status is not distinct from new.order_status
     or new.order_status is distinct from 'completed'
     or new.deleted_at is not null then
    return new;
  end if;

  if exists (
    select 1
    from public.transaction_inventory_consumption
    where transaction_id = new.id
  ) then
    return new;
  end if;

  if new.detergent_item_id is null
     or new.detergent_quantity is null
     or new.fabric_conditioner_item_id is null
     or new.fabric_conditioner_quantity is null then
    raise exception 'Inventory usage details are required before completing the transaction'
      using errcode = '23514';
  end if;

  -- Lock both item rows in a stable UUID order to serialize concurrent
  -- completion attempts without introducing lock-order deadlocks.
  if new.detergent_item_id < new.fabric_conditioner_item_id then
    select * into detergent_item
    from public.inventory_items
    where id = new.detergent_item_id
    for update;

    select * into fabric_conditioner_item
    from public.inventory_items
    where id = new.fabric_conditioner_item_id
    for update;
  else
    select * into fabric_conditioner_item
    from public.inventory_items
    where id = new.fabric_conditioner_item_id
    for update;

    select * into detergent_item
    from public.inventory_items
    where id = new.detergent_item_id
    for update;
  end if;

  if detergent_item.id is null or fabric_conditioner_item.id is null then
    raise exception 'Inventory item no longer exists for this transaction'
      using errcode = '23503';
  end if;

  select coalesce(sum(quantity_delta), 0)
    into detergent_stock
  from public.inventory_stock_movements
  where item_id = detergent_item.id;

  select coalesce(sum(quantity_delta), 0)
    into fabric_conditioner_stock
  from public.inventory_stock_movements
  where item_id = fabric_conditioner_item.id;

  if detergent_stock < new.detergent_quantity then
    raise exception 'Insufficient % stock to complete the transaction. Available: %, required: %',
      detergent_item.item_name, detergent_stock, new.detergent_quantity
      using errcode = '23514';
  end if;

  if fabric_conditioner_stock < new.fabric_conditioner_quantity then
    raise exception 'Insufficient % stock to complete the transaction. Available: %, required: %',
      fabric_conditioner_item.item_name, fabric_conditioner_stock, new.fabric_conditioner_quantity
      using errcode = '23514';
  end if;

  insert into public.inventory_stock_movements (
    item_id, movement_type, quantity_delta, unit_cost, reason, created_by
  )
  values (
    detergent_item.id,
    'consumption',
    -new.detergent_quantity,
    detergent_item.average_cost,
    format('Automatic consumption for %s · detergent', new.transaction_code),
    auth.uid()
  )
  returning id into detergent_movement_id;

  insert into public.inventory_stock_movements (
    item_id, movement_type, quantity_delta, unit_cost, reason, created_by
  )
  values (
    fabric_conditioner_item.id,
    'consumption',
    -new.fabric_conditioner_quantity,
    fabric_conditioner_item.average_cost,
    format('Automatic consumption for %s · fabric conditioner', new.transaction_code),
    auth.uid()
  )
  returning id into fabric_conditioner_movement_id;

  insert into public.transaction_inventory_consumption (
    transaction_id,
    detergent_movement_id,
    fabric_conditioner_movement_id,
    consumed_by
  )
  values (
    new.id,
    detergent_movement_id,
    fabric_conditioner_movement_id,
    auth.uid()
  );

  return new;
end;
$$;

revoke all on function private.consume_transaction_inventory() from public, anon, authenticated;

drop trigger if exists transactions_consume_inventory_on_completion on public.transactions;
create trigger transactions_consume_inventory_on_completion
  after update of order_status on public.transactions
  for each row execute function private.consume_transaction_inventory();
