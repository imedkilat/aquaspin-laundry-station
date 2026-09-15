# Aquaspin Laundry Station — Dashboard

A digital replacement for the paper transaction ledger. Staff add customer
transactions in real time; the owner gets a live dashboard with revenue
summaries, payment-status filters, and staff account management.

- **Frontend:** React + TypeScript (Vite), Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Row Level Security + Realtime)
- **Roles:** `owner` (full access + dashboard) and `staff` (add/view transactions)
- **Deployment:** Vercel, linked to `main`

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a **new project**
   (use the new Supabase account for this client, separate from any other
   projects).
2. Once it's provisioned, open **SQL Editor** in the left sidebar.
3. Paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql)
   and click **Run**. This creates all tables, roles, RLS policies, the
   starter services catalog, and enables Realtime on `transactions`.

## 2. Create the first owner account

1. In Supabase, go to **Authentication → Users → Add user** (create manually,
   set a password — no email confirmation needed for staff accounts).
2. Every new user automatically gets a row in `profiles` with role `staff`
   (via a trigger). To make the first account the **owner**:
   - Go to **Table Editor → profiles**
   - Find that user's row, change `role` from `staff` to `owner`, save.
3. Repeat step 1 for each staff member. The owner can promote/demote roles
   later from inside the app (Dashboard → Staff Accounts) — no need to touch
   Supabase directly after this first one.

## 3. Configure and run the app

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your project's values (Supabase Dashboard →
**Settings → API**):

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

## 4. Deploy

`npm run build` outputs a static `dist/` folder — deploy it anywhere that
serves static files (Vercel, Netlify, Cloudflare Pages, etc.). Set the same
three `VITE_*` environment variables in your host's dashboard before
building/deploying there.

---

## How it works

- **Staff view** (`/`) — a form to add a transaction (customer, phone,
  service, kg, loads, amounts, payment method, pickup date) plus today's
  live-updating list. Any signed-in staff member can add or view; the list
  updates instantly across every open screen via Supabase Realtime.
- **Owner dashboard** (`/dashboard`, owner-only) — revenue stats (today +
  selected range), outstanding "Pay Later" total, a filterable/searchable
  full transaction table, and a Staff Accounts tab to promote/demote roles.
- **Services catalog** — seeded from your paper log's codes (WDF, SSW, SSD,
  CSDB) with best-guess labels and rates. **Double-check these** — the
  abbreviations on the ledger photo weren't all fully legible/certain.
  Owner can rename, add, or deactivate services anytime by editing the
  `services` table in Supabase (a dedicated in-app editor can be added
  later if you want one).
- **Payment Method** — single dropdown per transaction: `Paid`, `GCash`,
  `Pay Later`, matching your spec. Cash/GCash amount fields are kept as
  optional extra detail (matching the paper ledger's Cash/GCash columns).
- **Transaction No.** — auto-generated, sequential, shown as `#0001` etc.
  (no manual numbering needed).

## Notes / assumptions to confirm with the shop

- Any signed-in staff can see the **full** transaction list (not just their
  own entries) — needed for pickup lookups. Only the owner can delete a
  record.
- Service default rates (₱195 WDF, ₱90 self-service, ₱220 comforter) were
  read off the sample ledger — confirm actual current pricing.
- No SMS/notification integration yet (e.g. texting the customer when their
  laundry's ready) — flag if that's wanted for a later phase.
