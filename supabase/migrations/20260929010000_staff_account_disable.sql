-- Staff account lifecycle: Disable / Enable instead of hard delete.
--
-- Why: a Staff profile is referenced (NO ACTION) by transactions, status
-- history, customer items, inventory, expenses and other business records, so
-- deleting the login either fails or would orphan history. Disabling keeps the
-- row (and therefore all history) while removing every permission.
--
-- Defence in depth. Access is removed in two independent layers:
--   1. Supabase Auth: the Edge Function bans the user and this migration's RPC
--      deletes their auth.sessions/refresh tokens.
--   2. The profiles/RLS permission layer: every helper and policy below
--      requires an ACTIVE profile row, so an unexpired JWT that was issued
--      before the disable (or a JWT whose profile row is missing) reads nothing.
--
-- This migration changes no existing data: it only adds columns (default
-- active), replaces helpers/policies, and adds service-role-only functions.
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Account state on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references public.profiles(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_account_state_consistent;
alter table public.profiles add constraint profiles_account_state_consistent
  check (is_active = (disabled_at is null));

-- Owner accounts can never be disabled (this also stops a disabled Staff
-- profile from being promoted to Owner).
alter table public.profiles drop constraint if exists profiles_owner_always_active;
alter table public.profiles add constraint profiles_owner_always_active
  check (role <> 'owner' or is_active);

-- Clients (including an Owner's browser session) may never write account state
-- directly. It is changed only by public.set_staff_account_active() below.
revoke update on table public.profiles from authenticated;
grant update (full_name, role, contact_phone, avatar_path) on table public.profiles to authenticated;

create or replace function private.guard_profile_account_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.is_active is distinct from old.is_active
          or new.disabled_at is distinct from old.disabled_at
          or new.disabled_by is distinct from old.disabled_by) then
    raise exception 'Account access can only be changed through the staff account service'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_account_state() from public, anon, authenticated;

drop trigger if exists profiles_guard_account_state on public.profiles;
create trigger profiles_guard_account_state
  before update on public.profiles
  for each row execute function private.guard_profile_account_state();

-- The existing safe-update trigger rejects any UPDATE that has no signed-in
-- Owner/Staff. Allow exactly one extra case: a trusted (non-client) database
-- role, such as the definer RPC below, that changes only the account-state
-- columns. Any other column change still goes through the original checks.
create or replace function public.enforce_safe_profile_update()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Profile creation time cannot be changed' using errcode = '42501';
  end if;

  if current_user not in ('authenticated', 'anon')
     and (to_jsonb(new) - array['is_active', 'disabled_at', 'disabled_by'])
       = (to_jsonb(old) - array['is_active', 'disabled_at', 'disabled_by']) then
    return new;
  end if;

  -- Owners retain the existing account-management ability.
  if private.is_owner() then
    return new;
  end if;

  if auth.uid() is null or old.id <> auth.uid() then
    raise exception 'You can only update your own profile' using errcode = '42501';
  end if;

  if not private.has_staff_permission('edit_own_profile') then
    raise exception 'Profile editing is disabled by the Owner' using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Staff cannot change their role' using errcode = '42501';
  end if;

  if new.avatar_path is not null
     and new.avatar_path not like auth.uid()::text || '/%' then
    raise exception 'Avatar path must belong to the signed-in user' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Two Owners demoting each other at the same instant must not leave zero
-- Owners: serialise the count by locking the Owner rows (id order avoids
-- deadlocks between two concurrent demotions; a deadlock would fail one safely).
create or replace function public.prevent_last_owner_demotion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner_count integer;
begin
  if old.role = 'owner' and new.role <> 'owner' then
    select count(*) into v_owner_count
    from (select id from public.profiles where role = 'owner' order by id for update) owners;
    if v_owner_count <= 1 then
      raise exception 'At least one owner account must remain.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Permission helpers require an ACTIVE profile row
-- ---------------------------------------------------------------------------
create or replace function private.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid()) and is_active
    );
$$;
revoke all on function private.is_active_user() from public, anon, authenticated;
grant execute on function private.is_active_user() to authenticated;

create or replace function private.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid()) and role = 'owner' and is_active
    );
