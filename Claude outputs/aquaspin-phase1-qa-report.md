# Aquaspin Laundry Station — Phase 1 Frontend QA Report

**Branch:** `qa/phase1-browser-hardening`
**Base branch:** `feat/phase1-core-operations-shell`
**Date:** September 16, 2026

---

## 1. Git Info

| | |
|---|---|
| Base branch | `feat/phase1-core-operations-shell` |
| Base SHA | `4bccde02dd31bfc34c94e7985a464619d95b6755` |
| Head SHA | `f261b070a8d155a62df416af78b1e71b8bd363f0` |
| Commits on this branch | 4 |

**Commits:**
1. `bf781bc` — Fix unassociated form labels; add Playwright QA scaffolding
2. `8ef9e43` — Add public-route Playwright coverage (route guards, login, responsive)
3. `fee0af5` — Add authenticated Playwright specs; fix Dashboard tab ARIA semantics
4. `f261b07` — Fix: token refresh wipes in-progress forms across the whole app

**Files changed** (23 files, +3019 / −98):
```
.gitignore
package-lock.json
package.json
playwright.config.ts
src/components/AddOnsManager.tsx
src/components/DeleteTransactionModal.tsx
src/components/EditTransactionModal.tsx
src/components/ServicePricingManager.tsx
src/components/StaffAccountsManager.tsx
src/components/TransactionForm.tsx
src/lib/auth-context.tsx
src/pages/Login.tsx
src/pages/OrdersPage.tsx
src/pages/OwnerDashboard.tsx
tests/e2e/global.setup.ts
tests/e2e/owner/navigation.spec.ts
tests/e2e/owner/new-order-validation.spec.ts
tests/e2e/owner/orders.spec.ts
tests/e2e/public/login.spec.ts
tests/e2e/public/responsive-login.spec.ts
tests/e2e/public/route-guards.spec.ts
tests/e2e/realtime/two-session-sync.spec.ts
tests/e2e/staff/navigation.spec.ts
```
Only one file touches runtime behavior outside components/tests: `src/lib/auth-context.tsx` (real bug fix, see §5). No `supabase/` (SQL/migrations/RLS) files are part of this diff.

---

## 2. Environment Classification

**This is important: two different environments were used, and they are not the same code.**

- **Automated Playwright tests** (18 passing, 22 not run) ran against `npm run dev` on `127.0.0.1:5173` **inside this sandbox**, which has no network path to Supabase. Only unauthenticated/public routes could be exercised this way.
- **Live manual browser QA** ran against the **real Vercel preview deployment** for `feat/phase1-core-operations-shell` (`aquaspin-laundry-station-git-fe-41c70b-imedkilat-8586s-projects.vercel.app`), driven through the Claude Browser pane in Eddy's own Claude desktop app (this sandbox cannot reach Vercel or Supabase directly).
  - **The preview's backend is the real, shared production Supabase database** — not an isolated dataset. Real customer transactions (e.g. "Meme", "Ling") and real accounts (`imedkilat@gmail.com`, "Lovely Febie Kilat") are live in it.
  - **The preview predates every code change on this QA branch.** A live DOM check confirmed the deployed build has no `id`/`htmlFor` attributes and no ARIA tab roles at all — it is running (at latest) the base commit, not this branch's fixes. So: all functional/business-logic/RLS/Realtime findings below are genuine and current, but **none of this branch's own code changes (label fixes, ARIA fixes, or the auth-context.tsx fix) have been exercised live yet** — they're verified only by `tsc --noEmit` and local Playwright. The auth-context.tsx fix in particular needs a real live re-check once this branch is actually deployed.

---

## 3. Browser QA Results

Legend: ✅ PASS · ❌ FAIL · ⬜ NOT RUN (with reason)

### Owner role — live preview, real backend

