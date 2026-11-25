# Subscription Model

How RestroPulse handles subscriptions, plan changes, cancellations and
credits. Billing is **manual**: there is no payment gateway in the app.

This is the engineering reference. The bug reports
`SUBSCRIPTION-BUG-REPORT-2026-04-25.md` and `-2026-04-26.md` describe an
earlier gateway-based design and are kept for history only.

---

## TL;DR

- We sell three monthly tiers: **Starter ₹2,999**, **Growth ₹9,999**, **Premium ₹16,999**.
- A subscription is one local MongoDB document per restaurant. Nothing
  outside the app holds billing state.
- The owner **requests** a plan (`POST /api/subscriptions/subscribe`, or
  `/change-plan` when already on one), optionally with a coupon, and can
  withdraw the request (`POST /withdraw-request`).
- RestroPulse arranges payment with the restaurant directly, outside the app.
- A platform admin (role `ADMIN`) **activates** the plan for 1-36 months
  (`POST /api/platform-admin/billing/restaurants/:restaurantId/activate`)
  and can grant credits (`POST .../credits`).
- A plan keeps working for `MANUAL_BILLING_GRACE_DAYS` (3, in
  `@restropulse/shared`) after `currentPeriodEnd`. Nothing renews it
  automatically; an admin renews by activating again.
- Cancel sets `cancelAtPeriodEnd`; the plan runs out with its paid period.

---

## States and lifecycle

There is exactly one subscription document per restaurant, created at
onboarding. Lifecycle:

```
                      POST /api/restaurant
                               v
                         status=NONE
                 (free trial: trialEndsAt = now + trialDays)
                               v
              owner: POST /subscribe { planSlug, couponCode? }
                 -> pendingPlanSnapshot + planRequestedAt (request waiting)
                               v
     admin: POST /api/platform-admin/billing/restaurants/:id/activate { months }
                               v
                         status=ACTIVE
           currentPeriodStart .. currentPeriodEnd, request cleared
                |                 |                      |
   owner: /change-plan   owner: /cancel          period end + 3 days
   (new request; plan    cancelAtPeriodEnd=true  without renewal
   unchanged until an    (/reactivate undoes)    -> not entitled; owner
   admin activates it)                              can request again
```

Status enum (DB column `status`, type from `@restropulse/shared`):
- **NONE** — onboarding completed, no paid plan; the free trial may be running.
- **ACTIVE** — an admin switched a plan on. Entitled until
  `currentPeriodEnd + MANUAL_BILLING_GRACE_DAYS`.
- **CANCELLED** — set when an owner cancels a plan that has no paid period
  recorded. A cancel with a paid period only sets `cancelAtPeriodEnd`.
- `CREATED`, `AUTHENTICATED`, `PAST_DUE`, `HALTED` remain in the type for
  older documents. Nothing sets them now; `PAST_DUE` is still treated like
  `ACTIVE` for entitlement.

Request fields on the document (any status):
- `pendingPlanId` + `pendingPlanSnapshot` — the plan the owner asked for.
- `planRequestedAt` — when they asked; admins see requests oldest first.
- `couponCode` — the coupon sent with `/subscribe` (never with `/change-plan`).

Cancellation fields on an ACTIVE document:
- `cancelAtPeriodEnd: true` + `cancelledAt: <ts>` — the owner doesn't want
  a renewal. The plan stays live until its period (plus grace) runs out.

---

## Entitlement

`getEntitlement(sub)` in `packages/shared/src/index.ts` is the single source
of truth, used by the API (`requireEntitlement`, `enforcePlanLimits`,
`/subscriptions/current`) and the content engine (cycle sync):

- `activePlan` — status `ACTIVE`/`PAST_DUE` and `isPlanPeriodOver(sub)` is
  false, i.e. now is before `currentPeriodEnd + 3 days`.
- `inTrial` — `trialEndsAt` is in the future.
- `entitled = activePlan || inTrial`.

