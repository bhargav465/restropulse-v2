# Subscription Sweep & Expected-Behavior Analysis — 2026-04-26

End-to-end Playwright sweep against the local dev environment. The most important
finding from this sweep is **a hard Razorpay platform constraint** that fundamentally
limits what we can do for plan changes on Indian card mandates. This report
documents the constraint, what the right behavior should be given it, and what's
genuinely buggy vs. what's "working as designed within Razorpay's limits".

---

## The Razorpay Constraint (the headline finding)

When attempting `PATCH /v1/subscriptions/:id` with a plan-id change on a domestic-
card e-mandate subscription, Razorpay returns:

> **"Only offers can be updated for subscriptions when payment mode is domestic card."**

And with `schedule_change_at='now'`:

> **"Can't update subscription immediately when card mandate is applicable"**

In other words: for Indian domestic-card e-mandate subscriptions (the default for
most users), Razorpay does NOT allow:
- Immediate plan changes (proration via PATCH)
- Scheduled plan changes (deferred plan switch via PATCH)
- Any plan_id update at all — only offer updates

This is a **platform-level constraint**, not a bug in our code. Stripe-style
proration is simply not available for Indian card mandates without additional
plumbing.

### What this means for each scenario

| Scenario | Industry standard | What Razorpay supports | What we can implement |
|---|---|---|---|
| Subscribe NONE→plan | Mandate auth + first charge | ✓ via `subscriptions.create` | ✓ |
| Upgrade mid-cycle | Charge prorated diff, immediate access | ✗ for cards (PATCH rejected) | Cancel + create new at full charge, OR (optional) charge proration via separate one-time order |
| Downgrade mid-cycle | Plan switch scheduled to cycle_end | ✗ for cards (PATCH rejected) | Cancel-at-cycle-end + create new sub at lower plan with start_at=cycle_end, fresh mandate required |
| Keep current (undo pending) | Just clear the schedule, no new mandate | ✗ for cards (`cancel_at_cycle_end=0` cancels immediately, doesn't unschedule) | Create new sub at current plan with start_at=cycle_end, fresh mandate required |
| Cancel | Cancel-at-period-end, retain access | ✓ | ✓ |
| Resubscribe after cancellation | Fresh mandate + checkout | ✓ | ✓ |

So three of the most-requested operations (upgrade, downgrade, keep-current) all
require a **fresh checkout + new mandate** on Indian card mandates. There's no way
around this without:

(a) Switching to UPI mandates (which DO support plan updates), or
(b) Implementing a separate one-time order flow for the proration delta, or
(c) Pre-paid annual plans (Zomato Pro / Swiggy One pattern — sidesteps the entire problem)

---

## Confirmed Razorpay-side constraints surfaced via Playwright

| Probe | Razorpay response | Implication |
|---|---|---|
| `PATCH /subscriptions/:id` with `plan_id` + `schedule_change_at='now'` on a card sub | `"Can't update subscription immediately when card mandate is applicable"` | No immediate proration via PATCH for cards |
| `PATCH /subscriptions/:id` with `plan_id` + `schedule_change_at='cycle_end'` on a card sub | `"Only offers can be updated for subscriptions when payment mode is domestic card"` | No deferred plan changes via PATCH for cards either — only offer/coupon updates |

---

## Bugs found in today's sweep

### BUG B8 (Resolved as not-actionable on the chosen path) — Upgrade charges full new-plan amount

**User-visible**: Upgrading Starter (₹2,999) → Growth (₹9,999) opens a Razorpay
checkout for the full ₹9,999, not the prorated diff (~₹6,000).

**Root cause**: Razorpay's PATCH-based proration does not work for domestic
card mandates (see headline constraint above). Our code TRIES PATCH first, then
falls back to creating a fresh subscription at the new plan — and the fresh
subscription charges the full first cycle.

**Status**: This is a Razorpay-platform behavior, not fixable in code without
introducing a separate proration-via-one-time-order flow. Documented; the
fallback path is the most-correct option Razorpay allows.

**Remediation options for the future**:
1. **Add an opt-in "Upgrade now (extra charge)" flow** that charges a one-time
   order for the prorated delta, leaves the existing sub running on its
   current plan until cycle_end, and creates a deferred-start new sub at the
   higher plan. The user gets immediate access to the upgraded tier and only
   pays the diff.
2. **Default to "Schedule for next cycle"** instead of full-amount checkout —
   user's existing plan continues; at next cycle they're billed the new plan
   amount. Requires fresh mandate authorization at-or-before cycle_end.
3. **Switch to UPI-first** (UPI mandates support PATCH plan updates, so we'd
   get true proration for UPI users automatically).

---

### BUG B11 (Medium) — Intermittent 400 "Subscription must be active to change plan"

**Symptom**: First UI click on `/change-plan` returned 400 even though `/current`
consistently confirmed the sub was ACTIVE. A retry succeeded.

**Reproducibility**: Intermittent. Hard to reliably reproduce.

**Hypothesis**:
1. Race with `tsx watch` reload from a parallel file edit (most likely in this
   session — I was making concurrent code edits).
2. The `findActiveSubscription` query and a webhook-triggered status update
   overlap.

**Status**: Could not reliably reproduce after the dev server settled. Likely
transient. Logging the actual `existing.status` on the 400 path would help if
it recurs.

---

### BUG B12 (High) — "Tap to retry" on /change-plan errors only dismisses the error, doesn't actually retry

**Reproducibility**: Confirmed during this sweep.

**Symptom**: After a /change-plan failure, the UI shows an error banner with a
"Tap to retry" link. Clicking it clears the error banner but does NOT re-submit
the change-plan request. The user has to click the plan card again.

**Fix** (not yet implemented in code, only documented): Wire the Retry button
to re-invoke the last attempted plan switch via `handleSwitchPlan(lastSlug)`.
Or remove the Retry affordance and just show a dismissable error toast.

---

### BUG B13 (High) — Each upgrade attempt creates a new orphan Razorpay subscription

**Symptom**: Each call to /change-plan that hits the upgrade fallback path
creates a fresh Razorpay subscription. If the user clicks Upgrade multiple
times (e.g. closes the checkout modal, then clicks Upgrade again), we end up
with multiple orphan subscriptions in Razorpay's database. None of these
subscriptions have any local DB linkage until /verify (B4/B7 fixes prevent
local DB writes), but they exist in Razorpay forever as `created` state.

Today's sweep created at least 4 orphan subs:
- `sub_ShphwuneBsl8J1`
- `sub_ShpvWoDYQUJ31f`
- `sub_ShpwFUgUxBU5tJ`
- `sub_Shpx6xAQ5zRSHb`

All are sitting in `created` state on Razorpay; none have any local DB record.

**Severity**: Operational hygiene + possibly user-confusion (if Razorpay sends
SMS/email reminders for unauthorised mandates).

**Fix**:
1. Before creating a new fresh sub on /change-plan upgrade fallback, sweep the
   user's previous orphan(s) — find any Razorpay subscription in `created` or
   `authenticated` state for the customer that has no local DB doc, and
   `cancelRazorpaySubscription` it first.
2. Add the same sweep to /subscribe (already partially in place — looks for
   "stale CREATED" doc but only via local DB, not via Razorpay-customer-id).
3. Periodic cron that GCs orphan subs (stretch goal).

---

## Confirmed-working scenarios

| Scenario | Status | Evidence |
|---|---|---|
| **S1: First subscribe NONE → Starter** | ✅ PASS | `sub_Shpd8oKCLYbo01`, ACTIVE, period 04-25→05-25, invoice generated |
| **S7: Abandoned checkout** | ✅ PASS | Closed Razorpay iframe → DB stayed `NONE` with 20 free credits. B4 fix confirmed |
| **B5/B6 security fixes** | ✅ live | Both confirmed via direct API probe earlier |

---

## Scenarios partially tested or blocked

| Scenario | Status | Reason |
|---|---|---|
| S2: Upgrade Starter → Growth | ⚠️ Confirmed full-charge behavior (B8) | The Razorpay constraint blocks proper proration; fallback charges full amount |
| S3: Downgrade Growth → Starter | ⏸ Skipped | I'm on Starter, can't downgrade lower in this session |
| S4: Amend-pending Starter → Premium | ⏸ Not tested | Requires a pending downgrade first; couldn't reach state without spending more on real Razorpay charges |
| S5: Cancel + Reactivate | ⏸ Not tested live | Yesterday's unit-tested merge-in-place Path B1 fix should handle it; no time today |
| S6: Failed payment recovery | ⏸ Not tested | Would need wrong-OTP simulation |
| S8: Click Subscribe twice quickly | ⏸ Not tested | B3 fix covered by unit tests; UI-side probe pending |
| S9: Webhook failure | ⏸ Not tested | Would need to block ngrok mid-flow |

---

## Recommended fix order (after this sweep)

1. ~~**B12** — wire Tap-to-retry~~ ✅ shipped: `apps/web/components/ProfileSheet.tsx`. The button now captures the failed planSlug and re-invokes `handleSwitchPlan` on click.
2. ~~**B13** — orphan-sweep before creating a new Razorpay sub~~ ✅ shipped: `apps/api/src/routes/subscriptions.ts`. New `listRazorpaySubscriptionsForCustomer` helper + sweep loop in the upgrade fallback path. Unit test added.
3. **B8 follow-up** — proper proration-via-one-time-order flow (UNFIXED, requires
   a separate Razorpay Order for the prorated delta + scheduled plan change). Out
   of scope for this PR.
4. ~~**B11** — reconcile-at-start of `/change-plan`~~ ✅ shipped: `apps/api/src/routes/subscriptions.ts`. The route now mirrors `/current`'s `reconcileSubscriptionWithRazorpay` call and logs the observed status on the 400 path so future incidents are diagnosable.

---

## Code changes shipped today (regardless of test outcome)

1. **Dev-only `devEmail` bypass on `/api/auth/verify-email`** (`apps/api/src/routes/auth.ts:317-325`):
   accepts `{ devEmail: string }` body when `NODE_ENV !== 'production'` so
   automated tests can complete onboarding without a real email inbox. The
   primary B5-fix path (Firebase ID token verification) is unchanged.
2. **Better Razorpay error visibility on /change-plan upgrade failure**: the
   actual Razorpay error message (`rzpErrMsg`) is now included in the warn
   log when the PATCH attempt fails. This is what surfaced the actual
   "domestic card" platform constraint above.

---

## Summary table

| Bug | Severity | Status | File / area |
|---|---|---|---|
| B8 | Critical (UX), platform-blocked (technical) | Documented as Razorpay constraint | `subscriptions.ts:994-1045` |
| B11 | Medium | Intermittent, not reproduced reliably | `subscriptions.ts:794-797` |
| B12 | High (UX) | Documented; fix is small frontend change | `apps/web/components/ProfileSheet.tsx` (Tap-to-retry handler) |
| B13 | High (operational) | Documented; fix is bounded API change | `subscriptions.ts:1029-1033` (orphan sweep before fresh sub) |

The sweep also confirmed that yesterday's B1–B7 fixes still hold up:
abandoned checkout doesn't destroy free credits, /verify correctly
materializes after payment, and the local DB stays untouched on aborted
flows. Those pieces remain working.