| Area | Result | Notes |
|---|---|---|
| Login (QA Owner credentials) | ✅ PASS | Signed in by Eddy per platform credential-entry rule |
| Home — render, light/dark theme, desktop (1440) & mobile (375) widths | ✅ PASS | From prior session in this QA pass |
| Home — other breakpoints (390/430/768/1366) | ⬜ NOT RUN | Not exercised live at those widths |
| New Order — Cash payment | ✅ PASS | Created AQ-59E26AA4; later cleaned up |
| New Order — GCash payment + reference validation | ✅ PASS | Created AQ-13A77349; native `checkValidity()` confirmed required-field enforcement |
| New Order — Pay Later payment | ✅ PASS | Created AQ-22358C52; later cleaned up |
| Orders — search / filter | ✅ PASS | Confirmed search narrows results |
| Edit Transaction — change + save + persist | ✅ PASS | Notes field changed, saved, reopened, value round-tripped through backend |
| Soft delete (with required reason) | ✅ PASS | Reason enforced, row hidden from default view, excluded from stats |
| Show deleted — audit trail (who/when/why) | ✅ PASS | Deleter, timestamp, and reason all displayed correctly |
| Restore | ✅ PASS | Row returned to normal view, stats recalculated correctly |
| Realtime — new order appears in a second tab with no manual refresh | ✅ PASS | Created a transaction in one tab; a second, untouched tab showed it (and updated totals) without any reload |
| Stale-edit / concurrency protection | ✅ PASS | Second tab's save on a since-changed record was rejected with a clear in-app error; first tab's save was not corrupted |
| Dashboard — Overview tab | ✅ PASS | Renders live stats and transaction table correctly |
| Dashboard — Staff Accounts tab (render only) | ✅ PASS (render) | ⬜ Promote/Demote actions NOT RUN — real accounts, out of scope to mutate |
| Dashboard — Service Pricing tab (render only) | ✅ PASS (render) | ⬜ Save/Deactivate NOT RUN — real production pricing data |
| Dashboard — Add-ons tab (render only) | ✅ PASS (render) | ⬜ Save/Add-to-Catalog NOT RUN — real production data |
| Dashboard — Settings tab (render only) | ✅ PASS (render) | ⬜ Save Settings / toggles NOT RUN — real shop config |
| Dashboard — PDF/CSV/Google Sheets export | ⬜ NOT RUN | Would trigger a file download; out of scope without a specific request |
| Profile page — render, locked fields (email/role) correct | ✅ PASS | ⬜ Save Profile / Upload Photo NOT RUN |
| Sign out | ✅ PASS | |

### Staff role — live preview, real backend

| Area | Result | Notes |
|---|---|---|
| Login (QA Staff credentials) | ✅ PASS | Signed in by Eddy per platform credential-entry rule |
| Home — render, correct role label | ✅ PASS | |
| Allowed nav (Home, New Order, Orders, Reports) | ✅ PASS | |
| Owner-only Dashboard tabs hidden (Staff Accounts / Pricing / Add-ons / Settings) | ✅ PASS | Only "Overview" tab present |
| "Show deleted" toggle hidden | ✅ PASS | |
| PDF/CSV/Google Sheets export buttons hidden | ✅ PASS | |
| New Order form — renders correctly | ✅ PASS (render) | ⬜ Actual submission as Staff NOT RUN |
| Orders — full transaction history visible | ✅ PASS | This shop's "View full history" Staff permission is on; date-range controls present |
| Edit transaction as Staff | ⬜ NOT RUN | Edit button visible/enabled; not separately exercised this pass |
| **Soft-delete transaction as Staff** | ❌ **FAIL** | See Bug 2 below — UI offers the action, backend RLS silently rejects it and leaks a raw Postgres error |
| Sign out | ✅ PASS | |

### Public / unauthenticated (automated + live)

