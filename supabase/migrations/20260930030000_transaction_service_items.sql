-- "Add New Service" — repeatable additional service line items on one order.
--
-- Customers sometimes avail two services in one visit (e.g. Wash-Dry-Fold plus
-- Comforter/Special Item). Previously staff had to create a second, separate
-- transaction. This migration lets staff attach any number of *additional*
-- service lines to a single transaction, each with its own service, kg/loads,
-- add-ons, and (optionally, per Eddy's decision) its own inventory usage --
-- while the order stays one transaction: one payment, one receipt, one status
-- lifecycle, one loyalty award.
--
-- Design, and why:
--  * The existing `transactions` row keeps meaning exactly what it means
--    today: the PRIMARY service's own service/kg/no_of_loads/base_amount/
--    add_ons/add_on_items/detergent+fabric-conditioner usage. Zero columns
--    are repurposed, so every existing single-service transaction, trigger,
--    report, and test keeps working unmodified.
--  * `transactions.total_amount` becomes the true grand total for the whole
--    order (primary subtotal, after any discount, PLUS every additional
--    line's own subtotal). It already flows through the existing
--    `normalize_transaction_add_on_snapshot` "manual_adjustment" mechanism,
--    so total_amount = base_amount + add_ons + manual_adjustment, where
--    manual_adjustment = (additional lines' total) - discount_amount. That
--    trigger needs no changes.
--  * `enforce_transaction_shop_preferences`'s "Total must equal Base +
--    Add-ons unless manual override is allowed" check DOES need a small,
--    additive patch: it now also allows for the additional lines' total, so
--    a multi-service order does not get mistaken for an unauthorized manual
--    total edit. With zero line items the check is byte-for-byte identical
--    to today.
--  * Per-service inventory consumption is optional per line (a line can
--    leave its detergent/fabric-conditioner blank to mean "used the same
--    wash as the primary service"), consumed by extending the existing
--    order_status-driven consumption trigger rather than adding a second,
--    independent one.
--  * "Total kg processed" (Home/Reports) is fixed to include line items'
--    weight in the two application files that compute it, not in the
--    database, since transactions.kg intentionally keeps its existing,
--    primary-only meaning (nothing else depends on it being a rollup).
begin;
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────
-- 1. transaction_service_items
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transaction_service_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  position integer not null default 1 check (position > 0),
  service_id uuid not null references public.services(id),
  service_code_snapshot text,
  service_label_snapshot text,
  kg numeric(6,2) check (kg is null or kg >= 0),
  no_of_loads integer check (no_of_loads is null or no_of_loads >= 0),
  base_amount numeric(10,2) not null default 0 check (base_amount >= 0),
  add_ons numeric(10,2) not null default 0 check (add_ons >= 0),
  add_on_items jsonb not null default '[]'::jsonb,
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  -- Per-line inventory usage is optional (unlike the primary service, which
  -- requires a choice). Null on both means "shares the primary service's
  -- detergent/fabric conditioner" — no separate consumption for this line.
  detergent_source text check (detergent_source is null or detergent_source in ('inventory', 'customer_supplied')),
  detergent_item_id uuid references public.inventory_items(id) on delete restrict,
  detergent_quantity numeric(12,3) check (detergent_quantity is null or detergent_quantity > 0),
  detergent_other_reason text check (detergent_other_reason is null or char_length(detergent_other_reason) <= 500),
  fabric_conditioner_source text check (fabric_conditioner_source is null or fabric_conditioner_source in ('inventory', 'customer_supplied')),
  fabric_conditioner_item_id uuid references public.inventory_items(id) on delete restrict,
  fabric_conditioner_quantity numeric(12,3) check (fabric_conditioner_quantity is null or fabric_conditioner_quantity > 0),
  fabric_conditioner_other_reason text check (fabric_conditioner_other_reason is null or char_length(fabric_conditioner_other_reason) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references public.profiles(id),
  constraint transaction_service_items_add_on_items_array_check
    check (jsonb_typeof(add_on_items) = 'array')
);

create index if not exists transaction_service_items_transaction_idx
  on public.transaction_service_items (transaction_id, position);
create index if not exists transaction_service_items_service_idx
  on public.transaction_service_items (service_id);
create index if not exists transaction_service_items_detergent_item_idx
  on public.transaction_service_items (detergent_item_id);
create index if not exists transaction_service_items_fabric_conditioner_item_idx
  on public.transaction_service_items (fabric_conditioner_item_id);

alter table public.transaction_service_items enable row level security;
revoke all on table public.transaction_service_items from public, anon, authenticated;
grant select, insert, update, delete on table public.transaction_service_items to authenticated;

drop policy if exists transaction_service_items_select on public.transaction_service_items;
create policy transaction_service_items_select
  on public.transaction_service_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_service_items.transaction_id
        and private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at)
    )
  );

-- Writes are only ever performed by save_transaction_service_items() below
-- (security invoker — it runs as the calling user, so these policies are the
-- real gate). Direct client writes outside that RPC still have to satisfy
-- the same permission + order-status rules the RPC itself enforces more
-- precisely, so this is defense in depth, not the primary control.
drop policy if exists transaction_service_items_insert on public.transaction_service_items;
create policy transaction_service_items_insert
  on public.transaction_service_items
  for insert
  to authenticated
  with check (
    (private.has_staff_permission('create_transactions') or private.has_staff_permission('edit_transactions'))
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_service_items.transaction_id
        and t.deleted_at is null
        and t.order_status not in ('completed', 'cancelled')
    )
  );

