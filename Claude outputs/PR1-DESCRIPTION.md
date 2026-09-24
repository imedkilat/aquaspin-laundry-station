## Summary

- Customer Directory "visits" now counts distinct dates the customer actually did laundry (excluding cancelled orders), not raw transaction rows. Two loads dropped off same day = 1 visit; a cancelled order no longer counts as a visit or moves "last visit".
- Added the 4 totals the owner asked for (Gross Sales, Total Cash Sales Received, Total Online Payments, Total Amounts Receivable) to the n8n Google Sheets/CSV export (new "Summary" sheet + summary rows above the CSV header) and to the printable PDF report (replacing the old Selected Sales/Cash/GCash/Pay Later stat row, which also silently included cancelled orders — this fixes that too).
- Amounts Receivable is the same netted-outstanding-balance convention already used elsewhere in the app (Pay Later total minus whatever cash/GCash was already collected on it), not the raw Pay Later face value.
- Export now also carries `order_status` end to end (Edge Function → n8n → sheet/CSV "Order Status" column) so cancelled rows are visible in the export and excludable from the totals.

## Why

Relayed from the shop owner after reviewing the dashboard: she wants those 4 totals available (previously not generated anywhere in the app), and visits should reflect actual laundry days, not the number of line-item transactions.

## Verification

- `npm run check:migrations` — pass (46 files)
- `npm run build` — pass
- `npm run lint` — pass, 0 errors, no new warnings
- `git diff --check main..feat/customer-visits-and-report-totals` — clean
- `npm run test:customer-items` — 8/8 pass
- `npm run test:sales-metrics` — 12/12 pass
- `tests/backend/test.mjs` (pglite) — 66/66 pass, including a new test asserting: same-day transactions = 1 visit, a transaction on a distinct date = 2 visits, and a cancelled transaction on yet another date leaves the count and `last_visit` unchanged
- `tests/backend/edge-manage-staff-user.mjs` — 39/39 pass (unaffected, run for regression safety)
- n8n workflow JSON: valid JSON, every embedded `jsCode` block passes `node --check`, and the totals math was verified against a hand-built harness with synthetic rows (cash/gcash/pay-later-with-partial-payment/cancelled) — output matched the expected Gross Sales / Cash / Online / Receivable figures exactly, with the cancelled row still showing in the transaction table but excluded from all 4 totals.

## Not done here (needs you, after merging)

- The live n8n workflow needs to be re-imported/updated by hand — the JSON in the repo is a reference copy, not what your n8n instance is currently running.
- `supabase/functions/export-transactions` needs `supabase functions deploy export-transactions`.
- The new migration needs `supabase db push` (or your usual migration deploy) against the real database.

## Open item — needs your confirmation

You mentioned the Customer Directory screenshot looked like it had duplicated rows. I read through `CustomersPage.tsx` and `useCustomers.ts` and didn't find a bug that would cause that (rows are keyed and rendered from a single query with no obvious duplication path) — my best guess is it was a scrolling-screenshot artifact, but I can't check your live browser from here. Can you confirm whether it's still showing duplicates for real? If so, screenshots of the exact rows (with names visible) would help track it down.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01DeFV6HNfuxKwGxuKyxSEx9
