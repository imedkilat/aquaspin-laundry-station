-- Track GCash transaction references for auditability.
-- Existing historical GCash rows are not forced to have a reference,
-- but every new or updated GCash transaction must include one.

alter table public.transactions
  add column if not exists gcash_reference text;

create unique index if not exists transactions_gcash_reference_unique_idx
  on public.transactions (gcash_reference)
  where gcash_reference is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_gcash_reference_required_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_gcash_reference_required_check
      check (
        payment_method <> 'gcash'
        or nullif(btrim(gcash_reference), '') is not null
      ) not valid;
  end if;
end
$$;
