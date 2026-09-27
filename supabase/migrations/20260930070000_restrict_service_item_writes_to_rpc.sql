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

commit;
