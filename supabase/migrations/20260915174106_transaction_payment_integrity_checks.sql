-- Defense-in-depth: enforce payment integrity at the database level too,
-- not only in the staff transaction form. Mirrors the rules already
-- enforced client-side in TransactionForm.tsx:
--   - Cash payments cannot be saved with cash_amount < total_amount.
--   - GCash payments must have gcash_amount exactly equal to total_amount.
--
-- Uses NOT VALID guarded constraints, same pattern as the GCash-reference
-- check in 20260916_add_gcash_reference.sql, so existing historical rows
-- are not retroactively validated or broken. New/updated rows are checked
-- immediately regardless of NOT VALID (NOT VALID only skips the initial
-- scan of existing rows, not future writes).

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_cash_covers_total_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_cash_covers_total_check
      check (payment_method <> 'paid' or cash_amount >= total_amount)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_gcash_matches_total_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_gcash_matches_total_check
      check (payment_method <> 'gcash' or gcash_amount = total_amount)
      not valid;
  end if;
end
$$;
