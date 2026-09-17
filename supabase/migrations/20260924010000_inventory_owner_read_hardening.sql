-- Phase 5 follow-up: inventory is Owner-only in the current foundation.
-- Keep the existing grants for API compatibility, but enforce the access
-- boundary through RLS so Staff cannot read stock costs or movement history.

drop policy if exists inventory_categories_select_authenticated on public.inventory_categories;
create policy inventory_categories_owner_select
  on public.inventory_categories
  for select
  to authenticated
  using ((select private.is_owner()));

drop policy if exists inventory_items_select_authenticated on public.inventory_items;
create policy inventory_items_owner_select
  on public.inventory_items
  for select
  to authenticated
  using ((select private.is_owner()));

drop policy if exists inventory_movements_select_authenticated on public.inventory_stock_movements;
create policy inventory_movements_owner_select
  on public.inventory_stock_movements
  for select
  to authenticated
  using ((select private.is_owner()));
