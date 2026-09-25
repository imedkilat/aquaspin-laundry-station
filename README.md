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
3. For a **brand-new, empty project only**, run [`supabase/schema.sql`](./supabase/schema.sql) first, then every file
   in [`supabase/migrations/`](./supabase/migrations/) in filename order.
   If you apply SQL through the Dashboard SQL Editor, remember that this does
   not automatically add rows to Supabase's CLI migration ledger. Choose one
   setup path and verify its resulting schema and migration history before
   treating the project as ready for future CLI migrations.

   **Do not run the full migration folder against an existing Staging or
   Production project, and do not assume migrations are safe to replay just
   because some statements use `if not exists` or `on conflict`.** Existing
   Aquaspin environments have known migration-history drift and manual
   changes. First compare the remote schema and migration ledger with the
   repository, then follow a reviewed reconciliation and rollout plan. Do
   not use `supabase db push` to work around that drift. `supabase migration
   repair` only changes migration-history bookkeeping; it does not apply SQL,
   so mark a version applied only after confirming its SQL is already present
   on that exact project.

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

Both functions only accept CORS requests from the production origin
(`https://aquaspin-laundry-station.vercel.app`, hardcoded as `ALLOWED_ORIGINS`
at the top of each `index.ts`). If you deploy a second environment (staging,
a custom domain) add its origin to that set in both files before deploying.

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
2. In n8n, on the **Aquaspin Export Webhook** node, attach a **Header Auth**
   credential — create a new one (don't reuse an existing credential from
   another workflow), named e.g. "Aquaspin Export Token", header name
   `x-aquaspin-export-token`, value: a random secret you generate yourself
   (e.g. `openssl rand -hex 32`).
   **Double-check the header name after saving** — n8n's credential picker
   can silently pre-select an unrelated existing credential instead of the
   one you just created; if that happens the header name won't be
   `x-aquaspin-export-token` and the export will fail authentication.
3. **Activate the workflow** (top-right toggle). The production webhook URL
   only responds while it's active.
4. Copy the workflow's **production** webhook URL and, in Supabase, set two
   secrets for the `export-transactions` function (Dashboard → Edge
   Functions → export-transactions → Secrets, or via CLI):

   ```bash
   supabase secrets set N8N_EXPORT_WEBHOOK_URL="https://your-n8n-host/webhook/aquaspin-transaction-export" --project-ref YOUR-PROJECT-REF
   supabase secrets set N8N_EXPORT_TOKEN="the-same-random-secret-from-step-2" --project-ref YOUR-PROJECT-REF
   ```

   Until both secrets are set, the owner dashboard's export buttons return a
   clear "n8n export automation is not configured yet" error instead of
   failing silently.
5. **Optional — Google Sheets export.** The dashboard has two export
   buttons: "Export CSV" (works with steps 1–4 alone) and "Export to Google
   Sheets" (creates a new spreadsheet per export and returns its link). For
   the Sheets button to work, attach a **Google Sheets (OAuth2)** credential
   to both the **Create Sheet** and **Append Rows** nodes — same
   double-check as step 2: confirm it's connected to the Google account you
   actually want this business data landing in, not whatever credential the
   picker suggests first. No Supabase secrets needed for this part; it
   reuses the same webhook/token from steps 2–4.

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

## Run the tests

From the repository root, install the dependencies for the backend test package
once, then run its PostgreSQL-in-memory and Edge Function tests:

```bash
npm ci --prefix tests/backend
npm test --prefix tests/backend
```

The other focused suites and application checks run from the repository root:

```bash
npm run test:customer-items
npm run test:sales-metrics
npm run test:staff-accounts
npx oxlint
npx tsc -b
npm run build
```

## 6. Deploy

`npm run build` outputs a static `dist/` folder — deploy it anywhere that
serves static files (Vercel, Netlify, Cloudflare Pages, etc.). Set the same
three `VITE_*` environment variables in your host's dashboard before
building/deploying there.

Before promoting a release that includes database migrations, verify the
target project and migration state and apply the reviewed database changes
before deploying the frontend that depends on them. For existing Aquaspin
Staging or Production projects, use a separate, project-specific rollout
plan; do not run the fresh-project setup steps above or `supabase db push`.

On Vercel, `VITE_*` values are compiled into the client bundle at build
time. If an environment variable is added or its Production scope changes,
create a new deployment so the production bundle receives the updated
value.

---

## How it works

- **Staff view** (`/`) — add a transaction (customer, phone, service, kg,
  add-ons, payment method, pickup date + optional time) and see **only
  today's** (Asia/Manila)
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
- **Customer clothing items** — from an order's detail page, Staff and Owner
  users can record the submitted clothing breakdown after intake (Shorts,
  T-shirts, Pants, Underwear, Dresses, Towels, Bedsheets, Jackets, or a named
  Other item). Counts are informational only and do not affect pricing or
  inventory usage. The audited status RPC blocks completion until at least one
  positive item quantity has been saved; completed rows remain read-only history.