drop policy if exists transaction_service_items_delete on public.transaction_service_items;
create policy transaction_service_items_delete
  on public.transaction_service_items
  for delete
  to authenticated
  using (
    private.has_staff_permission('edit_transactions')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_service_items.transaction_id
        and t.deleted_at is null
        and t.order_status not in ('completed', 'cancelled')
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transaction_service_items'
  ) then
    alter publication supabase_realtime add table public.transaction_service_items;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Snapshot the service identity, exactly like the parent transaction.
-- ─────────────────────────────────────────────────────────────
create or replace function private.populate_transaction_service_item_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  service_row public.services%rowtype;
begin
  select * into service_row from public.services where id = new.service_id;
  if not found then
    raise exception 'Selected service does not exist' using errcode = '23503';
  end if;

  new.service_code_snapshot := service_row.code;
  new.service_label_snapshot := service_row.label;
  return new;
end;
$$;

revoke all on function private.populate_transaction_service_item_snapshot() from public, anon, authenticated;

drop trigger if exists transaction_service_items_05_populate_snapshot on public.transaction_service_items;
create trigger transaction_service_items_05_populate_snapshot
  before insert on public.transaction_service_items
  for each row execute function private.populate_transaction_service_item_snapshot();

-- ─────────────────────────────────────────────────────────────
-- 3. Normalize each line's add-on snapshot the same way the parent does
--    (current catalog price/name/unit at save time — lines are always
--    replaced wholesale by the RPC below, never edited in place, so there is
--    no prior snapshot on this row to preserve).
-- ─────────────────────────────────────────────────────────────
create or replace function private.normalize_transaction_service_item_add_ons()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  add_on_uuid uuid;
  item_quantity numeric;
  item_name text;
  item_unit text;
  item_price numeric(10,2);
  item_line_total numeric(10,2);
  normalized_items jsonb := '[]'::jsonb;
  normalized_total numeric(10,2) := 0;
begin
  new.add_on_items := coalesce(new.add_on_items, '[]'::jsonb);
  if jsonb_typeof(new.add_on_items) <> 'array' then
    raise exception 'add_on_items must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(new.add_on_items)
  loop
    begin
      add_on_uuid := nullif(item->>'add_on_id', '')::uuid;
    exception when others then
      raise exception 'Invalid add-on id in service line snapshot';
    end;
    if add_on_uuid is null then
      raise exception 'Each add-on item requires add_on_id';
    end if;

    begin
      item_quantity := (item->>'quantity')::numeric;
    exception when others then
      item_quantity := null;
    end;
    if item_quantity is null or item_quantity <= 0 then
      raise exception 'Each add-on quantity must be greater than zero';
    end if;

    select name, unit_type, price into item_name, item_unit, item_price
    from public.add_ons_catalog where id = add_on_uuid;
    if not found then
      raise exception 'Add-on % does not exist in the catalog', add_on_uuid;
    end if;

    if item_unit = 'flat' then
      item_quantity := 1;
    end if;
    if item_unit = 'sachet' and item_quantity <> trunc(item_quantity) then
      raise exception 'Per sachet quantities must be whole numbers' using errcode = '22023';
    end if;

    item_line_total := round(item_price * item_quantity, 2);
    normalized_total := normalized_total + item_line_total;
    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'add_on_id', add_on_uuid, 'name', item_name, 'unit_type', item_unit,
        'unit_price', item_price, 'quantity', item_quantity, 'line_total', item_line_total
      )
    );
  end loop;

  new.add_on_items := normalized_items;
  new.add_ons := round(normalized_total, 2);
  new.total_amount := round(coalesce(new.base_amount, 0) + new.add_ons, 2);
  return new;