In the API, `hasActivePaidPlan` (plan switched on) and `hasLivePaidPlan`
(switched on and not past period + grace) in
`apps/api/src/services/billing/manual-billing.ts` decide what an owner may
request.

---

## Owner routes (`/api/subscriptions`, `requireAuth`)

| Route | Behaviour |
|---|---|
| `GET /plans` | Public plan catalogue. |
| `GET /current` | Subscription, weekly usage against plan limits, entitlement. |
| `POST /subscribe { planSlug, couponCode? }` | Validates the plan and coupon (`checkCoupon`), then stores the request. 409 if a live paid plan exists and is not cancelling (use `/change-plan`). A new request replaces an earlier one. |
| `POST /change-plan { planSlug }` | Needs a plan that was switched on. Asking for the current plan while it is live clears any pending request and returns `requested: false`. Any other plan (or the same plan once lapsed) is stored as the request. Coupons don't carry over. |
| `POST /withdraw-request` | Clears the pending request and nothing else. 400 if there is none. |
| `POST /cancel` | No plan switched on: withdraws the request. Plan with a paid period: sets `cancelAtPeriodEnd` and clears any request. Plan with no paid period: status `CANCELLED` now. |
| `POST /reactivate` | Undoes a scheduled cancellation (`cancelAtPeriodEnd=false`). |

## Admin routes (`/api/platform-admin/billing`, `requireAuth` + `requireRole('ADMIN')`)

| Route | Behaviour |
|---|---|
| `GET /requests` | Waiting plan requests, oldest first: restaurant, current plan and period end, requested plan and monthly price, coupon, requested at. |
| `POST /restaurants/:restaurantId/activate { planSlug?, months? }` | `months` 1-36 (default 1). Plan is `planSlug`, else the requested plan, else the current plan (renewal). Sets `status=ACTIVE`, `billingCycle=MONTHLY`, the new period, clears the request and any cancellation. |
| `POST /restaurants/:restaurantId/credits { credits }` | Adds 1-100,000 credits to the balance. |

There is no admin screen in the web app yet; admins call these endpoints
with an ADMIN account's token.

Period rules (`nextPeriod` in `manual-billing.ts`):
- Renewing the **same** plan while its period is still running extends the
  end date from `currentPeriodEnd` and keeps `currentPeriodStart`.
- Anything else (new plan, a switch, or a renewal after the period ended)
  starts now.
- Months are calendar months, clamped to the month's last day.

Coupons: the owner's coupon applies only if the admin activates the plan the
owner asked for, and only if `checkCoupon` still passes at activation. The
redemption is then recorded (`couponRedemptions`, `redemptionCount` +1).
The discount itself is reflected in what RestroPulse charges outside the app.

---

## Scenarios catalog

Pricing reminder: S=₹2,999, G=₹9,999, P=₹16,999 per month.

| Start | Owner action | Admin action | End |
|---|---|---|---|
| `NONE` (trial or not) | `POST /subscribe { planSlug:'starter' }` | activate, e.g. `months: 3` | `ACTIVE` Starter for 3 months |
| `ACTIVE` S | `POST /change-plan { planSlug:'growth' }` | activate (uses the request) | `ACTIVE` Growth, period starts now |
| `ACTIVE` P | `POST /change-plan { planSlug:'growth' }` (downgrade) | activate | `ACTIVE` Growth, period starts now |
| `ACTIVE` P with request G | `POST /change-plan { planSlug:'premium' }` | none | `ACTIVE` P, request cleared |
| `ACTIVE` P with request G | `POST /withdraw-request` | none | `ACTIVE` P, request cleared |
| `ACTIVE` P | none | activate `{ months: 1 }` before period end | `ACTIVE` P, period end +1 month |
| `ACTIVE` P | `POST /cancel` | none | `ACTIVE` P with `cancelAtPeriodEnd`; lapses after period end + 3 days |
| `ACTIVE` P, cancelling | `POST /reactivate` | none | `ACTIVE` P, no cancellation |
| `ACTIVE` P, lapsed | `POST /subscribe` or `/change-plan` (any plan) | activate | `ACTIVE`, period starts now |

