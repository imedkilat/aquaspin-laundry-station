## Summary

- Adds an "Add New Service" option to New Order and Edit Order so a customer availing two services in one visit (e.g. Wash-Dry-Fold *and* a Comforter/Special Item) is recorded as **one transaction** instead of two. Each additional service line has its own service, weight/loads or flat pricing, and its own add-ons; the order's Total is automatically the primary service's total plus every additional line's total.
- The order detail page, printed receipts (from the transactions table and from the detail page), and Reports/Home kg totals all now show/include the additional service lines, so nothing looks incomplete once an order has more than one service on it.
- New database objects: a `transaction_service_items` child table (one row per additional line, snapshotting the service code/label/price the way `transactions` already does for the primary service), two RPCs (`create_transaction_with_service_items`, `replace_transaction_service_items`) that keep the parent transaction's `total_amount`/payment-integrity checks (cash-sufficiency, GCash-exact-match) evaluated against the true grand total — never a stale primary-only total — and optional per-line inventory consumption (a second service can draw down Liquid Detergent/Fabric Conditioner stock on its own, same as the primary service already does).
- A single-service order (the overwhelming majority of orders) is completely unaffected — it keeps using the existing plain insert/update path with no new tables or RPCs involved.

## Why

Relayed from the shop owner: customers sometimes want two services in one drop-off, and today that means either creating two separate transactions (double records, double receipts, confusing history) or manually folding the second service into the first one's total with no record of what it actually was.

## Two real bugs this caught and fixed (would have blocked the feature entirely, not just the tests)

Writing the pglite backend test suite for the new RPCs surfaced two bugs in the migration that would have affected every real use of this feature, not just the tests:

1. **Missing EXECUTE grant one level deep.** The two public RPCs are `security invoker` (run as the calling logged-in user), and they call a private helper function that does the actual insert/delete of service-item rows. That helper had its EXECUTE privilege revoked from `authenticated` with no grant back — `security definer` on the helper only elevates privileges *inside* its body, it does not waive the calling role's own need for EXECUTE to invoke it. Every real call to either RPC would have failed with "permission denied for function replace_transaction_service_items_rows". Fixed by granting EXECUTE on the helper to `authenticated` (safe: the `private` schema isn't reachable through Supabase's REST/RPC surface at all, so this only enables the call path from other server-side SQL — the same pattern already used for `private.has_staff_permission` and `private.can_view_transaction`).
2. **Inventory consumption fired on every status change, not just completion.** The per-line inventory-consumption trigger was missing the "only run when the order is transitioning to completed" guard that the equivalent primary-service trigger already has. As written, it would fire (and could reject the whole status update for insufficient stock) the moment an order moved to *any* status, e.g. blocking `received → washing`, instead of only checking stock at actual completion. Fixed by adding the same guard the primary-service trigger uses.

## Verification

- `npm run check:migrations` — pass (46 files)
- `npm run build` — pass
- `npx tsc -b` — pass, no type errors
- `npx oxlint` — pass, 0 errors (only pre-existing warnings unrelated to this change)
- `git diff --check` — clean
- `node tests/sales-metrics.test.mjs` — 12/12 pass
- `node tests/customer-items-pending.test.mjs` — 8/8 pass
- `node tests/staff-accounts.test.mjs` — 5/5 pass
- `tests/backend/test.mjs` (pglite) — 72/72 pass, including a new block covering: grand-total cash sufficiency and GCash-exact-match across services on create; the manual-total-override check correctly folding in line totals on both create and edit (the direct regression test for a trigger-sequencing fix in `replace_transaction_service_items` — editing an order's line totals must not falsely trip "Manual Total override is disabled"); adding/removing lines on a plain single-service order; concurrency (stale token), permission (Staff without create/edit permission), and completed/cancelled-order guards; per-line inventory consumption on completion plus insufficient-stock rejection; and RLS boundaries (Staff without permission, and anon, both denied on direct table access and on the create RPC)
- `tests/backend/edge-manage-staff-user.mjs` — 39/39 pass (unaffected, run for regression safety)

## Not done here (needs you, after merging)

- `supabase db push` (or your usual migration deploy) for `20260930030000_transaction_service_items.sql` against the real database — nothing here touches production.

## Still open from your original message (not part of this PR)

Two things from your original message are still open and not addressed by any of the three PRs so far:

1. **The Customer Directory duplicate-rows screenshot.** Flagged in PR 1's description — I read through the customer list code and didn't find a bug that would cause visible duplicates; my best guess is a scrolling-screenshot artifact, but I can't check your live browser from here. Still waiting on your confirmation of whether it's a real, reproducible issue.
2. A stray unrelated commit that appears to have landed on the loyalty-points branch history, flagged earlier — worth a quick look next time you're reviewing branches, but not something I changed here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01DeFV6HNfuxKwGxuKyxSEx9