| Area | Result | Notes |
|---|---|---|
| Route guards (`/`, `/new`, `/orders`, `/dashboard`, `/profile`, unknown routes → `/login`) | ✅ PASS | Automated, local sandbox |
| Login screen — labeled fields, required-field validation, theme toggle, password masking | ✅ PASS | Automated, local sandbox |
| Responsive login — 375/390/430/768/1366/1440, no overflow, tap targets | ✅ PASS (6/6) | Automated, local sandbox |

---

## 4. Automated Test Inventory

| Spec file | Covers | Status |
|---|---|---|
| `tests/e2e/public/route-guards.spec.ts` | Unauthenticated redirects | ✅ RAN, PASS (local sandbox, no live-network dependency) |
| `tests/e2e/public/login.spec.ts` | Login field labels/types, HTML5 validation, theme toggle, password masking | ✅ RAN, PASS (local sandbox) |
| `tests/e2e/public/responsive-login.spec.ts` | Login screen at 6 breakpoints | ✅ RAN, PASS 6/6 (local sandbox) |
| `tests/e2e/owner/navigation.spec.ts` | Owner nav/role checks | ⬜ NOT RUN — requires `owner` project storageState; this sandbox has no network path to Supabase to authenticate |
| `tests/e2e/owner/new-order-validation.spec.ts` | Client-side New Order validation | ⬜ NOT RUN — same reason. Equivalent coverage exercised manually live this pass (§3). |
| `tests/e2e/owner/orders.spec.ts` | Orders search/filter/Show deleted | ⬜ NOT RUN — same reason. Equivalent coverage exercised manually live this pass (§3). |
| `tests/e2e/staff/navigation.spec.ts` | Staff nav restrictions | ⬜ NOT RUN — same reason. Equivalent coverage exercised manually live this pass (§3). |
| `tests/e2e/realtime/two-session-sync.spec.ts` | Two-session Realtime sync | ⬜ NOT RUN by design (`test.skip`, documented in-file) — **but the exact scenario was independently verified manually live this pass** (§3), outside Playwright |
| `tests/e2e/global.setup.ts` | Captures owner/staff storageState for the above specs | ⬜ Never exercised — no live network from this sandbox |

**18/18** automated tests that could run in this sandbox passed. **22** authenticated specs remain genuinely not run by Playwright; most of their scope was covered separately via manual live QA (§3), which is not a substitute for running the actual specs and should still be done once a CI environment with real Supabase access exists.

---

## 5. Bugs Found

### Bug 1 — Token refresh wipes in-progress forms (Owner/Staff, all pages) — **FIXED, not yet re-verified live**
- **Severity:** High (silent data loss)
- **Repro:** Start filling any form (e.g. New Order) and leave the tab backgrounded for a while, or let a Supabase access-token refresh happen. `auth-context.tsx`'s profile-fetch effect was keyed on the whole `session` object, which Supabase replaces on every background token refresh (same user, new token) — this re-triggered `setLoading(true)`, which made `Gate` (`src/App.tsx`) unmount the entire authenticated page tree, silently discarding any unsaved form state.
- **Fix:** `src/lib/auth-context.tsx` — re-key the effect on `session?.user.id` instead of `session`, so it only re-fires on an actual sign-in/sign-out/account switch. Commit `f261b07`.
- **Status:** Fixed in this branch, verified via `tsc --noEmit` (clean). **Not yet verified against a live deployment** — this preview predates the fix (§2). Needs a real check once deployed: half-fill a form, background the tab for a minute+, confirm the form survives.

