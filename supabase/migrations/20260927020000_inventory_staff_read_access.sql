-- Allow Staff to read active inventory catalog entries needed by New Order.
-- Owner retains access to inactive/configuration rows and all write/delete permissions.

grant select on table public.inventory_categories, public.inventory_items to authenticated;

drop policy if exists inventory_categories_owner_select on public.inventory_categories;
create policy inventory_categories_authenticated_select
  on public.inventory_categories
  for select
  to authenticated
  using ((select private.is_owner()) or active);

drop policy if exists inventory_items_owner_select on public.inventory_items;
create policy inventory_items_authenticated_select
  on public.inventory_items
  for select
  to authenticated
  using ((select private.is_owner()) or active);
