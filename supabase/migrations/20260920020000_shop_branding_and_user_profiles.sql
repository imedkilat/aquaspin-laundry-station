-- Shop branding + safe self-service user profiles.
-- Shop logos are public business assets with Owner-only writes.
-- User avatars stay private and are scoped to each authenticated user.

-- This migration depends on the Owner Settings migration immediately before it.
do $$
begin
  if to_regclass('public.shop_settings') is null then
    raise exception 'Apply 20260920010000_owner_settings_and_staff_permissions.sql first';
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. Profile fields + Owner-configurable self-profile permission
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists contact_phone text,
  add column if not exists avatar_path text;

alter table public.shop_settings
  add column if not exists logo_path text,
  add column if not exists staff_can_edit_own_profile boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_contact_phone_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_contact_phone_length_check
      check (contact_phone is null or char_length(contact_phone) <= 64) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_avatar_path_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_length_check
      check (avatar_path is null or char_length(avatar_path) <= 500) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_settings_logo_path_length_check'
      and conrelid = 'public.shop_settings'::regclass
  ) then
    alter table public.shop_settings
      add constraint shop_settings_logo_path_length_check
      check (logo_path is null or char_length(logo_path) <= 500) not valid;
  end if;
end
$$;

-- Extend the deliberately delegable Staff permission list.
create or replace function private.has_staff_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  s public.shop_settings%rowtype;
begin
  if auth.uid() is null then
    return true;
  end if;

  if private.is_owner() then
    return true;
  end if;

  select * into s from public.shop_settings where id = 1;
  if not found then
    return false;
  end if;

  return case p_permission
    when 'create_transactions' then s.staff_can_create_transactions
    when 'access_dashboard' then s.staff_can_access_dashboard
    when 'view_full_history' then s.staff_can_view_full_history
    when 'edit_transactions' then s.staff_can_edit_transactions
    when 'delete_transactions' then s.staff_can_delete_transactions
    when 'view_historical_pay_later' then s.staff_can_view_historical_pay_later
    when 'edit_own_profile' then s.staff_can_edit_own_profile
    else false
  end;
end;
$$;

revoke all on function private.has_staff_permission(text) from public, anon, authenticated;
grant execute on function private.has_staff_permission(text) to authenticated;

-- Staff may update their own safe profile fields. The trigger below prevents
-- role/identity escalation even if a caller bypasses the browser UI.
drop policy if exists profiles_update_self_safe on public.profiles;
create policy profiles_update_self_safe
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.enforce_safe_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Profile creation time cannot be changed' using errcode = '42501';
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

revoke all on function public.enforce_safe_profile_update() from public, anon, authenticated;

drop trigger if exists profiles_enforce_safe_self_update on public.profiles;
create trigger profiles_enforce_safe_self_update
  before update on public.profiles
  for each row execute function public.enforce_safe_profile_update();

-- ─────────────────────────────────────────────────────────────
-- 2. Storage buckets
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-branding',
  'shop-branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public shop logo: anyone may read it, only authenticated Owners may mutate it.
drop policy if exists shop_branding_public_read on storage.objects;
create policy shop_branding_public_read
  on storage.objects
  for select
  to public
  using (bucket_id = 'shop-branding');

drop policy if exists shop_branding_owner_insert on storage.objects;
create policy shop_branding_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'shop-branding' and private.is_owner());

drop policy if exists shop_branding_owner_update on storage.objects;
create policy shop_branding_owner_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'shop-branding' and private.is_owner())
  with check (bucket_id = 'shop-branding' and private.is_owner());

drop policy if exists shop_branding_owner_delete on storage.objects;
create policy shop_branding_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'shop-branding' and private.is_owner());

-- Private user avatars: self-scoped folder, with Owner admin visibility.
drop policy if exists profile_avatars_select_own_or_owner on storage.objects;
create policy profile_avatars_select_own_or_owner
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.is_owner()
    )
  );

drop policy if exists profile_avatars_insert_own_or_owner on storage.objects;
create policy profile_avatars_insert_own_or_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.is_owner()
    )
  );

drop policy if exists profile_avatars_update_own_or_owner on storage.objects;
create policy profile_avatars_update_own_or_owner
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.is_owner()
    )
  )
  with check (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.is_owner()
    )
  );

drop policy if exists profile_avatars_delete_own_or_owner on storage.objects;
create policy profile_avatars_delete_own_or_owner
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.is_owner()
    )
  );
