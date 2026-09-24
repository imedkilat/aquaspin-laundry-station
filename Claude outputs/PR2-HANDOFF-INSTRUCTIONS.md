# PR 2 — Add New Service (multi-service transactions) — push/PR hand-off

This cloud session still can't push directly to `imedkilat/aquaspin-laundry-station`, so here's the branch to bring onto your machine and push yourself.

Branch: `feat/multi-service-transactions`, based on `main` @ `11de7970c45ce051229d7bc0e6fc77219c47bfbb` (same base as PR 1 — the two branches are independent and can merge in either order).

Commits:
- `b5faec2` — DB schema, RPCs, and the New Order form UI
- `a081e78` — wires the feature into Edit Order, the order detail page, printed receipts, and kg/report totals; also fixes two real bugs the new backend tests caught (see below)

## Get the branch onto your machine

**Option A — git bundle (recommended):**
```bash
git fetch /path/to/multi-service-transactions.bundle feat/multi-service-transactions:feat/multi-service-transactions
git checkout feat/multi-service-transactions
git push -u origin feat/multi-service-transactions
```

**Option B — patch files** (if the bundle doesn't apply cleanly):
```bash
git checkout main
git pull
git checkout -b feat/multi-service-transactions
git am /path/to/multi-service-transactions-patch/0001-*.patch /path/to/multi-service-transactions-patch/0002-*.patch
git push -u origin feat/multi-service-transactions
```

## Open the PR

**Title:** `Add "Add New Service" — one transaction, multiple services per order`

**Description:** see `PR2-DESCRIPTION.md`.

## Important — this isn't fully live until you do this

The new migration (`20260930030000_transaction_service_items.sql`) needs an actual `supabase db push` (or your usual migration deploy) against your real database before anyone can use "Add New Service" — I did not run that from this session, per the same "no production changes from here" boundary as the last two PRs.

Nothing else needs a manual step this time — no n8n workflow change and no Edge Function change in this PR. (The existing n8n export and Edge Function keep working unchanged; additional-service amounts are already folded into `transactions.total_amount`, which is what those already read.)

## What "Add New Service" actually does, in plain terms

The owner asked for a way to let one customer avail two services in one visit (e.g. Wash-Dry-Fold *and* a Comforter/Special Item) as **one transaction**, instead of creating a second separate order. In New Order and Edit Order there's now an "Add New Service" button under the primary service's Add-ons section — each additional line picks its own service, weight/loads or flat price, and its own add-ons, and the order's Total automatically becomes the sum of the primary service plus every additional line. Everywhere else in the app that shows an order's total, weight, or receipt (order detail, printed receipt, Reports, the Home "kg today" stat) already reads `transactions.total_amount` and now also picks up the additional lines' weight, so nothing downstream needed to change to "know about" the new feature except the few screens that show the individual line items themselves.