end;
$$;

revoke all on function private.normalize_transaction_service_item_add_ons() from public, anon, authenticated;

drop trigger if exists transaction_service_items_10_normalize_add_ons on public.transaction_service_items;
create trigger transaction_service_items_10_normalize_add_ons
  before insert on public.transaction_service_items
  for each row execute function private.normalize_transaction_service_item_add_ons();

-- ─────────────────────────────────────────────────────────────
-- 4. Optional-per-side inventory usage validation (mirrors the parent's
--    validate_transaction_inventory_usage, minus the "a choice is required"
--    part — leaving both sides null is a valid line here).
-- ─────────────────────────────────────────────────────────────
create or replace function private.validate_transaction_service_item_inventory_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  detergent_category text;
  fabric_conditioner_category text;
begin
  if new.detergent_source = 'inventory' then
    if new.detergent_item_id is null
       or new.detergent_quantity is null
       or new.detergent_quantity <= 0
       or nullif(btrim(new.detergent_other_reason), '') is not null then
      raise exception 'Liquid Detergent inventory item and quantity are required'
        using errcode = '23514';
    end if;
    select lower(btrim(c.name)) into detergent_category
    from public.inventory_items i join public.inventory_categories c on c.id = i.category_id
    where i.id = new.detergent_item_id and i.active and c.active;
    if detergent_category is distinct from 'liquid detergent' then
      raise exception 'Selected detergent must belong to the active Liquid Detergent category'
        using errcode = '23514';
    end if;
  elsif new.detergent_source = 'customer_supplied' then
    if new.detergent_item_id is not null
       or new.detergent_quantity is not null
       or nullif(btrim(new.detergent_other_reason), '') is null then
      raise exception 'A reason is required when the customer supplies the liquid detergent'
        using errcode = '23514';
    end if;
  elsif new.detergent_source is not null then
    raise exception 'Choose an inventory item or Customer-provided for Liquid Detergent'
      using errcode = '23514';
  elsif new.detergent_item_id is not null or new.detergent_quantity is not null
     or nullif(btrim(new.detergent_other_reason), '') is not null then
    raise exception 'Detergent details require a detergent source' using errcode = '23514';
  end if;

  if new.fabric_conditioner_source = 'inventory' then
    if new.fabric_conditioner_item_id is null
       or new.fabric_conditioner_quantity is null
       or new.fabric_conditioner_quantity <= 0
       or nullif(btrim(new.fabric_conditioner_other_reason), '') is not null then
      raise exception 'Fabric Conditioner inventory item and quantity are required'
        using errcode = '23514';
    end if;
    select lower(btrim(c.name)) into fabric_conditioner_category
    from public.inventory_items i join public.inventory_categories c on c.id = i.category_id
    where i.id = new.fabric_conditioner_item_id and i.active and c.active;
    if fabric_conditioner_category is distinct from 'fabric conditioner' then
      raise exception 'Selected fabric conditioner must belong to the active Fabric Conditioner category'
        using errcode = '23514';
    end if;
  elsif new.fabric_conditioner_source = 'customer_supplied' then
    if new.fabric_conditioner_item_id is not null
       or new.fabric_conditioner_quantity is not null
       or nullif(btrim(new.fabric_conditioner_other_reason), '') is null then
      raise exception 'A reason is required when the customer supplies the fabric conditioner'
        using errcode = '23514';
    end if;
  elsif new.fabric_conditioner_source is not null then
    raise exception 'Choose an inventory item or Customer-provided for Fabric Conditioner'
      using errcode = '23514';
  elsif new.fabric_conditioner_item_id is not null or new.fabric_conditioner_quantity is not null
     or nullif(btrim(new.fabric_conditioner_other_reason), '') is not null then
    raise exception 'Fabric conditioner details require a fabric conditioner source' using errcode = '23514';
  end if;

  if new.detergent_source = 'inventory'
     and new.fabric_conditioner_source = 'inventory'
     and new.detergent_item_id = new.fabric_conditioner_item_id then
    raise exception 'Detergent and fabric conditioner must use different inventory items'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_transaction_service_item_inventory_usage() from public, anon, authenticated;

