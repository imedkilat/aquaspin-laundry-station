-- Harden transaction history so edits cannot silently rewrite historical
-- add-on pricing, spoof audit attribution, or mutate public transaction identity.
--
-- This migration is intentionally server-side. The UI remains convenient,
-- but Postgres is the final authority even for direct API calls.

-- 1. Normalize add-on snapshots on INSERT / UPDATE.
-- Existing add-ons keep the unit/name/price captured when the transaction was
-- originally saved. Newly-added add-ons use the current catalog values.
-- Quantity may be corrected later, but the historical unit price is preserved.
create or replace function public.normalize_transaction_add_on_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  previous_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  add_on_uuid uuid;
  item_name text;
  item_unit text;
  item_price numeric(10,2);
  item_quantity numeric;
  item_line_total numeric(10,2);
  normalized_total numeric(10,2) := 0;
  manual_adjustment numeric(10,2);
  old_items jsonb;
  old_add_ons numeric(10,2);
begin
  if tg_op = 'UPDATE' then
    old_items := coalesce(old.add_on_items, '[]'::jsonb);
    old_add_ons := coalesce(old.add_ons, 0);
  else
    old_items := '[]'::jsonb;
    old_add_ons := 0;
  end if;

  manual_adjustment :=
    coalesce(new.total_amount, 0) - coalesce(new.base_amount, 0) - coalesce(new.add_ons, 0);

  new.add_on_items := coalesce(new.add_on_items, '[]'::jsonb);

  if jsonb_typeof(new.add_on_items) <> 'array' then
    raise exception 'add_on_items must be a JSON array';
  end if;

  -- Preserve pre-catalog legacy add-on amounts when there is no structured
  -- snapshot to normalize. This avoids erasing historical miscellaneous fees
  -- merely because someone edits an unrelated field later.
  if jsonb_array_length(new.add_on_items) = 0 then
    if tg_op = 'UPDATE'
       and jsonb_array_length(old_items) = 0
       and old_add_ons > 0 then
      new.add_ons := old_add_ons;
    else
      new.add_ons := 0;
    end if;

    new.total_amount := round(coalesce(new.base_amount, 0) + new.add_ons + manual_adjustment, 2);
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.add_on_items)
  loop
    begin
      add_on_uuid := nullif(item->>'add_on_id', '')::uuid;
    exception when others then
      raise exception 'Invalid add-on id in transaction snapshot';
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

    previous_item := null;
    if tg_op = 'UPDATE' then
      select value
        into previous_item
      from jsonb_array_elements(old_items)
      where value->>'add_on_id' = add_on_uuid::text
      limit 1;
    end if;

    if previous_item is not null then
      -- Preserve the exact commercial snapshot already recorded on the sale.
      item_name := previous_item->>'name';
      item_unit := previous_item->>'unit_type';
      item_price := (previous_item->>'unit_price')::numeric;
    else
      -- New item added during an edit, or a brand-new transaction: snapshot
      -- the catalog value now instead of trusting browser-supplied pricing.
      select name, unit_type, price
        into item_name, item_unit, item_price
      from public.add_ons_catalog
      where id = add_on_uuid;

      if not found then
        raise exception 'Add-on % does not exist in the catalog', add_on_uuid;
      end if;
    end if;

    if item_unit = 'flat' then
      item_quantity := 1;
    end if;

    item_line_total := round(item_price * item_quantity, 2);
    normalized_total := normalized_total + item_line_total;

    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'add_on_id', add_on_uuid,
        'name', item_name,
        'unit_type', item_unit,
        'unit_price', item_price,
        'quantity', item_quantity,
        'line_total', item_line_total
      )
    );
  end loop;

  new.add_on_items := normalized_items;
  new.add_ons := round(normalized_total, 2);

  -- Preserve any explicit manual total adjustment already present in the
  -- incoming form, but base that adjustment on the normalized historical
  -- add-on snapshot rather than today's catalog prices.
  new.total_amount := round(coalesce(new.base_amount, 0) + new.add_ons + manual_adjustment, 2);

  return new;
end;
$$;

revoke all on function public.normalize_transaction_add_on_snapshot() from public, anon, authenticated;

drop trigger if exists transactions_10_normalize_add_on_snapshot on public.transactions;
create trigger transactions_10_normalize_add_on_snapshot
  before insert or update on public.transactions
  for each row execute function public.normalize_transaction_add_on_snapshot();

-- 2. Make audit/identity fields authoritative at the database layer.
create or replace function public.enforce_transaction_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Transaction id cannot be changed' using errcode = '42501';
  end if;

  if new.transaction_no is distinct from old.transaction_no then
    raise exception 'Internal transaction number cannot be changed' using errcode = '42501';
  end if;

  if new.transaction_code is distinct from old.transaction_code then
    raise exception 'Public transaction code cannot be changed' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'Transaction creator cannot be changed' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Transaction creation time cannot be changed' using errcode = '42501';
  end if;

  if new.client_request_id is distinct from old.client_request_id then
    raise exception 'Transaction request id cannot be changed' using errcode = '42501';
  end if;

  -- Normal active row: deletion metadata cannot be pre-filled/spoofed.
  if old.deleted_at is null and new.deleted_at is null then
    new.deleted_by := null;
    new.delete_reason := null;
    return new;
  end if;

  -- First transition into soft-deleted state. Timestamp + actor are generated
  -- by Postgres, not trusted from the browser.
  if old.deleted_at is null and new.deleted_at is not null then
    if nullif(btrim(new.delete_reason), '') is null
       or char_length(btrim(new.delete_reason)) < 3 then
      raise exception 'A delete reason of at least 3 characters is required';
    end if;

    new.deleted_at := now();
    new.deleted_by := auth.uid();
    return new;
  end if;

  -- Deleted rows are immutable until an owner restores them. This keeps the
  -- audit trail meaningful even if a staff member bypasses the UI.
  if old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'Deleted transactions must be restored before editing' using errcode = '42501';
  end if;

  -- Restore transition: owner-only at the database layer. Service-role/admin
  -- maintenance has auth.uid() = null and remains possible when necessary.
  if old.deleted_at is not null and new.deleted_at is null then
    if auth.uid() is not null and not private.is_owner() then
      raise exception 'Only an owner can restore a deleted transaction' using errcode = '42501';
    end if;

    new.deleted_by := null;
    new.delete_reason := null;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transaction_audit_fields() from public, anon, authenticated;

drop trigger if exists transactions_20_enforce_audit_fields on public.transactions;
create trigger transactions_20_enforce_audit_fields
  before update on public.transactions
  for each row execute function public.enforce_transaction_audit_fields();
