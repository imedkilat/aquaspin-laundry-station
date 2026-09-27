# Aquaspin Product Roadmap: Customer Tracking, Printing, and SaaS Readiness

This roadmap stages the product ideas captured in the September 2026 Antigravity handoff. Each slice is reviewed against the current repository and database before implementation. A checked item means code and its stated checks are complete; it does not mean production rollout is complete.

## Guardrails

- Keep the live single-shop Aquaspin workflow stable while adding one independently reviewable slice at a time.
- Do not apply a database migration to Production as part of feature implementation. Rehearse and verify database changes on Staging first, then review the exact Production delta separately.
- Public pages and RPCs must return only fields approved for anonymous customer access. Do not expose customer phone numbers, payment references, notes, staff details, or other orders.
- Record implementation, test, browser QA, and rollout status separately. Do not describe a feature as deployed based only on a local build or preview.
- Treat Antigravity's handoff as a proposal. Confirm files, schema, current branch, and migration history against the repository before reusing its code or migration.

## Phase 0 — Baseline and roadmap

**Status: In progress**

- [x] Record the proposed feature sequence and release gates here.
- [x] Antigravity pushed the implementation to draft PR #35, based on the current `main` commit.
- [ ] Independently review and resolve the security and functional findings in PR #35.
- [ ] Reconcile the handoff's reported build, lint, migration, and test results against CI and the implementation branch.

**Exit criteria:** the implementation starts from a known commit, with no unreviewed local edits or assumptions about Production schema.

## Phase 1 — Order printing and customer tracking

### 1A. Thermal receipt and bag tag

**Status: In draft PR #35; review blocked**

- Review the current receipt, transaction, add-on, inventory-use, and customer-item types.
- Implement 58 mm and 80 mm receipt and bag-tag layouts, QR generation, and print preview as an isolated UI slice.
- Keep the existing receipt path available until the new output passes QA.
- Cover HTML escaping, missing optional fields, totals, and QR URL generation in tests.
- Verify the modal and print output with Owner and Staff preview sessions and real printer settings where available.

**Exit criteria:** build and relevant tests pass; Owner and Staff can open the correct transaction; receipt and bag tag render without clipping at both widths; no order data is changed by printing.

### 1B. Public order tracker

**Status: In draft PR #35; blocked on public-data minimization and token/rate-limit design**

- Review transaction-code entropy, status history, grants, RLS, shop settings, and the canonical status rules.
- Design the RPC response around a minimum public allowlist. Start with order code, current lifecycle status, and shop contact details; add other fields only with an explicit privacy reason.
- Verify unknown, malformed, cancelled, on-hold, and completed order behavior.
- Add the public route and QR deep link only after the RPC contract and authorization tests are settled.
- Apply and verify the migration on Staging, then run anonymous and authenticated browser QA.

**Exit criteria:** anonymous callers can retrieve only the matching order's approved fields; no cross-order or sensitive-data exposure; lifecycle states display correctly; Staging migration and browser checks pass. Production rollout remains a separate reviewed step.

## Phase 2 — SMS pickup notifications

**Status: Waiting for M360 credentials and sender-ID readiness**

- Confirm the approved sender ID, API credentials, billing, consent basis, and message wording.
- Document the app-to-n8n webhook contract and M360 request/response mapping without putting secrets in the repository.
- Add an authenticated, replay-safe event path for the transition to `ready_for_pickup`.
- Store delivery attempts and provider identifiers safely; prevent duplicate messages on retries.
- Test with provider sandbox or an approved test number before enabling customer sends.

**Exit criteria:** delivery is idempotent, failures are visible and retryable, credentials are stored in n8n's secret store, and a tested opt-in operational runbook exists.

## Phase 3 — Multi-tenant SaaS discovery

**Status: Future; no schema changes authorized by this roadmap**

- Decide tenant ownership, onboarding, account recovery, subscription lifecycle, data export/deletion, and support access.
- Define whether a tenant has one or many branches and which records are branch-scoped versus tenant-wide.
- Inventory every business table, view, RPC, Edge Function, Storage bucket, Realtime publication, export, and scheduled workflow that needs tenant isolation.
- Write an architecture decision record and a cross-tenant threat model before choosing schema or migration order.

**Exit criteria:** product and data ownership decisions are documented; a full object inventory and rollback/restore approach are reviewed.

## Phase 4 — Multi-tenant foundation and migration

**Status: Blocked on Phase 3**

Potential slices, each with its own review and Staging evidence:

1. Add tenant and branch identity plus a verified Aquaspin backfill plan.
2. Add tenant/branch ownership to business records and update all write paths.
3. Enforce tenant isolation in RLS, RPCs, Edge Functions, Storage, Realtime, and exports.
4. Add tenant-specific shop settings and transaction-code prefixes.
5. Add Owner branch selection and cross-tenant isolation regression tests.
6. Run a Staging migration rehearsal, backup/restore check, authenticated Owner/Staff QA, and production-delta review.

**Exit criteria:** automated tests prove one tenant cannot read or change another tenant's records through any client or server path; the full migration and rollback/recovery plan has passed Staging.

## Immediate next slice

Start with **Phase 0 baseline**, then implement **Phase 1A thermal receipt and bag tag** as the first code change because it can be developed without a database migration. Keep public tracking behind its own RPC security review and Staging gate. Do not start multi-tenant schema work until Phase 3 decisions are complete.

## Progress log

| Date | Change | Status |
|---|---|---|
| 2026-09-27 | Added this phased roadmap from the Antigravity handoff; no application code or database was changed. | Planning |
| 2026-09-28 | Antigravity pushed printing and public tracking to draft PR #35. Initial review found public financial/order fields in the anon RPC response and functional QA gaps. No database or production changes. | Blocked pending fixes |
