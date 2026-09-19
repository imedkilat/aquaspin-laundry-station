-- Inventory consumption is posted when an order becomes completed. Once an
-- order is completed or cancelled, its inventory snapshot must be immutable so
-- direct API callers cannot change the snapshot without changing the ledger.

create or replace function private.prevent_terminal_inventory_edit()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if old.order_status in ('completed', 'cancelled')
     and (
       new.detergent_source is distinct from old.detergent_source
       or new.detergent_item_id is distinct from old.detergent_item_id
       or new.detergent_quantity is distinct from old.detergent_quantity
       or new.detergent_other_reason is distinct from old.detergent_other_reason
       or new.fabric_conditioner_source is distinct from old.fabric_conditioner_source
       or new.fabric_conditioner_item_id is distinct from old.fabric_conditioner_item_id
       or new.fabric_conditioner_quantity is distinct from old.fabric_conditioner_quantity
       or new.fabric_conditioner_other_reason is distinct from old.fabric_conditioner_other_reason
     ) then
    raise exception 'Inventory usage cannot be changed after an order is completed or cancelled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_terminal_inventory_edit() from public, anon, authenticated;

drop trigger if exists transactions_08_prevent_terminal_inventory_edits on public.transactions;
create trigger transactions_08_prevent_terminal_inventory_edits
  before update of
    detergent_source,
    detergent_item_id,
    detergent_quantity,
    detergent_other_reason,
    fabric_conditioner_source,
    fabric_conditioner_item_id,
    fabric_conditioner_quantity,
    fabric_conditioner_other_reason
  on public.transactions
  for each row execute function private.prevent_terminal_inventory_edit();