- **Payment Method** — `Paid` (cash), `GCash`, or `Pay Later`. Cash payments
  block saving if the cash received is less than the total, and show change
  due when it's more. GCash payments require the amount to match the total
  exactly and a GCash Transaction # (duplicate references are rejected).
  Both rules are enforced twice — in the form, and as database constraints
  — so they hold even for a direct API call, not just the UI.
- **Dashboard** (`/dashboard`, both roles) — Today's Sales, clickable
  Cash / GCash / Pay Later / Selected Sales cards that filter the table
  below, and a date range + customer search. Like the Staff view, the
  transaction table here updates live via Supabase Realtime — a new sale
  from any till shows up on every open Dashboard/Staff screen without a
  page reload. "Pay Later" is always shown as outstanding, never folded
  into "sales collected." The Staff Accounts,
  Service Pricing, and Add-ons tabs, and the CSV/Google Sheets export
  buttons, only render for the `owner` role — staff get the Overview tab
  only. This is a UI convenience on top of real enforcement: the write-side
  RLS policies on `services`/`add_ons_catalog` and the `export-transactions`
  Edge Function already reject a non-owner regardless of what the UI shows.
- **Transaction IDs** — public, non-sequential codes like `AQ-7F3C9A2D`
  (`transaction_code`). The internal numeric `transaction_no` still exists
  for stable ordering but isn't shown in the UI.
- **Edit and Delete** — every row on the Transactions table (both roles)
  has Edit and Delete. Edit reopens the same fields as Add Transaction,
  pre-filled, including the 8kg/load auto-pricing and add-ons picker.
  Delete requires a short reason and is a **soft delete**: the row
  disappears from the normal list, but nothing is destroyed — it's kept
  with who deleted it, when, and why, and never counted in the sales
  totals. The owner can reveal deleted rows with a "Show deleted" checkbox
  on the Dashboard and **Restore** any of them. A true, permanent SQL
  delete stays owner-only at the database level and isn't wired to any
  button — the app never does one.
- **Entered By** — the Dashboard's transaction table has an extra "Entered
  By" column, owner-only, showing which staff account created each row
  (and who last edited it, if different). Staff don't see this column for
  each other's transactions — same as they can't see each other's Staff
  Accounts entries, it follows directly from each profile only being
  visible to its own owner/staff account under RLS.
- **Spreadsheet export** — Dashboard → **Export CSV** or **Export to Google
  Sheets** sends the currently applied filters (date range, payment method,
  customer search) to the `export-transactions` Edge Function, which asks
  n8n to build the export and returns either CSV text (downloaded directly)
  or a new Google Sheet's link (opened in a new tab). See §4 for setup —
  the Google Sheets option needs one extra credential.
- **Theme** — light/dark toggle, persisted in the browser, available on
  every screen including Login.

## Security hardening

Beyond RLS and the owner/staff Edge Function checks described above:

- **`anon` has zero access.** This app has no logged-out/public feature, so
  the `anon` Postgres role's table privileges on `profiles`, `services`,
  `add_ons_catalog`, and `transactions` are fully revoked — not just blocked
  by RLS. A future RLS mistake (a dropped policy, RLS toggled off) can't
  expose data to an anonymous caller, because there's no grant to fall back
  on. Verified: `set role anon; select ... from transactions` fails with
  `permission denied`, not an empty result set.
- **CORS is locked to the production origin** on both Edge Functions (see
  §3) instead of `*`.
- **`transactions.updated_by`** records which logged-in user last edited a
  row (e.g. who marked a Pay Later as paid on pickup, or used the Edit
  button) — a lightweight audit trail, set automatically by a trigger. It
  doesn't restrict who can update; see the staff-update note below.
- **`transactions.deleted_at` / `deleted_by` / `delete_reason`** back the
  Delete button's soft delete. The database itself requires a non-empty
  `delete_reason` whenever `deleted_at` is set (`transactions_delete_reason_required_check`)
  — the UI's "reason required" prompt is a friendly form of that, not the
  only thing enforcing it.
- Enable **Leaked Password Protection** in Supabase (Dashboard →
  Authentication → Providers → Password) — the one remaining item that has
  to be a manual dashboard toggle rather than a migration.

## Notes / assumptions to confirm with the shop

- Any signed-in staff can see the **full** transaction list (not just their
  own entries) — needed for pickup lookups — and can update or (soft)
  delete any transaction, not only their own. That's intentional per the
  shop's workflow (any staff member may need to fix or remove another's
  entry), and it's why Delete requires a reason and never truly destroys
  the row — see "Edit and Delete" above.
- Service default rates (₱195 WDF, ₱90 self-service, ₱220 comforter) and the
  add-ons in the examples were starting points — confirm actual current
  pricing with the shop and adjust from Dashboard → Service Pricing /
  Add-ons.
- No SMS/notification integration yet (e.g. texting the customer when their
  laundry's ready) — flag if that's wanted for a later phase.
