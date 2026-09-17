-- Performance hardening for customer/status RLS policies.
--
-- Supabase's database advisor flags direct auth.uid() calls inside RLS policy
-- expressions because PostgreSQL may re-evaluate them once per row. Wrapping
-- auth.uid() in a scalar SELECT lets PostgreSQL treat the value as an initplan
-- for the statement while preserving the same authorization semantics.
--
-- This migration changes policy evaluation shape only. It does not widen
-- customer visibility, staff permissions, status-history visibility, or any
-- mutation authority.

begin;
set local lock_timeout = '5s';

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
    )
  );

drop policy if exists customers_insert on public.customers;
create policy customers_insert
  on public.customers
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
    )
    and private.has_staff_permission('manage_customers')
  );

drop policy if exists customers_update on public.customers;
create policy customers_update
  on public.customers
  for update
  to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
    )
    and private.has_staff_permission('manage_customers')
  )
  with check (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
    )
    and private.has_staff_permission('manage_customers')
  );

drop policy if exists transaction_status_history_select on public.transaction_status_history;
create policy transaction_status_history_select
  on public.transaction_status_history
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.transactions t
      where t.id = transaction_id
    )
  );

commit;