drop trigger if exists transaction_service_items_15_validate_inventory_usage on public.transaction_service_items;
create trigger transaction_service_items_15_validate_inventory_usage
  before insert on public.transaction_service_items
  for each row execute function private.validate_transaction_service_item_inventory_usage();

-- ─────────────────────────────────────────────────────────────
-- 5. Per-line inventory consumption ledger + extend the existing
--    order_status-driven consumption trigger to also consume each
--    inventory-backed line, atomically with the primary service.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transaction_service_item_inventory_consumption (
  service_item_id uuid primary key references public.transaction_service_items(id) on delete restrict,
  detergent_movement_id uuid references public.inventory_stock_movements(id) on delete restrict,
  fabric_conditioner_movement_id uuid references public.inventory_stock_movements(id) on delete restrict,
  consumed_at timestamptz not null default clock_timestamp(),
  consumed_by uuid references public.profiles(id)
);

alter table public.transaction_service_item_inventory_consumption enable row level security;
revoke all on table public.transaction_service_item_inventory_consumption from public, anon, authenticated;
grant select on table public.transaction_service_item_inventory_consumption to authenticated;

drop policy if exists transaction_service_item_inventory_consumption_owner_select
  on public.transaction_service_item_inventory_consumption;
create policy transaction_service_item_inventory_consumption_owner_select
  on public.transaction_service_item_inventory_consumption
  for select
  to authenticated
  using ((select private.is_owner()));

