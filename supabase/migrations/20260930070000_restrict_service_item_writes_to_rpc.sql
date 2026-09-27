begin;

-- Service-line mutations must go through the create/replace RPCs so the
-- parent transaction total and payment integrity checks stay atomic.
revoke all on table public.transaction_service_items from public, anon, authenticated;
grant select on table public.transaction_service_items to authenticated;

drop policy if exists transaction_service_items_insert on public.transaction_service_items;
drop policy if exists transaction_service_items_update on public.transaction_service_items;
drop policy if exists transaction_service_items_delete on public.transaction_service_items;

-- Both inventory-consumption AFTER triggers touch inventory rows. Acquire all
-- inventory rows for the order, across the primary and additional services,
-- in one global UUID order before either trigger starts consuming stock.
create or replace function private.lock_transaction_inventory_for_completion()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  inventory_item_id uuid;
begin
  if old.order_status is not distinct from new.order_status
     or new.order_status is distinct from 'completed'
     or new.deleted_at is not null then
    return new;
  end if;

  for inventory_item_id in
    select distinct requested.item_id
    from (
      select new.detergent_item_id as item_id
      where new.detergent_source = 'inventory'
      union all
      select new.fabric_conditioner_item_id
      where new.fabric_conditioner_source = 'inventory'
      union all
      select line.detergent_item_id
      from public.transaction_service_items as line
      where line.transaction_id = new.id
        and line.detergent_source = 'inventory'
      union all
      select line.fabric_conditioner_item_id
      from public.transaction_service_items as line
      where line.transaction_id = new.id
        and line.fabric_conditioner_source = 'inventory'
    ) as requested
    where requested.item_id is not null
    order by requested.item_id
  loop
    perform 1
    from public.inventory_items as item
    where item.id = inventory_item_id
    for update;
  end loop;

  return new;
end;
$$;

revoke all on function private.lock_transaction_inventory_for_completion() from public, anon, authenticated;

drop trigger if exists transactions_lock_inventory_for_completion on public.transactions;
create trigger transactions_lock_inventory_for_completion
  before update of order_status on public.transactions
  for each row execute function private.lock_transaction_inventory_for_completion();

-- Replacing service lines is an edit operation. Do not let create-only Staff
-- accounts mutate an existing order's child rows, and fail the RPC if RLS
-- prevents the parent update so the child-row changes roll back atomically.
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
  if not (private.is_owner() or private.has_staff_permission('edit_transactions')) then
    raise exception 'You do not have permission to change services on this order' using errcode = '42501';
  end if;

  primary_total := coalesce((p_primary->>'total_amount')::numeric, 0);
  final_payment_method := p_primary->>'payment_method';
  final_gcash_amount := coalesce((p_primary->>'gcash_amount')::numeric, 0);

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

  if not found then
    raise exception 'Transaction update was blocked; no service changes were saved' using errcode = '42501';
  end if;

  return updated_txn;
end;
$$;

revoke all on function public.replace_transaction_service_items(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_transaction_service_items(uuid, timestamptz, jsonb, jsonb) to authenticated;

-- Multi-service creation performs one internal parent UPDATE after inserting
-- the child rows so the final total and GCash amount satisfy the constraints.
-- Scope that one update with a transaction-local marker; create permission
-- alone must not authorize edits to existing transactions.
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

  if current_setting('aquaspin.create_multi_service_order', true) = 'on'
     and old.created_by = auth.uid()
     and old.created_at = transaction_timestamp() then
    return new;
  end if;

  if not private.has_staff_permission('edit_transactions') then
    raise exception 'Staff transaction editing is disabled by the Owner' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Preserve the established trigger and its least-privilege function grants.
revoke all on function public.enforce_transaction_staff_permissions() from public, anon, authenticated;

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
  parent_updated boolean;
  inserted_txn public.transactions%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;
  if not (private.is_owner() or private.has_staff_permission('create_transactions')) then
    raise exception 'You do not have permission to create transactions' using errcode = '42501';
  end if;

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

  perform set_config('aquaspin.create_multi_service_order', 'on', true);
  update public.transactions
  set
    total_amount = greatest(0, round(primary_total + lines_total, 2)),
    gcash_amount = final_gcash_amount
  where id = new_id
  returning * into inserted_txn;
  parent_updated := found;
  perform set_config('aquaspin.create_multi_service_order', 'off', true);

  if not parent_updated then
    raise exception 'New transaction totals could not be finalized' using errcode = '42501';
  end if;

  return inserted_txn;
end;
$$;

revoke all on function public.create_transaction_with_service_items(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_transaction_with_service_items(jsonb, jsonb) to authenticated;

commit;
