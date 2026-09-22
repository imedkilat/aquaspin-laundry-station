## Summary

Implements the Loyalty Reward Home Notification feature: server-side, idempotent detection of a customer crossing the configured loyalty points threshold, surfaced as a dedicated Home card for Owner and Staff. Redemption stays Owner-only, unchanged.

- New migration `20260930010000_loyalty_reward_home_notifications.sql`: `public.loyalty_reward_notifications` table + `private.detect_loyalty_reward_threshold()` trigger on the existing `loyalty_point_events` ledger insert + RLS (Owner/Staff read, no client write path) + realtime registration.
- Detection happens in the database, not React, and reuses the existing award-trigger's guards, so cancelled/deleted/incomplete/non-qualifying transactions never produce a notification.
- Idempotent by construction: a partial unique index on `source_event_id`/`source_redemption_id` plus a partial unique index on `(customer_id) WHERE status='active'`, both enforced via `on conflict do nothing`. Refreshes, retries and realtime reconnects are pure reads and cannot create duplicates.
- `public.redeem_loyalty_reward` now resolves the matching notification on redemption and, if the remaining balance still clears the threshold, opens a new active notification for the next reward cycle — documented in the migration's own comments and below.
- New `LoyaltyRewardHomeCard` (styled after `OnHoldHomeCard`) + `useLoyaltyRewardNotifications` hook (client-side join of notifications/customers/live balances, realtime subscription). Owner gets an "Open Loyalty & Redeem" action; Staff sees the notification and customer detail only. No card renders when nothing has qualified.
- `OwnerDashboard` now honors `?tab=loyalty` for the Home card's deep link (guarded by the existing Owner-only tab check).
- 15 new pglite tests in `tests/backend/test.mjs` covering every edge case below.

**Scope:** Home notification only. No PhilSMS/SMS/provider work, no Production deploy, no `supabase db push` was run.

## Documented behavior: redemption when another reward is already earned

If, after a redemption, the customer's remaining points balance still meets or exceeds the threshold, `redeem_loyalty_reward` resolves the just-redeemed notification and immediately opens a new active one for the next cycle (anchored to `source_redemption_id` for idempotency/audit). Points and history are never erased — this only affects which notification row is "active" on Home.

## Test plan

- [x] `npm run check:migrations` — PASS
- [x] `npm run build` — PASS
- [x] `npm run lint` — PASS (0 errors; existing warning-only baseline, none introduced by this change)
- [x] `git diff --check` — PASS
- [x] `npm test --prefix tests/backend` — 80 PASS / 0 FAIL (pglite, incl. 15 new loyalty tests) + 39 PASS / 0 FAIL (edge-manage-staff-user, untouched)
- [x] `npm run test:customer-items` — 8 PASS / 0 FAIL
- [x] `npm run test:sales-metrics` — 12 PASS / 0 FAIL
- [x] Below threshold → no notification; exact threshold → one notification; exceeds threshold → one notification
- [x] Repeated refresh → still exactly one active notification
- [x] Owner and Staff can both read; Staff cannot resolve/redeem (RLS + function check)
- [x] Concurrent/duplicate insert rejected at the DB constraint level (not just app logic)
- [x] Redemption resolves the alert and preserves the `loyalty_redemptions` audit trail
- [x] A later new reward cycle produces a new alert
- [x] Cancelled transaction → no alert; deleted transaction → no alert
- [x] Existing On Hold notifications regression-checked, still working
- [x] SMS/PhilSMS code, config, and column grants confirmed untouched
- [ ] Authenticated Owner/Staff QA on a live/staging deployment, two-browser-session realtime confirmation — **NOT RUN**: no staging Supabase project or local device link was available in this session (see below)

## Known gaps

- No live/staging Supabase project was connected in this session, and no local device link was available, so live authenticated Owner/Staff browser QA (including the two-session realtime confirmation) could not be run. The pglite suite exercises the real SQL migration end-to-end (RLS, trigger, idempotency) against an in-memory Postgres, but not a live browser session — flagging this honestly rather than claiming it as verified.
- This cloud session could not push directly to the repo (not in its authorized push set); the branch was handed off as a git bundle/patch for a manual push, which is why this PR was opened from a different path than a direct session push.

## Confirmation

SMS/PhilSMS code, templates, provider config, and secrets are completely untouched by this change (verified by test + manual diff review). No Production deploy was performed and `supabase db push` was never run.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

https://claude.ai/code/session_01DeFV6HNfuxKwGxuKyxSEx9
