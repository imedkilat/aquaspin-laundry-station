-- Phase 7 follow-up: allow authenticated users to evaluate the security-invoker balance view.
-- The underlying ledger tables remain Owner-only; this grants only the calculation helper.

grant execute on function private.calculate_loyalty_balance(uuid) to authenticated;