create or replace function private.consume_transaction_service_items_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  line record;
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

  for line in
    select *
    from public.transaction_service_items
    where transaction_id = new.id
    order by position
  loop
    if exists (
      select 1 from public.transaction_service_item_inventory_consumption
      where service_item_id = line.id
    ) then
      continue;
    end if;

    detergent_item := null;
    fabric_conditioner_item := null;
    detergent_movement_id := null;
    fabric_conditioner_movement_id := null;

    if line.detergent_source = 'inventory' and line.fabric_conditioner_source = 'inventory' then
      if line.detergent_item_id < line.fabric_conditioner_item_id then
        select * into detergent_item from public.inventory_items where id = line.detergent_item_id for update;
        select * into fabric_conditioner_item from public.inventory_items where id = line.fabric_conditioner_item_id for update;
      else
        select * into fabric_conditioner_item from public.inventory_items where id = line.fabric_conditioner_item_id for update;
        select * into detergent_item from public.inventory_items where id = line.detergent_item_id for update;
      end if;
    elsif line.detergent_source = 'inventory' then
      select * into detergent_item from public.inventory_items where id = line.detergent_item_id for update;
    elsif line.fabric_conditioner_source = 'inventory' then
      select * into fabric_conditioner_item from public.inventory_items where id = line.fabric_conditioner_item_id for update;
    end if;

    if line.detergent_source = 'inventory' then
      if detergent_item.id is null then
        raise exception 'Liquid Detergent inventory item no longer exists for a service line on this transaction'
          using errcode = '23503';
      end if;
      select coalesce(sum(quantity_delta), 0) into detergent_stock
      from public.inventory_stock_movements where item_id = detergent_item.id;
      if detergent_stock < line.detergent_quantity then
        raise exception 'Insufficient % stock to complete the transaction. Available: %, required: %',
          detergent_item.item_name, detergent_stock, line.detergent_quantity
          using errcode = '23514';
      end if;
    end if;

    if line.fabric_conditioner_source = 'inventory' then
      if fabric_conditioner_item.id is null then
        raise exception 'Fabric Conditioner inventory item no longer exists for a service line on this transaction'
          using errcode = '23503';
      end if;
      select coalesce(sum(quantity_delta), 0) into fabric_conditioner_stock
      from public.inventory_stock_movements where item_id = fabric_conditioner_item.id;
      if fabric_conditioner_stock < line.fabric_conditioner_quantity then
        raise exception 'Insufficient % stock to complete the transaction. Available: %, required: %',
          fabric_conditioner_item.item_name, fabric_conditioner_stock, line.fabric_conditioner_quantity
          using errcode = '23514';
      end if;
    end if;

    if line.detergent_source = 'inventory' then
      insert into public.inventory_stock_movements (item_id, movement_type, quantity_delta, unit_cost, reason, created_by)
      values (detergent_item.id, 'consumption', -line.detergent_quantity, detergent_item.average_cost,
        format('Automatic consumption for %s · %s · detergent', new.transaction_code, line.service_label_snapshot), auth.uid())
      returning id into detergent_movement_id;
    end if;

    if line.fabric_conditioner_source = 'inventory' then
      insert into public.inventory_stock_movements (item_id, movement_type, quantity_delta, unit_cost, reason, created_by)
      values (fabric_conditioner_item.id, 'consumption', -line.fabric_conditioner_quantity, fabric_conditioner_item.average_cost,
        format('Automatic consumption for %s · %s · fabric conditioner', new.transaction_code, line.service_label_snapshot), auth.uid())
      returning id into fabric_conditioner_movement_id;
    end if;

    if detergent_movement_id is not null or fabric_conditioner_movement_id is not null then
      insert into public.transaction_service_item_inventory_consumption (
        service_item_id, detergent_movement_id, fabric_conditioner_movement_id, consumed_by
      ) values (line.id, detergent_movement_id, fabric_conditioner_movement_id, auth.uid());
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.consume_transaction_service_items_inventory() from public, anon, authenticated;

drop trigger if exists transactions_consume_service_items_inventory_on_completion on public.transactions;
create trigger transactions_consume_service_items_inventory_on_completion
  after update of order_status on public.transactions
  for each row execute function private.consume_transaction_service_items_inventory();

-- ─────────────────────────────────────────────────────────────
-- 6. Loyalty points already read transactions.kg directly and need no
--    change (kg keeps its primary-only meaning; see the note above). The
--    "Total must equal Base + Add-ons" preference check DOES need to allow
--    for additional lines' total, or every multi-service order would be
--    rejected as an unauthorized manual total override.
-- ─────────────────────────────────────────────────────────────
create or replace function public.enforce_transaction_shop_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.shop_settings%rowtype;
  financial_fields_changed boolean;
  service_items_total numeric(10,2);
begin
  select * into s from public.shop_settings where id = 1;
  if not found then
    return new;
  end if;

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

  select coalesce(sum(total_amount), 0) into service_items_total
  from public.transaction_service_items
  where transaction_id = new.id;

  if not s.allow_manual_total_override
     and financial_fields_changed
     and abs(
       coalesce(new.total_amount, 0)
       - (coalesce(new.base_amount, 0) + coalesce(new.add_ons, 0) + service_items_total)
     ) > 0.005 then
    raise exception 'Manual Total override is disabled by shop settings';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transaction_shop_preferences() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. Insert/update the child rows for one transaction from a validated
