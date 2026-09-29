-- One-time data correction: 9 transactions were marked 'completed' while
-- payment_method was still 'pay_later' (₱0 actually collected via
-- cash_amount / gcash_amount). These predate any guardrail preventing that
-- combination and are otherwise stuck: canEditTransaction() blocks Edit
-- entirely once order_status = 'completed', so there is no UI path to fix
-- them. See the Owner-reported issue and the sibling guardrail spec that
-- adds the corresponding check to set_transaction_status going forward.
--
-- Re-mark them as Cash (payment_method = 'paid', cash_amount = total_amount,
-- gcash_amount = 0) so the ledger reflects a real, collected payment. Scoped
-- to the exact 9 transaction_codes reviewed with the Owner before this ran
-- (Production: applied and independently re-verified 2026-09-29 — all 9 rows
-- confirmed corrected, no unintended matches, no new status-history or
-- loyalty-event rows, transactions_09_prevent_terminal_edits confirmed
-- re-enabled afterward). order_status is untouched, so none of the
-- order_status-triggered side effects (loyalty points, inventory
-- consumption, status history) fire.
--
-- Replay-safe: this file is a record of a one-time Production correction
-- that already happened, not a repeatable step. On a fresh rebuild (Staging
-- reset, local dev, or re-running this migration set against Production
-- again after it already applied) none of these transaction_codes will
-- still be in the pay_later + completed state, so 0 rows match and this is
-- a no-op rather than a hard failure. Only an unexpected partial match
-- (1-8 rows) aborts, since that would mean the data drifted from what was
-- reviewed and applied.
begin;
set local lock_timeout = '5s';

do $$
declare
  v_count integer;
begin
  alter table public.transactions disable trigger transactions_09_prevent_terminal_edits;

  update public.transactions
  set payment_method = 'paid',
      cash_amount = total_amount,
      gcash_amount = 0
  where order_status = 'completed'
    and payment_method = 'pay_later'
    and deleted_at is null
    and transaction_code in (
      'AQ-0F06CF18', 'AQ-1A5BCCC0', 'AQ-D28ACCF1', 'AQ-6B0885FD',
      'AQ-446FDE8F', 'AQ-C3A0F67B', 'AQ-7756C90A', 'AQ-3CEAF3A8', 'AQ-AC28143E'
    );

  get diagnostics v_count = row_count;
  if v_count not in (0, 9) then
    raise exception 'Expected to correct 0 (already applied) or 9 (first run) transactions, affected %; aborting', v_count;
  end if;

  alter table public.transactions enable trigger transactions_09_prevent_terminal_edits;
end $$;

commit;
