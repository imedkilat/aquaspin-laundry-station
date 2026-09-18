-- Phase 7: simple, auditable loyalty points and threshold rewards.
-- Points start on future completed transitions; historical transactions are not backfilled.

create table if not exists public.loyalty_settings (
  id smallint primary key default 1 check (id = 1),
  points_per_kg numeric not null default 1 check (points_per_kg > 0),
  points_required_for_reward integer not null default 500 check (points_required_for_reward > 0),
  reward_description text not null default 'Free Wash & Dry-Fold'
    check (char_length(btrim(reward_description)) between 1 and 300),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id)
);

insert into public.loyalty_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.loyalty_point_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  kg numeric not null check (kg > 0),
  points_earned numeric not null check (points_earned > 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint loyalty_point_events_transaction_key unique (transaction_id)
);

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  points_spent numeric not null check (points_spent > 0),
  reward_description text not null
    check (char_length(btrim(reward_description)) between 1 and 300),
  redeemed_at timestamptz not null default clock_timestamp(),
  redeemed_by uuid not null references public.profiles(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 500)
);

create or replace function private.stamp_loyalty_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.stamp_loyalty_settings() from public, anon, authenticated;
drop trigger if exists loyalty_settings_stamp on public.loyalty_settings;
create trigger loyalty_settings_stamp
before update on public.loyalty_settings
for each row execute function private.stamp_loyalty_settings();

create or replace function private.prevent_loyalty_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Loyalty ledgers are append-only';
end;
$$;

revoke all on function private.prevent_loyalty_ledger_mutation() from public, anon, authenticated;
drop trigger if exists loyalty_point_events_append_only on public.loyalty_point_events;
create trigger loyalty_point_events_append_only
before update or delete on public.loyalty_point_events
for each row execute function private.prevent_loyalty_ledger_mutation();
drop trigger if exists loyalty_redemptions_append_only on public.loyalty_redemptions;
create trigger loyalty_redemptions_append_only
before update or delete on public.loyalty_redemptions
for each row execute function private.prevent_loyalty_ledger_mutation();

create or replace function private.award_loyalty_points_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points_per_kg numeric;
begin
  if old.order_status is distinct from new.order_status
    and new.order_status = 'completed'
    and new.customer_id is not null
    and new.deleted_at is null
    and new.kg is not null
    and new.kg > 0 then
    select points_per_kg
    into v_points_per_kg
    from public.loyalty_settings
    where id = 1;

    if v_points_per_kg is not null then
      insert into public.loyalty_point_events (customer_id, transaction_id, kg, points_earned)
      values (new.customer_id, new.id, new.kg, new.kg * v_points_per_kg)
      on conflict (transaction_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.award_loyalty_points_on_completion() from public, anon, authenticated;
drop trigger if exists transactions_award_loyalty_points on public.transactions;
create trigger transactions_award_loyalty_points
after update of order_status on public.transactions
for each row execute function private.award_loyalty_points_on_completion();

create or replace function private.calculate_loyalty_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(points_earned) from public.loyalty_point_events where customer_id = p_customer_id), 0)
    - coalesce((select sum(points_spent) from public.loyalty_redemptions where customer_id = p_customer_id), 0)
$$;

revoke all on function private.calculate_loyalty_balance(uuid) from public, anon, authenticated;
grant execute on function private.calculate_loyalty_balance(uuid) to authenticated;

create or replace view public.customer_loyalty_balance
with (security_invoker = true)
as
select
  c.id as customer_id,
  c.customer_code,
  c.full_name,
  c.active,
  private.calculate_loyalty_balance(c.id) as points_balance
from public.customers c;

create or replace function public.redeem_loyalty_reward(
  p_customer_id uuid,
  p_notes text default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.loyalty_settings;
  v_balance numeric;
  v_redemption public.loyalty_redemptions;
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an Owner can redeem loyalty rewards' using errcode = '42501';
  end if;
  if p_customer_id is null then
    raise exception 'Customer is required';
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'Redemption notes must be 500 characters or fewer';
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;

  select * into v_settings from public.loyalty_settings where id = 1;
  v_balance := private.calculate_loyalty_balance(p_customer_id);

  if v_balance < v_settings.points_required_for_reward then
    raise exception 'Insufficient loyalty points: % available, % required',
      v_balance, v_settings.points_required_for_reward;
  end if;

  insert into public.loyalty_redemptions (
    customer_id, points_spent, reward_description, redeemed_by, notes
  )
  values (
    p_customer_id,
    v_settings.points_required_for_reward,
    v_settings.reward_description,
    auth.uid(),
    nullif(btrim(p_notes), '')
  )
  returning * into v_redemption;

  return v_redemption;
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_loyalty_reward(uuid, text) to authenticated;

alter table public.loyalty_settings enable row level security;
alter table public.loyalty_point_events enable row level security;
alter table public.loyalty_redemptions enable row level security;

revoke all on table public.loyalty_settings from public, anon, authenticated;
revoke all on table public.loyalty_point_events from public, anon, authenticated;
revoke all on table public.loyalty_redemptions from public, anon, authenticated;
grant select, update on table public.loyalty_settings to authenticated;
grant select on table public.loyalty_point_events to authenticated;
grant select on table public.loyalty_redemptions to authenticated;
grant select on table public.customer_loyalty_balance to authenticated;

drop policy if exists loyalty_settings_owner_select on public.loyalty_settings;
create policy loyalty_settings_owner_select on public.loyalty_settings
for select to authenticated using ((select private.is_owner()));
drop policy if exists loyalty_settings_owner_update on public.loyalty_settings;
create policy loyalty_settings_owner_update on public.loyalty_settings
for update to authenticated using ((select private.is_owner()))
with check ((select private.is_owner()));

drop policy if exists loyalty_point_events_owner_select on public.loyalty_point_events;
create policy loyalty_point_events_owner_select on public.loyalty_point_events
for select to authenticated using ((select private.is_owner()));

drop policy if exists loyalty_redemptions_owner_select on public.loyalty_redemptions;
create policy loyalty_redemptions_owner_select on public.loyalty_redemptions
for select to authenticated using ((select private.is_owner()));