$$;
revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to authenticated;

create or replace function private.has_staff_permission(p_permission text)
returns boolean language plpgsql stable security definer
set search_path = public, private, pg_temp
as $$
declare
  s public.shop_settings%rowtype;
  v_role text;
  v_active boolean;
begin
  -- No JWT subject = trusted database/maintenance context (unchanged).
  if auth.uid() is null then return true; end if;
  -- A signed-in caller needs an existing, active profile for ANY permission.
  -- This closes the gap where a deleted/disabled user's unexpired JWT kept the
  -- Staff defaults from shop_settings. One lookup: this runs once per row.
  select p.role, p.is_active into v_role, v_active
    from public.profiles p where p.id = auth.uid();
  if not found or v_active is not true then return false; end if;
  if v_role = 'owner' then return true; end if;
  select * into s from public.shop_settings where id = 1;
  if not found then return false; end if;
  return case p_permission
    when 'create_transactions' then s.staff_can_create_transactions
    when 'access_dashboard' then s.staff_can_access_dashboard
    when 'view_full_history' then s.staff_can_view_full_history
    when 'edit_transactions' then s.staff_can_edit_transactions
    when 'delete_transactions' then s.staff_can_delete_transactions
    when 'view_historical_pay_later' then s.staff_can_view_historical_pay_later
    when 'edit_own_profile' then s.staff_can_edit_own_profile
    when 'manage_customers' then s.staff_can_manage_customers
    else false end;
end;
$$;
revoke all on function private.has_staff_permission(text) from public, anon, authenticated;
grant execute on function private.has_staff_permission(text) to authenticated;

create or replace function private.can_view_transaction(
  p_transaction_date date,
  p_payment_method text,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_role text;
  v_active boolean;
begin
  if auth.uid() is null then
    return true;
  end if;

  select p.role, p.is_active into v_role, v_active
    from public.profiles p where p.id = auth.uid();
  if not found or v_active is not true then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  if p_deleted_at is not null then
    return false;
  end if;

  if p_transaction_date = (now() at time zone 'Asia/Manila')::date then
    return true;
  end if;

  if not private.has_staff_permission('access_dashboard')
     or not private.has_staff_permission('view_full_history') then
    return false;
  end if;

  if p_payment_method = 'pay_later'
     and not private.has_staff_permission('view_historical_pay_later') then
    return false;
  end if;

  return true;
end;
$$;
revoke all on function private.can_view_transaction(date, text, timestamptz) from public, anon, authenticated;
grant execute on function private.can_view_transaction(date, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies that only checked "a JWT exists" or "a profile row exists"
-- ---------------------------------------------------------------------------
drop policy if exists profiles_update_self_safe on public.profiles;
create policy profiles_update_self_safe
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()) and (select private.is_active_user()));

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check ((select private.is_active_user()) and private.has_staff_permission('manage_customers'));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using ((select private.is_active_user()) and private.has_staff_permission('manage_customers'))
  with check ((select private.is_active_user()) and private.has_staff_permission('manage_customers'));

drop policy if exists transaction_status_history_select on public.transaction_status_history;
create policy transaction_status_history_select on public.transaction_status_history for select to authenticated
  using (
    (select private.is_active_user())
    and exists (select 1 from public.transactions t where t.id = transaction_status_history.transaction_id)
  );

drop policy if exists services_select_all on public.services;
create policy services_select_all on public.services for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists add_ons_select_all on public.add_ons_catalog;
create policy add_ons_select_all on public.add_ons_catalog for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists shop_settings_select_authenticated on public.shop_settings;
create policy shop_settings_select_authenticated on public.shop_settings for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists discounts_promos_select on public.discounts_promos;
create policy discounts_promos_select on public.discounts_promos for select to authenticated
  using ((select private.is_active_user()) and ((select private.is_owner()) or active));

drop policy if exists inventory_categories_authenticated_select on public.inventory_categories;
create policy inventory_categories_authenticated_select on public.inventory_categories for select to authenticated
  using ((select private.is_active_user()) and ((select private.is_owner()) or active));

drop policy if exists inventory_items_authenticated_select on public.inventory_items;
create policy inventory_items_authenticated_select on public.inventory_items for select to authenticated
  using ((select private.is_active_user()) and ((select private.is_owner()) or active));

