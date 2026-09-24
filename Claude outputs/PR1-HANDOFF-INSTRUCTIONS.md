# PR 1 — Customer visits fix + report totals — push/PR hand-off

This cloud session still can't push directly to `imedkilat/aquaspin-laundry-station` (same restriction as before), so here's the branch to bring onto your machine and push yourself.

Commit: `ac5eeca69f370e16a8c28357946501e8d19ae13d` on branch `feat/customer-visits-and-report-totals`, based on `main` @ `11de7970c45ce051229d7bc0e6fc77219c47bfbb`.

## Get the branch onto your machine

**Option A — git bundle (recommended):**
```bash
git fetch /path/to/customer-visits-and-report-totals.bundle feat/customer-visits-and-report-totals:feat/customer-visits-and-report-totals
git checkout feat/customer-visits-and-report-totals
git push -u origin feat/customer-visits-and-report-totals
```

**Option B — patch file** (if the bundle doesn't apply cleanly):
```bash
git checkout main
git pull
git checkout -b feat/customer-visits-and-report-totals
git am /path/to/0001-Fix-customer-visits-count-and-add-Gross-Sales-Cash-O.patch
git push -u origin feat/customer-visits-and-report-totals
```

## Open the PR

**Title:** `Fix customer visits count and add report totals`

**Description:** see `PR1-DESCRIPTION.md`.

## Important — this isn't fully live until you do two more things

Pushing the branch only updates the repo. Two pieces of this actually run outside the repo and need a manual update on your end once you're happy with the PR:

1. **The n8n workflow itself.** `n8n/aquaspin-transaction-export.json` is a checked-in copy for setup/reference — your real automation lives in your n8n instance. Re-import this updated JSON (or make the equivalent node edits) in n8n so the live export webhook actually produces the new Summary totals. Until you do that, the live export keeps behaving exactly as it does today.
2. **The Edge Function.** `supabase/functions/export-transactions/index.ts` changed (it now also selects `order_status`). This needs `supabase functions deploy export-transactions` (or your usual deploy step) — I did not deploy anything from this session.

The new migration (`20260930020000_customer_visits_by_date.sql`) does need an actual `supabase db push` (or equivalent) against your real database before the visits count fix shows up live — I did not run that from this session either, per the same "no production changes from here" boundary as before.
