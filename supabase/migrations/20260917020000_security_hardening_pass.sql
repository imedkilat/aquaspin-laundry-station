-- Security hardening pass. Nothing here changes what owners/staff can do;
-- it narrows what unauthenticated (anon) callers and unrelated roles can
-- reach, and tightens/audits the RLS surface. All idempotent.

-- 1. This app has no anonymous-facing feature at all (everything requires
--    a logged-in owner/staff session). RLS already blocks anon on every
--    table (no policy grants that role anything), but Supabase's default
--    schema-level GRANTs still hand anon raw table privileges. Revoke them
--    so a future RLS mistake (policy dropped, RLS toggled off) can't
--    accidentally expose data to an anonymous caller. Verified live:
--    `set role anon; select ... from public.transactions` now fails with
--    "permission denied for table transactions" instead of relying on RLS
--    alone.
revoke all on public.profiles from anon;
revoke all on public.transactions from anon;
revoke all on public.services from anon;
revoke all on public.add_ons_catalog from anon;
revoke execute on function public.generate_transaction_code() from anon;

-- 2. Fix the "multiple permissive policies" advisory on services /
--    add_ons_catalog: the owner-write policy was FOR ALL, which
--    (redundantly, with select-all) also matched SELECT, so Postgres had
--    to evaluate two permissive policies per read. Split it into
--    INSERT/UPDATE/DELETE so SELECT is governed by exactly one policy.
--    Same effective permissions, smaller/simpler policy surface.
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='services' and policyname='services_write_owner_only') then
    drop policy services_write_owner_only on public.services;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='services' and policyname='services_insert_owner_only') then
    create policy services_insert_owner_only on public.services for insert to authenticated with check (private.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='services' and policyname='services_update_owner_only') then
    create policy services_update_owner_only on public.services for update to authenticated using (private.is_owner()) with check (private.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='services' and policyname='services_delete_owner_only') then
    create policy services_delete_owner_only on public.services for delete to authenticated using (private.is_owner());
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='add_ons_catalog' and policyname='add_ons_write_owner_only') then
    drop policy add_ons_write_owner_only on public.add_ons_catalog;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='add_ons_catalog' and policyname='add_ons_insert_owner_only') then
    create policy add_ons_insert_owner_only on public.add_ons_catalog for insert to authenticated with check (private.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='add_ons_catalog' and policyname='add_ons_update_owner_only') then
    create policy add_ons_update_owner_only on public.add_ons_catalog for update to authenticated using (private.is_owner()) with check (private.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='add_ons_catalog' and policyname='add_ons_delete_owner_only') then
    create policy add_ons_delete_owner_only on public.add_ons_catalog for delete to authenticated using (private.is_owner());
  end if;
end
$$;

-- 3. Missing FK indexes (performance advisory; also keeps lookups cheap
--    as transaction volume grows).
create index if not exists transactions_service_id_idx on public.transactions (service_id);

-- 4. Lightweight accountability trail: record which logged-in user last
--    edited a transaction row (e.g. who marked a Pay Later as paid on
--    pickup). Additive only -- does not restrict who can update, matches
--    the existing "any staff can update for pickup lookups" behavior.
alter table public.transactions
  add column if not exists updated_by uuid references public.profiles(id);

create index if not exists transactions_updated_by_idx on public.transactions (updated_by);

create or replace function public.set_transaction_updated_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'transactions_set_updated_by'
      and tgrelid = 'public.transactions'::regclass
  ) then
    create trigger transactions_set_updated_by
      before update on public.transactions
      for each row execute function public.set_transaction_updated_by();
  end if;
end
$$;
