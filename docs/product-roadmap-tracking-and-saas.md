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

**Status: Draft PR #35/#36; local fixes prepared, Staging QA pending**

- Review the current receipt, transaction, add-on, inventory-use, and customer-item types.
- Implement 58 mm and 80 mm receipt and bag-tag layouts, QR generation, and print preview as an isolated UI slice.
- Keep the existing receipt path available until the new output passes QA.
- Cover HTML escaping, missing optional fields, totals, and QR URL generation in tests.
- Block printing from both the detail page and modal when either clothing-item or service-line loading failed; distinguish a successful empty list from a failed/unavailable list.
- Verify the modal and print output with Owner and Staff preview sessions and real printer settings where available.

**Exit criteria:** build and relevant tests pass; Owner and Staff can open the correct transaction; receipt and bag tag render without clipping at both widths; no order data is changed by printing.

### 1B. Public order tracker

**Status: Signed-capability candidate implemented locally; independent final review and Staging QA pending**

- Review transaction-code entropy, status history, grants, RLS, shop settings, and the canonical status rules.
- Replace the anonymous transaction-code RPC with an Edge Function capability flow; keep the 8-character order code separate from authorization to retrieve tracking data.
- Return only the approved public allowlist (currently order code and current lifecycle status); verify malformed, cancelled, deleted, on-hold, and completed behavior.
- Issue a high-entropy signed link only after authenticated active-profile and order-access checks; keep the capability out of HTTP paths and referrers.
- Rate-limit only after capability verification, using a transaction-scoped HMAC key through the existing service-role `check_rate_limit` function (60 requests/minute); invalid tokens do not reach the limiter or privileged lookup.
- Keep the current/previous signing-key rotation behavior covered by regression tests; the previous key remains optional during a rotation window.
- Use the same `transaction_id` request contract in the UI helper and authenticated issuer; platform JWT verification stays enabled for issuance and disabled only for anonymous lookup.
- Ensure printed QR codes use the signed `/track#v1...` link; never fall back to a public transaction-code lookup.
- No migration or remote database change is part of the current local slice. If later needed, review and verify it on Staging before any separate Production review.

**Exit criteria:** anonymous callers can retrieve only the matching order's approved fields using a protected capability; malformed/unknown/cancelled/deleted orders fail closed; rate limits and key-rotation behavior are documented and tested; Edge Functions and UI pass focused tests plus Staging QA. No Production rollout is implied.

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

Phase 0 baseline is recorded. PR #35 and dependent PR #36 remain drafts. A local PR #35 tracker candidate and rebased PR #36 print candidate are available, but neither has been pushed. Final review, Edge Function setup, Staging QA, and printer verification remain open. Merge PR #36 into the PR #35 feature branch before merging PR #35 to `main`, so Production does not receive the signed tracker before its receipt QR path is wired. Do not start multi-tenant schema work until Phase 3 decisions are complete.

## Progress log

| Date | Change | Status |
|---|---|---|
| 2026-09-27 | Added this phased roadmap from the Antigravity handoff; no application code or database was changed. | Planning |
| 2026-09-28 | Antigravity pushed printing and public tracking to draft PR #35. Initial review found public financial/order fields in the anon RPC response and functional QA gaps. No database or production changes. | Blocked pending fixes |
| 2026-09-28 | Claude's read-only review of the original PR RPC identified a wrapped-column lookup, missing rate limit, and missing multi-service details. The candidate removes the anonymous RPC migration from the feature branch, uses a signed capability and ID lookup, returns only order code/status, and rate-limits verified tokens by a transaction-scoped HMAC key. Current local combined candidate: `e658294` on `fix/thermal-print-review`, based on tracker candidate `fb1872e`; GitHub PR heads remain #35 `c446e6d` and #36 `4336205`, both drafts. The client/issuer payload mismatch was found during rebase and fixed; a single client helper now serves detail-page links and printed QR codes. Detail-page print failure handling now uses tested shared state logic. Local checks pass: tracker 11/11, thermal receipt 23/23, receipt 6/6, customer-items 8/8, migration check, build, and lint (warnings only). The local build reports a 892 KB JS bundle warning. The PR #36 branch has not been pushed after rebase. No remote database was accessed or changed; no deployment, merge, or Production change. | In progress; both PRs remain draft |
| 2026-09-28 | Remaining gates: Claude's independent review of exact combined SHA `e658294`; verify the Edge Functions in Deno/Supabase runtime; provide the tracking signing secret(s) in Staging's protected function secrets; verify whether the old anonymous RPC exists in Staging and prepare a separately reviewed removal migration only if required; exercise signed QR lookup and popup behavior in Staging; verify 58 mm/80 mm slips with the actual printer. Do not use `db push` or apply/repair a Production migration. | Blocked on review and Staging evidence |
