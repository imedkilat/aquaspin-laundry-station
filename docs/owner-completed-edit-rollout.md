# Owner completed-order edits

Deployed on October 4, 2026 (Asia/Manila).

Owner edits use `edit_completed_order` with an expected update timestamp and a required reason. Each successful correction appends an immutable audit entry containing the actor, timestamp, reason, and before/after snapshots. Staff, anonymous users, cancelled orders, and deleted orders cannot use this endpoint. Consumed inventory and additional service lines remain locked. Primary weight corrections append loyalty adjustments at the original award rate; later customer reassignment transfers the corrected points total.

Validation: 81 isolated PostgreSQL tests, 4 transaction-edit permission tests, application typecheck/build, and lint passed. A staging transaction verified Staff denial, blank reason rejection, successful Owner audit creation, and stale save rejection. All staging test edits were rolled back.

The Supabase connector generated different versions for the same SQL when applying it to each environment:

| Environment | Applied version |
| --- | --- |
| Staging (`wmubrkhgncrtwdlsusea`) | `20261003171323` |
| Production (`yhckdhidchxsypfeyzxj`) | `20261003171452` |

The repository migration filename matches production. Remote ledger entries were preserved. Staging has already received this migration under its version above; do not apply the production-named copy to staging a second time. Account for this environment-specific version when planning a future CLI migration synchronization.

The post-migration security advisor reported the existing guarded public SECURITY DEFINER endpoints, the intentionally inaccessible rate-limit table, and disabled leaked-password protection. It did not flag the new audit table or the new public SECURITY INVOKER endpoint.
