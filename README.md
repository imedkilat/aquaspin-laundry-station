# Aquaspin Laundry Station — Dashboard

A digital replacement for the paper transaction ledger. Staff add customer
transactions in real time; the owner gets a live dashboard with sales
summaries, payment drilldowns, service pricing, an add-ons catalog, staff
account management, and a spreadsheet export.

- **Frontend:** React + TypeScript (Vite), Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Row Level Security + Realtime + Edge Functions)
- **Automation:** n8n (owner-triggered transaction spreadsheet export)
- **Roles:** `owner` (full access + dashboard) and `staff` (add/view transactions)
- **Deployment:** Vercel, linked to `main`
- **Shop timezone:** Asia/Manila — "today" always means the current Manila date

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a **new project**
   (a dedicated Supabase account/project for this client).
2. Open **SQL Editor** in the left sidebar.
3. Run [`supabase/schema.sql`](./supabase/schema.sql) first, then every file
   in [`supabase/migrations/`](./supabase/migrations/) **in filename order**
   (they're dated, so sorting by name is chronological). Paste each file's
   contents and click **Run**.

   Every file here is written to be safe to re-run: `if not exists` /
   `on conflict do nothing` / `not valid` guards throughout. If you're not
   sure what's already been applied, running the full set again in order is
   safe — nothing will be double-applied or overwritten. The one migration
   that can legitimately stop with an error
   (`20260916013000_transaction_codes_and_test_cleanup.sql`) does so on
   purpose if a GCash transaction is missing its reference number — read the
   error, fix that specific row, and re-run just that file.

## 2. Create the first owner account

1. In Supabase, go to **Authentication → Users → Add user** (create
   manually, set a password — no email confirmation needed).
2. Every new user automatically gets a `profiles` row with role `staff` (via
   a trigger). To make this first account the **owner**:
   - Go to **Table Editor → profiles**
   - Find that user's row, change `role` from `staff` to `owner`, save.
3. From here on, the owner creates every other staff account **from inside
   the app** (Dashboard → Staff Accounts → Create Staff Credentials) — it
   calls the `create-staff-user` Edge Function, so there's no need to touch
   Supabase directly again.

## 3. Deploy the Edge Functions

Two Edge Functions live in [`supabase/functions/`](./supabase/functions/):

- **`create-staff-user`** — lets an owner create a new staff login without
  ever handling the service-role key in the browser. Verifies the caller is
  an owner, creates the Auth user, and upserts their `profiles` row (rolling
  the Auth user back if the profile insert fails).
- **`export-transactions`** — lets an owner export the currently filtered
  transaction table as a spreadsheet via n8n (§4 below). Verifies the caller
  is an owner before doing anything.

Deploy both from the Supabase CLI:

```bash
supabase functions deploy create-staff-user --project-ref YOUR-PROJECT-REF
supabase functions deploy export-transactions --project-ref YOUR-PROJECT-REF
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
provided automatically to every Edge Function — nothing to set there. The
n8n secrets in §4 are separate and specific to `export-transactions`.

## 4. Set up the n8n spreadsheet export

1. Import [`n8n/aquaspin-transaction-export.json`](./n8n/aquaspin-transaction-export.json)
   into your n8n instance (Workflows → Import from File). It ships with no
   credential attached, by design.
2. In n8n, create a **Header Auth** credential named e.g. "Aquaspin Export
   Token" — header name `x-aquaspin-export-token`, value: a random secret
   you generate yourself (e.g. `openssl rand -hex 32`). Attach it to the
   **Aquaspin Export Webhook** node.
3. Activate the workflow and copy its **production** webhook URL.
4. In Supabase, set two secrets for the `export-transactions` function
   (Dashboard → Edge Functions → export-transactions → Secrets, or via CLI):

   ```bash
   supabase secrets set N8N_EXPORT_WEBHOOK_URL="https://your-n8n-host/webhook/aquaspin-transaction-export" --project-ref YOUR-PROJECT-REF
   supabase secrets set N8N_EXPORT_TOKEN="the-same-random-secret-from-step-2" --project-ref YOUR-PROJECT-REF
   ```

   Until both secrets are set, the owner dashboard's "Export Spreadsheet"
   button returns a clear "n8n export automation is not configured yet"
   error instead of failing silently.

The webhook URL and token never touch the browser — the frontend only ever
calls the `export-transactions` Edge Function, which holds the n8n secrets
server-side.

## 5. Configure and run the app

```bash
npm install
cp .env.example .env
```

Edit `.env` (Supabase Dashboard → **Settings → API**):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
VITE_SHOP_NAME=Aquaspin Laundry Station
```

Then:

```bash
npm run dev       # local development, http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

## 6. Deploy

`npm run build` outputs a static `dist/` folder — deploy it anywhere that
serves static files (Vercel, Netlify, Cloudflare Pages, etc.). Set the same
three `VITE_*` environment variables in your host's dashboard before
building/deploying there.

On Vercel, `VITE_*` values are compiled into the client bundle at build
time. If an environment variable is added or its Production scope changes,
create a new deployment so the production bundle receives the updated
value.

---

## How it works

- **Staff view** (`/`) — add a transaction (customer, phone, service, kg,
  add-ons, payment method, pickup date) and see **only today's** (Asia/Manila)
  transactions, updating live via Supabase Realtime as anyone adds one. The
  view rolls itself to the new business day automatically if left open
  overnight, with a manual Refresh button as backup.
- **8 kg / load rule** — every weight-based service auto-calculates
  `Math.ceil(kg / 8)` loads and prices `loads × rate`, all under one
  transaction. Owner can change a service's per-load rate anytime from
  Dashboard → Service Pricing; open staff screens pick up the new rate
  live, no redeploy.
- **Add-ons** — owner-managed catalog (Dashboard → Add-ons) with a price and
  unit (piece/load/sachet/dose/cycle/kg/flat). Staff pick add-ons with a
  quantity on the transaction form; the selected name/unit/price/quantity is
  **snapshotted onto the transaction** (`add_on_items` JSONB) so a later
  catalog price change never rewrites old transaction history.
- **Payment Method** — `Paid` (cash), `GCash`, or `Pay Later`. Cash payments
  block saving if the cash received is less than the total, and show change
  due when it's more. GCash payments require the amount to match the total
  exactly and a GCash Transaction # (duplicate references are rejected).
  Both rules are enforced twice — in the form, and as database constraints
  — so they hold even for a direct API call, not just the UI.
- **Owner dashboard** (`/dashboard`, owner-only) — Today's Sales, clickable
  Cash / GCash / Pay Later / Selected Sales cards that filter the table
  below, a date range + customer search, a Staff Accounts tab, Service
  Pricing tab, and Add-ons tab. "Pay Later" is always shown as outstanding,
  never folded into "sales collected."
- **Transaction IDs** — public, non-sequential codes like `AQ-7F3C9A2D`
  (`transaction_code`). The internal numeric `transaction_no` still exists
  for stable ordering but isn't shown in the UI.
- **Spreadsheet export** — Dashboard → Export Spreadsheet sends the
  currently applied filters (date range, payment method, customer search) to
  the `export-transactions` Edge Function, which asks n8n to build a CSV and
  streams it back for download. See §4 for setup.
- **Theme** — light/dark toggle, persisted in the browser, available on
  every screen including Login.

## Notes / assumptions to confirm with the shop

- Any signed-in staff can see the **full** transaction list (not just their
  own entries) — needed for pickup lookups — and can update any transaction
  (e.g. mark paid on pickup). Only the owner can delete a record.
- Service default rates (₱195 WDF, ₱90 self-service, ₱220 comforter) and the
  add-ons in the examples were starting points — confirm actual current
  pricing with the shop and adjust from Dashboard → Service Pricing /
  Add-ons.
- No SMS/notification integration yet (e.g. texting the customer when their
  laundry's ready) — flag if that's wanted for a later phase.
