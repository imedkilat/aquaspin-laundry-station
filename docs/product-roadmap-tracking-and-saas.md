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
- [x] Independently review the combined PR #35/#36 candidate and resolve the identified code findings in the local candidate.
- [ ] Reconcile the handoff's reported build, lint, migration, and test results against CI and the implementation branch.

**Exit criteria:** the implementation starts from a known commit, with no unreviewed local edits or assumptions about Production schema.

## Phase 1 — Order printing and customer tracking

### 1A. Thermal receipt and bag tag

**Status: Draft PR #35/#36; print fixes integrated in local combined candidate; Staging/printer QA pending**

- Review the current receipt, transaction, add-on, inventory-use, and customer-item types.
- Implement 58 mm and 80 mm receipt and bag-tag layouts, QR generation, and print preview as an isolated UI slice.
- Keep the existing receipt path available until the new output passes QA.
- Cover HTML escaping, missing optional fields, totals, and QR URL generation in tests.
- Verify the modal and print output with Owner and Staff preview sessions and real printer settings where available.

**Exit criteria:** build and relevant tests pass; Owner and Staff can open the correct transaction; receipt and bag tag render without clipping at both widths; no order data is changed by printing.

### 1B. Public order tracker

**Status: Signed-capability candidate implemented locally; independent code review passed; Staging/runtime verification pending**

- Review transaction-code entropy, status history, grants, RLS, shop settings, and the canonical status rules.
- Replace the anonymous transaction-code RPC with an Edge Function capability flow; keep the 8-character order code separate from authorization to retrieve tracking data.
- Return only the approved public allowlist (currently order code and current lifecycle status); verify malformed, cancelled, deleted, on-hold, and completed behavior.
- Issue a high-entropy signed link only after authenticated active-profile and order-access checks; keep the capability out of HTTP paths and referrers.
- Rate-limit only after capability verification, using a transaction-scoped HMAC key through the existing service-role `check_rate_limit` function (60 requests/minute); invalid tokens do not reach the limiter or privileged lookup.
- Keep current/previous signing-key rotation covered by regression tests; the previous key remains optional during the rotation window.
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

Phase 0 baseline is recorded. PR #35 and dependent PR #36 remain drafts. The combined local candidate `e6582948553b5046591603129c75b7758a20ffbf` contains the tracker security work and print fixes; it has not been pushed. Claude's independent review of the exact `c446e6d..e658294` patch found no code blockers. Staging verification of the old RPC and migration ledger is closed based on user-provided SQL Editor screenshots: neither `public.get_public_order_status` nor migration version `20260930010000` returned rows. No Staging DROP migration is indicated by those results. Staging Edge Function setup is now a confirmed blocker: Claude's read-only Dashboard check found neither `issue-order-tracking-link` nor `lookup-order-tracking-status` deployed and no custom secrets configured. Deploy both functions to Staging and configure `TRACKING_TOKEN_SECRET_HEX` before signed-link QA; do not expose secret values. Then verify runtime/JWT behavior, signed-link and popup browser QA, and physical 58 mm/80 mm printer output. No remote database has been accessed by this review. Keep both PRs draft and do not start multi-tenant schema work until Phase 3 decisions are complete.

## Progress log

| Date | Change | Status |
|---|---|---|
| 2026-09-27 | Added this phased roadmap from the Antigravity handoff; no application code or database was changed. | Planning |
| 2026-09-28 | Antigravity pushed printing and public tracking to draft PR #35. Initial review found public financial/order fields in the anon RPC response and functional QA gaps. No database or production changes. | Blocked pending fixes |
| 2026-09-28 | Claude's read-only review of the original PR RPC identified a wrapped-column lookup, missing rate limit, and missing multi-service details. The local candidate removes that RPC, uses a signed capability and ID lookup, and intentionally returns only order code/status, so service-line exposure is removed from the public contract. Local commits `a1b81b0`, `e99343e`, `55e18f9`, and `60325ee` now contain the helpers, hashed client-address limiter, signed Edge/UI integration, previous-key rotation support, and seven regression tests. The branch is not pushed. Claude's independent review of this exact contract, Deno runtime validation, print integration, and Staging QA remain pending. No remote database, deployment, merge, or production change. | In progress; PR #35 remains draft |

| 2026-09-28 | Antigravity reported print-fix draft PR #36 (`e564e8f`) with 8 changed files and a successful Vercel Preview check. The lead reviewed its changed-file patches and confirmed the modal and print helper still build QR URLs from `transaction_code`/`transaction_no`, which conflicts with the signed-capability tracker design. PR #36 must integrate the authenticated capability issuer and fail closed if link issuance fails. Antigravity's local test claims and browser/printer behavior remain unverified here. No remote database, merge, deployment, or production change. | Blocked on secure QR integration and verification |
| 2026-09-28 | Claude's independent review confirmed the public print QR still uses the obsolete code route and identified that caller-controlled `X-Forwarded-For` can bypass per-address throttling. The local tracker branch now derives its HMAC rate-limit key only from a validated/canonicalized `cf-connecting-ip`; regression coverage now verifies spoofed `X-Forwarded-For` is ignored. Focused tests pass 8/8 and lint exits 0 with existing warnings. TypeScript and migration checks pass, but the latest Vite build process exited with an out-of-memory error; Staging header/runtime verification and Claude review of this correction remain pending. No remote database, merge, deployment, or production change. | In progress; runtime/build verification pending |\n
| 2026-09-28 | Claude independently reviewed exact combined local candidate `e6582948553b5046591603129c75b7758a20ffbf` against base `c446e6d355f20e7f3a4891fb389e93a782110ca4`. No code blocker was found: public allowlist, signature-before-read, token-scoped rate limit, key rotation, JWT settings, shared signed print/detail links, and print-data failure guards were checked. Claude reports 11/11 public-tracking tests, 40/40 thermal-receipt tests, 6/6 receipt tests, and full-project `tsc --noEmit` passing against the patch. **Operational gate remains:** verify on Staging, read-only, whether `public.get_public_order_status(text)` exists regardless of the migration ledger and whether version `20260930010000` is recorded. No database was accessed. If the function exists, prepare a separately reviewed forward DROP migration. Also pending are Edge Function runtime/secrets, signed-link/browser and popup QA, and physical printer QA. Current GitHub PR heads remain #35 `c446e6d` and #36 `4336205`; the combined candidate is local-only and both PRs remain draft. No migration applied, merge, deployment, or Production change. | Review passed; operational verification pending |
| 2026-09-28 | User supplied Staging SQL Editor screenshots showing zero rows for both read-only checks: `public.get_public_order_status` was not found and migration version `20260930010000` was not recorded. This closes the Staging legacy-RPC question; no DROP migration is indicated for Staging. This does not establish Production database state. No database was accessed by the lead and no migration was applied. Edge Function runtime/secrets and browser/printer QA remain open. | Staging RPC check closed; release gates remain |
| 2026-09-28 | Claude's read-only Staging Dashboard check found only `create-staff-user` and `manage-staff-user` deployed; tracking issuer/lookup functions are absent, and there are zero custom secrets. This blocks runtime QA: the functions must be deployed and `TRACKING_TOKEN_SECRET_HEX` configured on Staging before exercising the flow. No function, secret, database, migration, or Production setting was changed by this check. | Staging setup required |
