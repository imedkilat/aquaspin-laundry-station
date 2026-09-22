-- Loyalty Reward Home Notification (server-side threshold detection).
--
-- Scope: Home notification only. No SMS/PhilSMS. No provider secrets.
--
-- Detection happens in the database, not React: whenever a qualifying
-- completed transaction inserts a row into the existing append-only
-- loyalty_point_events ledger (private.award_loyalty_points_on_completion
-- already guards cancelled/deleted/incomplete/non-qualifying transactions —
-- see 20260926010000_loyalty_points_v1.sql), a trigger here checks whether
-- that event crossed the customer from below the configured threshold to at
-- or above it, and if so opens exactly one active notification row.
--
-- Idempotency: `on conflict do nothing` (no target) is used everywhere a
-- notification is inserted, so it is protected by BOTH unique indexes below
-- at once - a duplicate ledger event and a customer who already has an
-- active notification are both silently no-ops. Refreshes, retries and
-- realtime reconnects on the client are pure reads and cannot create rows.
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Persistent notification record
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_reward_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  -- Denormalized for convenient display/query without a join through the
  -- ledger; the qualifying transaction when the crossing event was an
  -- earned-points ledger row (null for the post-redemption re-qualification
  -- case, which has no single causing transaction).
  source_transaction_id uuid references public.transactions(id) on delete restrict,
  -- Exactly one of these two identifies the qualifying event and is the
  -- idempotency key (see the partial unique indexes below):
  --   - source_event_id: a loyalty_point_events row (normal threshold crossing)
  --   - source_redemption_id: a loyalty_redemptions row (a redemption left the
  --     customer at/above threshold again - see redeem_loyalty_reward)
  source_event_id uuid references public.loyalty_point_events(id) on delete restrict,
  source_redemption_id uuid references public.loyalty_redemptions(id) on delete restrict,
  points_balance_at_qualification numeric not null check (points_balance_at_qualification >= 0),
  points_required_for_reward integer not null check (points_required_for_reward > 0),
  reward_description text not null
    check (char_length(btrim(reward_description)) between 1 and 300),
  status text not null default 'active' check (status in ('active', 'resolved')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint loyalty_reward_notifications_source_check
    check (num_nonnulls(source_event_id, source_redemption_id) = 1),
  constraint loyalty_reward_notifications_resolution_consistent
    check ((status = 'active') = (resolved_at is null) and (status = 'active') = (resolved_by is null))
);

comment on table public.loyalty_reward_notifications is
  'Home notification opened when a customer''s loyalty points balance crosses the reward threshold. One active row per customer at a time; see the partial unique index below.';

-- One qualifying ledger event / redemption can only ever open one
-- notification, and one customer can only have one ACTIVE (unresolved)
-- notification at a time. Together these are the idempotency guarantee:
-- any duplicate insert attempt (retry, reconnect, re-fired trigger) hits one
-- of these and is absorbed by `on conflict do nothing` below.
create unique index if not exists loyalty_reward_notifications_event_key
  on public.loyalty_reward_notifications (source_event_id)
  where source_event_id is not null;
create unique index if not exists loyalty_reward_notifications_redemption_key
  on public.loyalty_reward_notifications (source_redemption_id)
  where source_redemption_id is not null;
create unique index if not exists loyalty_reward_notifications_active_customer_key
  on public.loyalty_reward_notifications (customer_id)
  where status = 'active';

create index if not exists loyalty_reward_notifications_status_created_idx
  on public.loyalty_reward_notifications (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Server-side threshold detection (fires on the existing ledger insert)
-- ---------------------------------------------------------------------------
create or replace function private.detect_loyalty_reward_threshold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.loyalty_settings;
  v_balance_after numeric;
  v_balance_before numeric;
begin
  select * into v_settings from public.loyalty_settings where id = 1;
  if v_settings is null then
    return new;
  end if;

  -- We run AFTER INSERT, in the same transaction as the ledger row, so the
  -- balance function (which sums the ledger) already includes this event.
  -- Backing out new.points_earned recovers the balance immediately before it.
  v_balance_after := private.calculate_loyalty_balance(new.customer_id);
  v_balance_before := v_balance_after - new.points_earned;

  if v_balance_before < v_settings.points_required_for_reward
    and v_balance_after >= v_settings.points_required_for_reward then
    insert into public.loyalty_reward_notifications (
      customer_id, source_transaction_id, source_event_id,
      points_balance_at_qualification, points_required_for_reward,
      reward_description, status
    )
    values (
      new.customer_id, new.transaction_id, new.id,
      v_balance_after, v_settings.points_required_for_reward,
      v_settings.reward_description, 'active'
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.detect_loyalty_reward_threshold() from public, anon, authenticated;
drop trigger if exists loyalty_point_events_detect_reward_threshold on public.loyalty_point_events;
create trigger loyalty_point_events_detect_reward_threshold
after insert on public.loyalty_point_events
for each row execute function private.detect_loyalty_reward_threshold();

-- ---------------------------------------------------------------------------
-- 3. Redemption resolves the notification and (documented) reopens one when
--    the customer immediately qualifies for another reward cycle.
-- ---------------------------------------------------------------------------
-- Behaviour for "customer still has enough points for another reward" after
-- a redemption: redeem_loyalty_reward always resolves the customer's active
-- notification first (a redemption closes out the cycle that earned it, even
-- if no notification row happens to exist - e.g. it predates this feature).
-- It then re-checks the remaining balance. If the customer is still at or
-- above the threshold, a NEW active notification is opened immediately for
-- the next cycle, using the redemption itself as the qualifying event
-- (source_redemption_id). This mirrors the normal crossing rule and never
-- silently drops a reward the customer has already earned; nothing about
-- points or history is erased or rewritten - both ledgers stay append-only.
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
  v_remaining_balance numeric;
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

  update public.loyalty_reward_notifications
    set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = auth.uid()
    where customer_id = p_customer_id and status = 'active';

  v_remaining_balance := private.calculate_loyalty_balance(p_customer_id);
  if v_remaining_balance >= v_settings.points_required_for_reward then
    insert into public.loyalty_reward_notifications (
      customer_id, source_transaction_id, source_redemption_id,
      points_balance_at_qualification, points_required_for_reward,
      reward_description, status
    )
    values (
      p_customer_id, null, v_redemption.id,
      v_remaining_balance, v_settings.points_required_for_reward,
      v_settings.reward_description, 'active'
    )
    on conflict do nothing;
  end if;

  return v_redemption;
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_loyalty_reward(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: Owner and active Staff can both read; no client write path at all
--    (every write above runs as the elevated function owner, same pattern
--    as loyalty_redemptions / loyalty_point_events).
-- ---------------------------------------------------------------------------
alter table public.loyalty_reward_notifications enable row level security;

revoke all on table public.loyalty_reward_notifications from public, anon, authenticated;
grant select on table public.loyalty_reward_notifications to authenticated;

drop policy if exists loyalty_reward_notifications_active_select on public.loyalty_reward_notifications;
create policy loyalty_reward_notifications_active_select
  on public.loyalty_reward_notifications
  for select
  to authenticated
  using ((select private.is_active_user()));

-- ---------------------------------------------------------------------------
-- 5. Realtime: Home needs to see a new alert the moment another browser
--    completes the qualifying transaction, without a manual refresh.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'loyalty_reward_notifications'
     ) then
    alter publication supabase_realtime add table public.loyalty_reward_notifications;
  end if;
end;
$$;

commit;
