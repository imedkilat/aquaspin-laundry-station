-- Inventory usage remains immutable after stock has been consumed, even if an
-- Owner reopens the order through the reasoned status override path.

create or replace function private.prevent_terminal_inventory_edit()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (
       old.order_status in ('completed', 'cancelled')
       or exists (
         select 1
         from public.transaction_inventory_consumption c
         where c.transaction_id = old.id
       )
     )
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
    if old.order_status in ('completed', 'cancelled') then
      raise exception 'Inventory usage cannot be changed after an order is completed or cancelled'
        using errcode = '42501';
    end if;
    raise exception 'Inventory usage cannot be changed after stock consumption has been recorded'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_terminal_inventory_edit() from public, anon, authenticated;
