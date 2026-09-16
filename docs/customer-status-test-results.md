# Customer/status verification evidence

Command: `npm test --prefix tests/backend` (Node 24.11.1, pinned PGlite 0.5.8).
All database data below is synthetic, in an isolated in-memory PostgreSQL instance.
Supabase auth/storage are minimally shimmed; actual repository policies, SQL functions,
triggers and migrations execute. No production credentials or connection are used.

**32 automated checks PASS; 0 automated assertion failures.** A separate requested
operational regression, staff soft-delete with RETURNING, **FAILS on baseline and on
the new schema**. The parity test passes because this PR does not introduce that failure.
Do not interpret the passing suite as proof that staff deletion is working.

| Test | Result | Evidence / scope |
| --- | --- | --- |
| Full baseline plus forward migration | PASS | Schema and all 13 baseline migrations replayed before new migration |
| Legacy nullable customer and initial status | PASS | NULL customer, received status, unchanged old updated_at, honest baseline ledger; deleted legacy included |
| Canonical customer creation | PASS | Random CUS code, creator attribution, immutable public code |
| Normalized phone lookup | PASS | Three requested PH forms plus punctuation; invalid format returns NULL |
| Shared phone | PASS | Two distinct customers coexist under one normalized phone |
| Customer snapshot preservation | PASS | Canonical name/phone edits leave receipt name/phone unchanged |
| Summary and Pay Later balance | PASS | 2 visits, billed 300, outstanding 150, last visit, history rows |
| Deactivation | PASS | History retained, new links denied, customer hard-delete denied |
| Staff and owner customer permissions | PASS | Disabled staff INSERT/UPDATE blocked; reads retained; owner writes allowed; enabled staff create works |
| Unauthenticated / missing-profile access | PASS | Anonymous, NULL subject and missing-profile clients rejected |
| received → washing | PASS | Status, token, actor and ledger |
| washing → drying | PASS | Status, token, actor and ledger |
| drying → ready_for_pickup | PASS | Status, token, actor and ledger |
| ready_for_pickup → completed | PASS | Status, token, actor and ledger |
| Owner override / reopen | PASS | Terminal transition denied without reasoned owner override |
| Hold / resume / cancel | PASS | Reasons required; payment values unchanged |
| Invalid / skipped / same status / NULL token | PASS | RPC rejects with expected errors |
| Raw status mutation | PASS | Direct UPDATE denied, status+delete bypass denied, noninitial INSERT rejected |
| Stale browser safety | PASS | Stale status rejected without ledger append; old edit token updates zero rows; edit invalidates status token |
| Staff status permissions | PASS | Edit-disabled denied even with delete permission; override denied; permitted staff actor recorded |
| Owner soft-delete / restore / audit | PASS | Deleted status update denied; owner sees history; staff cannot; totals exclude deleted; restore retains status |
| Append-only history | PASS | Client insert/update/delete/truncate denied; administrator UPDATE blocked by trigger; FK prevents receipt hard-delete |
| Scoped summary/history/status RPC | PASS | Staff full-history and historical-Pay-Later switches limit query and mutation |
| Cash / GCash / Pay Later | PASS | Valid inserts; missing GCash reference and insufficient cash rejected |
| Status-only legacy intake compatibility | PASS | New required phone/pickup/note settings do not strand old status updates or reprice amounts |
| Add-on snapshots | PASS | Catalog price edit and status update retain original unit price; quantity correction uses historical price |
| 8 kg/load | PASS | Catalog defaults and expressions extracted from both existing forms: 1, 8, 8.01, 16, 17 kg boundaries |
| Export/RPC SQL dependencies | PASS | Existing export columns selectable and rate-limiter signature exists; not a live export test |
| Function grants / Realtime membership | PASS | Authenticated helper EXECUTE true; anonymous status RPC false; each publication member exactly once |
| Monotonic timestamps / rollback | PASS | Two writes in one SQL transaction get different tokens; rollback removes status changes and ledger entries |
| Staff deletion baseline parity | PASS | Same 42501 before and after migration |
| Backfill / rerun | PASS | Dry run changes nothing; commit links 1, leaves 12, reports 2 ambiguous phone groups; exact snapshots retained; rerun links 0 |
| Staff soft-delete with RETURNING succeeds | **FAIL — pre-existing** | Both baseline and new schema return 42501 under authenticated staff, despite delete permission. Existing RLS hides new deleted row. Unrelated local fix intentionally excluded. |
| `git diff --check` | PASS | No whitespace errors |
| Frontend dependency installation | PASS | Retry succeeded with unchanged pinned app dependencies after transient tarball 404 |
| TypeScript | PASS | `tsc -b` completed before Vite's sandbox subprocess restriction |
| Supabase TypeScript API contracts | PASS | Compile-only `tests/backend/contracts.ts`: customer insert, summary query and RPC infer correct results; raw status/history writes rejected by types |
| Vite build | PASS | `npm run build` exit 0 outside sandbox; 101 modules, 6.06 seconds; local artifact only |
| Frontend lint | PASS | `npm run lint` exit 0; existing React effect/fast-refresh warnings reported |
| Real simultaneous PostgreSQL sessions | NOT RUN | PGlite is single-connection; sequential stale-token and transaction rollback tests pass |
| Supabase REST/PostgREST / JWT integration | NOT RUN | Requires isolated Supabase staging |
| Realtime delivery / disconnect / reconnect | NOT RUN | Publication SQL tested; transport requires staging |
| Browser end-to-end create/edit/delete/restore | NOT RUN | No frontend redesign; requires staging verification |
| n8n CSV / Google Sheets export | NOT RUN | SQL dependencies checked, external service not invoked |
| Production schema drift / advisors | NOT RUN | Production not queried |
| Production backfill counts | NOT RUN | Zero automatic customer links by design; no production data read or modified |

Production confirmations: no live migration applied; no production data modified;
no production deployment performed; no merge performed. The backend PR is a draft
pending independent review and staging checks.