drop policy if exists profile_avatars_select_own_or_owner on storage.objects;
create policy profile_avatars_select_own_or_owner on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and (select private.is_active_user())
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_owner())));

drop policy if exists profile_avatars_insert_own_or_owner on storage.objects;
create policy profile_avatars_insert_own_or_owner on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and (select private.is_active_user())
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_owner())));

drop policy if exists profile_avatars_update_own_or_owner on storage.objects;
create policy profile_avatars_update_own_or_owner on storage.objects for update to authenticated
  using (bucket_id = 'profile-avatars' and (select private.is_active_user())
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_owner())))
  with check (bucket_id = 'profile-avatars' and (select private.is_active_user())
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_owner())));

drop policy if exists profile_avatars_delete_own_or_owner on storage.objects;
create policy profile_avatars_delete_own_or_owner on storage.objects for delete to authenticated
  using (bucket_id = 'profile-avatars' and (select private.is_active_user())
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_owner())));

-- ---------------------------------------------------------------------------
-- 4. Disable / Enable (service-role only; called by the manage-staff-user
--    Edge Function after it has authenticated the calling Owner)
-- ---------------------------------------------------------------------------
-- Deleting a session cascades to its refresh tokens; the second delete removes
-- any stragglers. Returns the number of sessions removed.
create or replace function private.revoke_user_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sessions integer := 0;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_sessions = row_count;
  delete from auth.refresh_tokens where user_id::text = p_user::text;
  return v_sessions;
end;
$$;
revoke all on function private.revoke_user_sessions(uuid) from public, anon, authenticated;

create or replace function public.set_staff_account_active(
  p_actor uuid,
  p_target uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_target public.profiles%rowtype;
  v_sessions integer := 0;
begin
  if p_actor is null or p_target is null or p_active is null then
    raise exception 'Actor, target and desired state are required' using errcode = '22023';
  end if;

  -- Re-verified inside the database so the rule holds even if a caller of this
  -- function (service role only) forgets to check.
  if not exists (
    select 1 from public.profiles where id = p_actor and role = 'owner' and is_active
  ) then
    raise exception 'Only an active Owner can change account access' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'Staff account not found' using errcode = 'P0002';
  end if;

  -- Owner accounts (including the acting Owner) are never disabled here.
  if v_target.role <> 'staff' then
    raise exception 'Owner accounts cannot be disabled or enabled here' using errcode = '42501';
  end if;

  if p_active then
    update public.profiles
      set is_active = true, disabled_at = null, disabled_by = null
      where id = p_target and not is_active;
  else
    update public.profiles
      set is_active = false, disabled_at = now(), disabled_by = p_actor
      where id = p_target and is_active;

    -- Runs on every disable call (also a retry of one that failed half-way)
    -- so it is idempotent.
    v_sessions := private.revoke_user_sessions(p_target);
  end if;

  select * into v_target from public.profiles where id = p_target;
  return jsonb_build_object(
    'user_id', v_target.id,
    'is_active', v_target.is_active,
    'disabled_at', v_target.disabled_at,
    'sessions_revoked', v_sessions
  );
end;
$$;
revoke all on function public.set_staff_account_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_staff_account_active(uuid, uuid, boolean) to service_role;

-- Signs a Staff user out everywhere without changing their access, e.g. after
-- an Owner resets their password. Same authorization rules as above.
create or replace function public.revoke_staff_sessions(p_actor uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_role text;
begin
  if p_actor is null or p_target is null then
    raise exception 'Actor and target are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_actor and role = 'owner' and is_active
  ) then
    raise exception 'Only an active Owner can revoke sessions' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_target;
  if not found then
    raise exception 'Staff account not found' using errcode = 'P0002';
  end if;
  if v_role <> 'staff' then
    raise exception 'Owner sessions cannot be revoked here' using errcode = '42501';
  end if;
  return jsonb_build_object('user_id', p_target, 'sessions_revoked', private.revoke_user_sessions(p_target));
end;
$$;
revoke all on function public.revoke_staff_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_sessions(uuid, uuid) to service_role;

commit;