--    jsonb array. Shared by both RPCs below. Not exposed to clients
--    directly (no grant) — always called from inside a transaction-owning
--    RPC that has already locked and validated the parent row.
-- ─────────────────────────────────────────────────────────────
create or replace function private.replace_transaction_service_items_rows(
  p_transaction_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  item record;
  next_position integer := 0;
  lines_total numeric(10,2) := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Service item list must be an array' using errcode = '22023';
  end if;

  delete from public.transaction_service_items where transaction_id = p_transaction_id;

  for item in
    select
      service_id, kg, no_of_loads, base_amount, add_on_items,
      detergent_source, detergent_item_id, detergent_quantity, detergent_other_reason,
      fabric_conditioner_source, fabric_conditioner_item_id, fabric_conditioner_quantity, fabric_conditioner_other_reason
    from jsonb_to_recordset(p_items) as input(
      service_id uuid, kg numeric, no_of_loads integer, base_amount numeric, add_on_items jsonb,
      detergent_source text, detergent_item_id uuid, detergent_quantity numeric, detergent_other_reason text,
      fabric_conditioner_source text, fabric_conditioner_item_id uuid, fabric_conditioner_quantity numeric, fabric_conditioner_other_reason text
    )
  loop
    if item.service_id is null then
      raise exception 'Each additional service line requires a service' using errcode = '22023';
    end if;
    next_position := next_position + 1;

    insert into public.transaction_service_items (
      transaction_id, position, service_id, kg, no_of_loads, base_amount, add_on_items,
      detergent_source, detergent_item_id, detergent_quantity, detergent_other_reason,
      fabric_conditioner_source, fabric_conditioner_item_id, fabric_conditioner_quantity, fabric_conditioner_other_reason,
      created_by
    ) values (
      p_transaction_id, next_position, item.service_id, item.kg, item.no_of_loads,
      coalesce(item.base_amount, 0), coalesce(item.add_on_items, '[]'::jsonb),
      item.detergent_source, item.detergent_item_id, item.detergent_quantity, item.detergent_other_reason,
      item.fabric_conditioner_source, item.fabric_conditioner_item_id, item.fabric_conditioner_quantity, item.fabric_conditioner_other_reason,
      auth.uid()
    );
  end loop;

  select coalesce(sum(total_amount), 0) into lines_total
  from public.transaction_service_items
  where transaction_id = p_transaction_id;

  return lines_total;
end;
$$;

revoke all on function private.replace_transaction_service_items_rows(uuid, jsonb) from public, anon, authenticated;
-- Not reachable via the REST/RPC surface (private schema functions aren't
-- exposed by PostgREST), so granting execute here only allows it to be
-- called from other server-side SQL - specifically the two security invoker
-- RPCs below, which must have their calling role's own execute privilege on
-- every function they invoke, security definer or not. Mirrors the existing
-- pattern used for private.has_staff_permission / private.can_view_transaction,
-- which are likewise granted directly to authenticated for the same reason.
grant execute on function private.replace_transaction_service_items_rows(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. create_transaction_with_service_items() — atomic creation for a new
--    order that has at least one additional service from the start.
--    Everything (parent row + every line) lands in a single statement-visible
--    final state, so payment-integrity checks (e.g. GCash amount must equal
--    total_amount exactly) are only ever evaluated against the true grand
--    total - never a transiently-primary-only total. A single-service order
--    keeps using the plain insert into transactions directly; this function
--    is only for orders created with 2+ services from the start.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_transaction_with_service_items(
  p_transaction jsonb,
  p_service_items jsonb
)
returns public.transactions
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  new_id uuid := gen_random_uuid();
  lines_total numeric(10,2);
  primary_total numeric(10,2);
  final_payment_method text;
  final_cash_amount numeric(10,2);
  final_gcash_amount numeric(10,2);
  insert_gcash_amount numeric(10,2);
  inserted_txn public.transactions%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;

  -- p_transaction.total_amount is the PRIMARY service's own subtotal (after
  -- its discount, if any) - exactly what the plain single-service insert
  -- already sends today. cash_amount/gcash_amount, however, are the REAL
  -- amounts the customer paid for the WHOLE order (primary + every line).
  -- GCash requires total_amount to equal gcash_amount exactly, and check
  -- constraints are enforced per statement (never deferred), so the very
  -- first INSERT below cannot yet carry the real GCash amount - it would be
  -- rejected against the still-primary-only total_amount. It inserts a safe
  -- placeholder (equal to the primary-only total) instead, and the very next
  -- statement in this same function replaces it with the real amount at the
  -- same moment it corrects total_amount to the full grand total, so the
  -- constraint only ever sees a fully-consistent final pair.
  primary_total := coalesce((p_transaction->>'total_amount')::numeric, 0);
  final_payment_method := p_transaction->>'payment_method';
  final_cash_amount := coalesce((p_transaction->>'cash_amount')::numeric, 0);
  final_gcash_amount := coalesce((p_transaction->>'gcash_amount')::numeric, 0);
  insert_gcash_amount := case when final_payment_method = 'gcash' then primary_total else final_gcash_amount end;

  insert into public.transactions (
    id, customer_id, customer_name, phone_number, transaction_date, service_id,
    detergent_source, detergent_item_id, detergent_quantity, detergent_other_reason,
    fabric_conditioner_source, fabric_conditioner_item_id, fabric_conditioner_quantity, fabric_conditioner_other_reason,
    kg, no_of_loads, base_amount, add_ons, add_on_items,
    discount_promo_id, discount_promo_name_snapshot, discount_promo_kind_snapshot,
    discount_type_snapshot, discount_value_snapshot, discount_amount,
    total_amount, cash_amount, gcash_amount, gcash_reference, payment_method,
    pickup_date, pickup_time, notes, created_by, client_request_id
  ) values (
    new_id,
    nullif(p_transaction->>'customer_id', '')::uuid,
    p_transaction->>'customer_name',
    nullif(p_transaction->>'phone_number', ''),
    (p_transaction->>'transaction_date')::date,
    nullif(p_transaction->>'service_id', '')::uuid,
    p_transaction->>'detergent_source',
    nullif(p_transaction->>'detergent_item_id', '')::uuid,
    nullif(p_transaction->>'detergent_quantity', '')::numeric,
    p_transaction->>'detergent_other_reason',
    p_transaction->>'fabric_conditioner_source',
    nullif(p_transaction->>'fabric_conditioner_item_id', '')::uuid,
    nullif(p_transaction->>'fabric_conditioner_quantity', '')::numeric,
    p_transaction->>'fabric_conditioner_other_reason',
    nullif(p_transaction->>'kg', '')::numeric,
    nullif(p_transaction->>'no_of_loads', '')::integer,
    coalesce((p_transaction->>'base_amount')::numeric, 0),
    coalesce((p_transaction->>'add_ons')::numeric, 0),
    coalesce(p_transaction->'add_on_items', '[]'::jsonb),
    nullif(p_transaction->>'discount_promo_id', '')::uuid,
    p_transaction->>'discount_promo_name_snapshot',
    p_transaction->>'discount_promo_kind_snapshot',
    p_transaction->>'discount_type_snapshot',
    nullif(p_transaction->>'discount_value_snapshot', '')::numeric,
    coalesce((p_transaction->>'discount_amount')::numeric, 0),
    primary_total,
    final_cash_amount,
    insert_gcash_amount,
    nullif(p_transaction->>'gcash_reference', ''),
    final_payment_method,
    nullif(p_transaction->>'pickup_date', '')::date,
    nullif(p_transaction->>'pickup_time', '')::time,
    nullif(p_transaction->>'notes', ''),
    auth.uid(),
    nullif(p_transaction->>'client_request_id', '')::uuid
  );

  lines_total := private.replace_transaction_service_items_rows(new_id, p_service_items);

  update public.transactions
  set
    total_amount = greatest(0, round(primary_total + lines_total, 2)),
    gcash_amount = final_gcash_amount
  where id = new_id
  returning * into inserted_txn;

  return inserted_txn;
end;
$$;

revoke all on function public.create_transaction_with_service_items(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_transaction_with_service_items(jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 9. replace_transaction_service_items() — the edit-flow write path, used
--    by EditTransactionModal whenever a transaction has (or is gaining or
--    losing) additional service lines. p_primary carries exactly the same
--    fields EditTransactionModal's plain update already sends today, with
--    total_amount meaning the PRIMARY service's own subtotal (after its
--    discount) - not the grand total, same convention as the create RPC.
--    Everything (primary fields, lines, and the recomputed grand total +
--    payment amounts) lands in one UPDATE statement, so GCash's exact-match
--    check only ever sees a fully-consistent final row. A transaction with
--    no lines, gaining none in this edit, keeps using the plain .update()
--    call directly - this function is only for orders where lines are or
--    become part of the picture.
-- ─────────────────────────────────────────────────────────────
create or replace function public.replace_transaction_service_items(
  p_transaction_id uuid,
  p_expected_updated_at timestamptz,
  p_primary jsonb,
  p_items jsonb
)
returns public.transactions
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  txn public.transactions%rowtype;
  lines_total numeric(10,2) := 0;
  primary_total numeric(10,2);
  final_payment_method text;
  final_gcash_amount numeric(10,2);
  updated_txn public.transactions%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;

  select * into txn
  from public.transactions
  where id = p_transaction_id
    and private.can_view_transaction(transaction_date, payment_method, deleted_at)
  for update;

  if not found then
    raise exception 'Transaction not available for editing' using errcode = '42501';
  end if;
  if txn.deleted_at is not null then
    raise exception 'Cannot change services on a deleted transaction' using errcode = '42501';
  end if;
  if txn.order_status in ('completed', 'cancelled') then
    raise exception 'Cannot change services on a % order', txn.order_status using errcode = '42501';
  end if;
  if txn.updated_at is distinct from p_expected_updated_at then
    raise exception 'This order changed in another session. Refresh and try again.' using errcode = '40001';
  end if;
  if not (private.is_owner()
          or private.has_staff_permission('edit_transactions')
          or private.has_staff_permission('create_transactions')) then
    raise exception 'You do not have permission to change services on this order' using errcode = '42501';
  end if;

  primary_total := coalesce((p_primary->>'total_amount')::numeric, 0);
  final_payment_method := p_primary->>'payment_method';
  final_gcash_amount := coalesce((p_primary->>'gcash_amount')::numeric, 0);

  -- The child rows (and therefore lines_total) are settled BEFORE the parent
  -- row is touched at all, so - unlike create_transaction_with_service_items,
  -- which must insert the parent before any child can legally reference it -
  -- this can go straight to the true final grand total in a single UPDATE.
  -- Every constraint (GCash's exact match, and the patched Base+Add-ons+
  -- lines check) only ever sees the fully-consistent final row.
  lines_total := private.replace_transaction_service_items_rows(p_transaction_id, p_items);

  update public.transactions
  set
    customer_name = p_primary->>'customer_name',
    phone_number = nullif(p_primary->>'phone_number', ''),
    transaction_date = (p_primary->>'transaction_date')::date,
    service_id = nullif(p_primary->>'service_id', '')::uuid,
    detergent_source = p_primary->>'detergent_source',
    detergent_item_id = nullif(p_primary->>'detergent_item_id', '')::uuid,
    detergent_quantity = nullif(p_primary->>'detergent_quantity', '')::numeric,
    detergent_other_reason = p_primary->>'detergent_other_reason',
    fabric_conditioner_source = p_primary->>'fabric_conditioner_source',
    fabric_conditioner_item_id = nullif(p_primary->>'fabric_conditioner_item_id', '')::uuid,
    fabric_conditioner_quantity = nullif(p_primary->>'fabric_conditioner_quantity', '')::numeric,
    fabric_conditioner_other_reason = p_primary->>'fabric_conditioner_other_reason',
    kg = nullif(p_primary->>'kg', '')::numeric,
    no_of_loads = nullif(p_primary->>'no_of_loads', '')::integer,
    base_amount = coalesce((p_primary->>'base_amount')::numeric, 0),
    add_ons = coalesce((p_primary->>'add_ons')::numeric, add_ons),
    add_on_items = coalesce(p_primary->'add_on_items', add_on_items),
    total_amount = greatest(0, round(primary_total + lines_total, 2)),
    cash_amount = coalesce((p_primary->>'cash_amount')::numeric, 0),
    gcash_amount = final_gcash_amount,
    gcash_reference = nullif(p_primary->>'gcash_reference', ''),
    payment_method = final_payment_method,
    pickup_date = nullif(p_primary->>'pickup_date', '')::date,
    pickup_time = nullif(p_primary->>'pickup_time', '')::time,
    notes = nullif(p_primary->>'notes', '')
  where id = p_transaction_id
  returning * into updated_txn;

  return updated_txn;
end;
$$;

revoke all on function public.replace_transaction_service_items(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_transaction_service_items(uuid, timestamptz, jsonb, jsonb) to authenticated;

commit;