### Bug 2 — Staff soft-delete: UI offers the action, backend RLS blocks it, raw Postgres error leaks to the user — **found, not fixed, deferred**
- **Severity:** Medium (no data integrity or security risk — RLS correctly blocked the unauthorized write — but a broken, confusing UX for any Staff account in this state)
- **Repro:** Signed in as Staff (account has "Soft-delete transactions" appearing available), opened the delete-reason modal on any transaction, submitted with a reason filled in. The request failed and the modal's error banner showed the raw string `new row violates row-level security policy for table "transactions"` verbatim — the transaction was **not** deleted (confirmed against 4 separate transactions).
- **Root cause not pinned down** (deliberately, per this QA lane's frontend-only scope — no RLS/SQL inspected or touched): either this specific QA Staff account's permission grant is out of sync with the shop's configured Staff Access settings, or there's a genuine mismatch between what the UI offers and what the RLS policy allows for this role.
- **Recommended follow-up for Eddy:**
  1. Catch this class of Postgres/RLS error in the frontend and show a friendly "you don't have permission to do this" message instead of the raw error string.
  2. Double check whether the QA Staff account's actual permission grant matches the "Soft-delete transactions" toggle shown in Owner → Settings → Staff Access.
- **Status:** Not fixed in this pass — outside frontend-only QA scope. Documented in Notion and here for follow-up.

### Bug 3 — Unassociated form labels across 11 files — **FIXED**
- **Severity:** Low (accessibility)
- Fixed via `id`/`htmlFor` pairing across `EditTransactionModal.tsx`, `DeleteTransactionModal.tsx`, `AddOnsManager.tsx`, `StaffAccountsManager.tsx`, `ServicePricingManager.tsx`, `TransactionForm.tsx`, `Login.tsx`, `OrdersPage.tsx`. Commit `bf781bc`.

### Bug 4 — Dashboard tab buttons missing ARIA tab semantics — **FIXED**
- **Severity:** Low (accessibility)
- Added `role="tablist"`/`role="tab"`/`aria-selected` to the Overview/Staff Accounts/Service Pricing/Add-ons/Settings tab buttons in `OwnerDashboard.tsx`. Deliberately did not wire `aria-controls`/`role="tabpanel"` to avoid an unverifiable visual regression risk (see code comment). Commit `fee0af5`.

---

## 6. Safety Confirmation Checklist

- [x] No RLS policies, SQL, or migrations were touched — the only runtime-behavior change in this diff is the client-side React fix in `src/lib/auth-context.tsx`.
- [x] No production data was mutated beyond the QA-only transactions created for this pass, and all of them were cleaned up (see below).
- [x] All 4 QA-only transactions (`AQ-59E26AA4`, `AQ-13A77349`, `AQ-22358C52`, `AQ-0DD84919`) are soft-deleted with a clear, auditable reason each, confirmed via "Show deleted," and confirmed excluded from live Sales/Orders/Pay Later totals.
- [x] No real customer transactions ("Meme" `AQ-F9C5DE0E`, "Ling" `AQ-D94AAA21`) were modified.
- [x] No real Owner/Staff accounts (`imedkilat@gmail.com`, "Lovely Febie Kilat") were modified — Promote/Demote controls were visible but never used.
- [x] No live shop settings, service pricing, or add-ons catalog were changed — Save/Deactivate controls were visible but never used.
- [x] No file downloads were triggered (PDF/CSV/Google Sheets export).
- [x] All credentials were typed into login forms by Eddy himself, never by Claude — enforced both by Claude's own policy and, on one attempt, by the platform's own input classifier.
- [ ] **Open item:** the two QA-only accounts (`qa-phase1-owner-aquaspin@example.invalid`, `qa-phase1-staff-aquaspin@example.invalid`) still exist in the system. They were left in place as reusable fixtures for future QA passes rather than deleted — flag if Eddy wants them removed instead.

---

## Next Steps

1. Deploy `qa/phase1-browser-hardening` (push via GitHub Desktop — this sandbox cannot push directly) and re-verify the auth-context.tsx fix live (Bug 1).
2. Look into Bug 2 (Staff RLS/delete mismatch) when convenient — not urgent, but worth a look before Staff accounts with delete permission are used in production.
3. Run the 22 not-run Playwright specs in a real CI environment with Supabase network access, once available.
4. Decide whether to keep or remove the two QA-only accounts.