The timing of a switch is the admin's call: activating applies the requested
plan immediately. To switch at the end of a paid period, activate on that day.

---

## Credits

- Post creation checks weekly plan limits via `enforcePlanLimits`; over the
  limit, credits are deducted from the unified balance (IMAGE=1, CAROUSEL=3, REEL=5).
- Credits are added only by a platform admin
  (`POST /api/platform-admin/billing/restaurants/:restaurantId/credits`).
- Credit packs (`/api/credit-packs`) are a price list; with
  `FEATURE_TOPUP_CREDITS` on, the Profile sheet shows them with a line
  telling the owner to contact their account manager. There is no in-app
  purchase.

---

## Edge cases

### Owner changes their mind repeatedly

Each `/subscribe` or `/change-plan` call replaces the stored request, and
`planRequestedAt` moves to the latest call. Nothing is charged in the app,
so there is nothing to clean up.

### Coupon no longer valid at activation

If the coupon has expired, been fully redeemed or the admin activates a
different plan, the plan is activated without it and the API logs a warning.

### Concurrent update

`updateSubscription` returning nothing during activation answers 409
("The subscription changed while activating. Try again.").

### Payment late

The 3-day grace covers a late bank transfer. After that the restaurant is
no longer entitled until an admin activates again.

---

## File map

Backend:

| File | Role |
|---|---|
| `apps/api/src/routes/subscriptions.ts` | Owner routes: /plans, /current, /subscribe, /change-plan, /withdraw-request, /cancel, /reactivate |
| `apps/api/src/routes/platform-billing.ts` | Admin routes: /requests, /restaurants/:restaurantId/activate, /restaurants/:restaurantId/credits |
| `apps/api/src/services/billing/manual-billing.ts` | `checkCoupon`, `recordCouponRedemption`, `hasActivePaidPlan`, `hasLivePaidPlan`, `addMonths`, `nextPeriod` |
| `packages/db/src/subscriptions.ts` | `findActiveSubscription`, `findSubscriptionsWithPendingPlan`, `updateSubscription`, `addCredits`, `deductCredits` |
| `packages/shared/src/index.ts` | `Subscription`, `SubscriptionPlan`, `SubscriptionStatus`, `MANUAL_BILLING_GRACE_DAYS`, `isPlanPeriodOver`, `getEntitlement` |

Frontend:

| File | Role |
|---|---|
| `apps/web/components/ProfileSheet.tsx` | The Subscription panel: current plan, "Paid until" / "Expires" date, request banner, plan cards, cancel / reactivate / withdraw |
| `apps/web/api.ts` | `subscriptionAPI.getPlans`, `.getCurrent`, `.subscribe(slug, coupon?)`, `.changePlan(slug)`, `.withdrawRequest`, `.cancel`, `.reactivate` |

---

## Testing

- `apps/api/tests/unit/subscriptions.test.ts` — owner routes.
- `apps/api/tests/unit/platform-billing.test.ts` — admin routes, role check, months/credits bounds, coupon at activation.
- `apps/api/tests/unit/manual-billing.test.ts` — coupon checks, period maths, live/active plan helpers.
- `packages/shared/tests/manual-billing.test.ts` — grace period and entitlement.
- `apps/web/tests/ProfileSheet.test.tsx` — the Subscription panel.
- End-to-end checklist: `docs/SUBSCRIPTION-E2E-TESTS.md`.

---

## What we're NOT doing

- **No payment gateway, no recurring charges, no automatic renewal.**
- **No proration.** A switch starts a new period when the admin activates it.
- **No in-app invoices for new charges.** `/api/invoices` only lists and
  shows invoices already stored.
- **No in-app credit purchases.**
- **No annual billing in the UI.** The schema still has
  `billingCycle: 'MONTHLY' | 'ANNUAL'` and `pricing.annual`; activation
  always sets `MONTHLY`.

---

## Future work

- An admin screen for plan requests, activation and credits.
- Reminders to the owner and the team before `currentPeriodEnd`.
