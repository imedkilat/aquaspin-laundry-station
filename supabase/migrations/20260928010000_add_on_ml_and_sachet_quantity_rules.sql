-- Add millilitre-based add-ons and keep sachet quantities whole.
begin;
set local lock_timeout = '5s';

alter table public.add_ons_catalog
  drop constraint if exists add_ons_catalog_unit_type_check;

alter table public.add_ons_catalog
  add constraint add_ons_catalog_unit_type_check
  check (unit_type in ('piece', 'load', 'sachet', 'dose', 'cycle', 'kg', 'ml', 'flat'));

-- The browser floors sachet quantities for convenience, but this trigger is
-- the final authority for direct API callers and older clients.
create or replace function private.validate_transaction_sachet_add_on_quantity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  item_unit text;
  item_quantity numeric;
begin
  for item in select value from jsonb_array_elements(coalesce(new.add_on_items, '[]'::jsonb))
  loop
    item_unit := nullif(item->>'unit_type', '');
    begin
      item_quantity := (item->>'quantity')::numeric;
    exception when others then
      item_quantity := null;
    end;

    if item_unit = 'sachet'
       and item_quantity is not null
       and item_quantity <> trunc(item_quantity) then
      raise exception 'Per sachet quantities must be whole numbers' using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.validate_transaction_sachet_add_on_quantity() from public, anon, authenticated;

drop trigger if exists transactions_11_validate_sachet_add_on_quantity on public.transactions;
create trigger transactions_11_validate_sachet_add_on_quantity
  before update of add_on_items on public.transactions
  for each row execute function private.validate_transaction_sachet_add_on_quantity();

drop trigger if exists transactions_11_validate_sachet_add_on_quantity_insert on public.transactions;
create trigger transactions_11_validate_sachet_add_on_quantity_insert
  before insert on public.transactions
  for each row execute function private.validate_transaction_sachet_add_on_quantity();

commit;
