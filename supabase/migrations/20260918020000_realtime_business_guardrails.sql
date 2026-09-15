-- Guardrails for running this as a real, live-traffic business tool:
-- duplicate-submission protection, sane input caps (a fat-fingered or
-- runaway client shouldn't be able to write a garbage/huge row), and a
-- reusable rate limiter for the Edge Functions. All additive/idempotent.

-- 1. Idempotency key for transaction inserts. The client generates one
--    UUID per open "Add Transaction" form and reuses it for every submit
--    attempt from that form instance; a double-click or a retried request
--    after a dropped connection then collides on this unique index instead
--    of creating a second row. Nullable + partial index, so nothing breaks
--    for any insert path that doesn't send one.
alter table public.transactions
  add column if not exists client_request_id uuid;

create unique index if not exists transactions_client_request_id_unique_idx
  on public.transactions (client_request_id)
  where client_request_id is not null;

-- 2. Sane upper bounds on free-text and numeric fields. Generous enough to
--    never bother a real transaction, tight enough to stop a garbage or
--    abusive payload from bloating the table or breaking CSV/Sheets
--    rendering downstream. NOT VALID so this can never fail applying on
--    existing rows; new/updated rows are checked immediately either way.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_customer_name_length_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_customer_name_length_check
      check (char_length(customer_name) <= 120) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_phone_number_length_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_phone_number_length_check
      check (phone_number is null or char_length(phone_number) <= 32) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_notes_length_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_notes_length_check
      check (notes is null or char_length(notes) <= 500) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_gcash_reference_length_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_gcash_reference_length_check
      check (gcash_reference is null or char_length(gcash_reference) <= 64) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_add_on_items_length_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_add_on_items_length_check
      check (jsonb_array_length(add_on_items) <= 30) not valid;
  end if;

  -- Amount sanity ceiling: ₱500,000 on a single transaction is already far
  -- beyond a realistic laundry ticket. Catches a typo/extra-zero before it
  -- becomes a bad record that's awkward to explain or fix later.
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_amounts_sane_ceiling_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_amounts_sane_ceiling_check
      check (
        base_amount <= 500000 and add_ons <= 500000 and total_amount <= 500000
        and cash_amount <= 500000 and gcash_amount <= 500000
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_kg_sane_ceiling_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_kg_sane_ceiling_check
      check (kg is null or kg <= 500) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_loads_sane_ceiling_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_loads_sane_ceiling_check
      check (no_of_loads is null or no_of_loads <= 200) not valid;
  end if;
end
$$;

-- 3. Generic rate limiter, callable only with the service-role key (i.e.
--    only from an Edge Function), so a client can never reset or read its
--    own counter. Prunes stale hits on every call so the table stays
--    small regardless of traffic volume.
create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  rate_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_created_idx
  on public.rate_limit_hits (rate_key, created_at);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

create or replace function public.check_rate_limit(p_key text, p_max_count int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  delete from public.rate_limit_hits
   where rate_key = p_key
     and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
    from public.rate_limit_hits
   where rate_key = p_key
     and created_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_count then
    return false;
  end if;

  insert into public.rate_limit_hits (rate_key) values (p_key);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
