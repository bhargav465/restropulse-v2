# Subscription Model

How RestroPulse handles subscriptions, plan changes, cancellations, and the
billing edge cases that come with running on Razorpay's Indian e-mandate
platform.

This is the engineering reference. For the bug history that led here, see
`SUBSCRIPTION-BUG-REPORT-2026-04-25.md` and `-2026-04-26.md`.

---

## TL;DR

- We sell three monthly tiers: **Starter ₹2,999**, **Growth ₹9,999**, **Premium ₹16,999**.
- A subscription is a Razorpay-hosted recurring billing arrangement plus a
  local MongoDB document.
- **Every** plan change (upgrade, downgrade, "Keep current", amend-pending)
  goes through the same unified backend flow:
  *cancel-at-cycle-end the active sub, sweep orphans, create a fresh sub
  with `start_at` set to either now or cycle_end.*
- The local DB doc is **never** modified before payment is confirmed (B7
  fix). All state changes happen in `materializeSubscriptionFromRazorpay()`
  on `/verify` or via the `subscription.charged` webhook.

---

## Why this design

Razorpay's domestic-card e-mandate platform refuses three operations that
every Stripe-style proration design depends on:

| Operation | Razorpay response |
|---|---|
| `PATCH /subscriptions/:id` with `plan_id` + `schedule_change_at: 'now'` | `"Can't update subscription immediately when card mandate is applicable"` |
| `PATCH /subscriptions/:id` with `plan_id` + `schedule_change_at: 'cycle_end'` | `"Only offers can be updated for subscriptions when payment mode is domestic card."` |
| `cancel_at_cycle_end=0` on a cancel-scheduled sub (i.e. "un-schedule the cancellation") | Cancels the sub immediately rather than un-scheduling |

Translation: for Indian card mandates, Razorpay supports only **create**,
**cancel-at-cycle-end**, **cancel-immediately**, and **offer-update**. There
is no in-place plan change.

So every plan change must be:

1. Cancel the existing Razorpay sub at cycle_end (one-way).
2. Create a brand-new Razorpay sub on the target plan with `start_at` set
   appropriately. This requires a fresh e-mandate authorisation by the
   user's bank — a one-time ~₹5 verification charge ("auth transaction").
3. The two subs overlap until cycle_end: the old one continues serving the
   already-paid period, the new one is registered but deferred.

This is unfamiliar but it's the only path Razorpay allows, and we now match
that constraint exactly.

---

## States and lifecycle

There is exactly one subscription document per restaurant
(`unique(restaurantId, endedAt: null)` constraint). Lifecycle:

```
                         POST /api/restaurant
                                v
                          status=NONE
                       (free credits seeded)
                                v
                         /subscribe + checkout
                                v
                     status=CREATED → AUTHENTICATED → ACTIVE
                                          ^             |
                                          |             |    /change-plan
                          webhook subscription.charged  |        |
                                          |             v        v
                                  cancellation flag toggles, plan flips
                                          |
                                          v   /cancel
                                     ACTIVE | cancelAtPeriodEnd=true
                                          |
                          (cycle_end passes; webhook fires)
                                          v
                                     CANCELLED
                                          |
                          /subscribe again → CREATED → ACTIVE
```

Status enum (DB column `status`, type from `@restropulse/shared`):
- **NONE** — onboarding completed, no plan, free signup credits available.
- **CREATED** — `/subscribe` opened a Razorpay checkout but payment hasn't
  cleared. Local doc only created via `materializeSubscriptionFromRazorpay`
  after `/verify` or webhook.
- **AUTHENTICATED** — Razorpay accepted the mandate; the first charge is
  imminent or in flight.
- **ACTIVE** — first charge succeeded; user has full access. Steady state.
- **PAST_DUE** — charge attempt failed; Razorpay is retrying via dunning.
- **HALTED** — dunning exhausted retries; access suspended.
- **CANCELLED** — sub fully ended (no longer billable). User can re-subscribe.

Pending-change flags on an ACTIVE doc:
- `cancelAtPeriodEnd: true` + `cancelledAt: <ts>` — sub will end at cycle_end
- `pendingPlanId` + `pendingPlanSnapshot: <plan>` — a plan change is
  scheduled (always paired with `cancelAtPeriodEnd: true`)

A doc in `A_X | P_Y` state means *"currently on X, scheduled to switch to Y
at currentPeriodEnd"*.

---

## The unified backend flow

All plan-change paths funnel through one helper:

**`prepareCancelAndFutureSubscribe(params)`** in `apps/api/src/routes/subscriptions.ts:786`

```
Input: { existing, targetPlan, mode: 'now' | 'cycle_end', restaurantId, userId }

  1. cancel-at-cycle-end the existing Razorpay sub (idempotent — skipped if
     existing.cancelAtPeriodEnd is already true)

  2. List Razorpay subs for the customer; cancel any 'created' or
     'authenticated' state subs that are NOT the active one and have no
     local DB record (orphan-sweep — B13 fix)

  3. Create a fresh Razorpay subscription:
       - mode='now' → no start_at; first charge fires immediately for the
         full new-plan amount. Used when the user explicitly clicks
         "Upgrade now (₹X today)" in the dialog.
       - mode='cycle_end' → start_at = currentPeriodEnd. First charge is
         deferred to that date; today only the ~₹5 mandate auth charge
         fires. Used for everything else.

  4. Notes on the new sub: { planSlug, restaurantId } so the
     subscription.charged webhook + /verify can recover the local plan
     reference.

  5. Return { razorpaySubscriptionId, keyId, effective }.
     Local DB is NOT updated here — see materializeSubscriptionFromRazorpay.
```

**`/change-plan`** is now a thin dispatcher (`apps/api/src/routes/subscriptions.ts:882`):

```
Input: { planSlug, mode?: 'now' | 'cycle_end' }

  - reconcileSubscriptionWithRazorpay (B11 fix: turn transient AUTHENTICATED
    into ACTIVE before the status check)
  - status check: ACTIVE or PAST_DUE only
  - find target plan
  - no-op echo if planSlug === currentSlug && !pending
  - no-op echo if planSlug === pendingSlug
  - decide mode: 'now' is honoured only for upgrades; everything else uses
    'cycle_end'
  - call prepareCancelAndFutureSubscribe(...)
  - return { effective, planName, requiresCheckout: true, subscriptionId, keyId }
```

That's the entire backend dispatch. Cases A/B/C/D from the legacy code are
gone — they all collapse into the same path with different inputs.

---

## DB materialisation (the only place state changes)

**`materializeSubscriptionFromRazorpay()`** in `apps/api/src/routes/subscriptions.ts:84`

Called from `/verify` (sync after Razorpay checkout) and from
`subscription.activated` / `subscription.charged` webhooks.

Three paths:

- **Path A** — `findSubscriptionByRazorpayId(rzpId)` returns an existing
  doc → simple `updateSubscription(...)` advancing status with rank-guard
  (never regress past ACTIVE back to AUTHENTICATED).

- **Path B1 — deferred resubscribe to same plan** — no doc for this
  rzpId, but there's an existing-active doc with `cancelAtPeriodEnd=true`,
  same `planSnapshot.slug`, and the new Razorpay sub is in
  AUTHENTICATED/CREATED. **Merge in place**: swap the
  razorpaySubscriptionId on the existing doc, clear cancellation flags,
  preserve currentPeriodStart/End. This is the "Keep current plan" /
  reactivate path — the user keeps their already-paid period intact.

- **Path B2 — different plan or fresh subscription** — archive the
  existing-active doc (set `endedAt`), insert a fresh doc with the new
  plan snapshot. This is upgrade-now, downgrade-completes-at-cycle-end,
  re-subscribe-from-cancelled.

The B7 invariant is enforced by this single function: nothing else mutates
the subscription doc during a plan change.

---

## Scenarios catalog

For each scenario, the table shows starting state, user action, dialog
shown, backend call, Razorpay calls, and end state (after `/verify` or the
charge webhook fires).

Pricing reminder: S=₹2,999, G=₹9,999, P=₹16,999.

### Subscribing for the first time

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `N` | Click "Subscribe to Starter" | First-subscribe confirm | `POST /subscribe { planSlug:'starter' }` | `subscriptions.create(planId=starter)` (no start_at) → checkout for ₹2,999 + mandate auth | `A_S` |

Materialisation: Path B2 archives the NONE doc, inserts fresh `A_S`.

### Upgrade — default (Schedule from next cycle)

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_S` | Click Growth → "Schedule from next cycle" | Three-line story: ₹5 today, S continues, ₹9,999 from {date} | `POST /change-plan { planSlug:'growth' }` (default mode) | cancel-at-cycle-end old S sub, create new G sub `start_at=cycle_end` → checkout for ₹5 mandate auth | `A_S \| P_G` |

Today: ₹5. At cycle_end: ₹9,999 fires automatically (Path A advances
status); local doc materialises via webhook (Path B2: archive S doc, insert
fresh G doc).

### Upgrade — explicit "Upgrade now"

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_S` | Click Growth → expand details → "Upgrade now" | Two-button dialog with the "now" details exposed | `POST /change-plan { planSlug:'growth', mode:'now' }` | cancel-at-cycle-end old S sub, create new G sub (no start_at) → checkout for full ₹9,999 + mandate auth | `A_G` (after /verify) |

The remaining S period is forfeit — Razorpay does not refund unused days.
Dialog discloses this explicitly: *"Unused days from the existing paid
period are forfeit."*

Materialisation: Path B2 archives S, inserts fresh G with status=ACTIVE.

### Downgrade

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_P` | Click Growth | Three-line: ₹5 today, P continues, ₹9,999 from {date} | `POST /change-plan { planSlug:'growth' }` | cancel-at-cycle-end old P sub, create new G sub `start_at=cycle_end` → checkout for ₹5 | `A_P \| P_G` |

Identical backend path to default-mode upgrade. The only difference is
that the new plan is cheaper than the current. UI calls it "Downgrade",
backend doesn't care.

### Keep current plan (cancel a pending change)

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_P \| P_G` | Banner "Cancel scheduled change" → "Keep current plan" | "Keep Premium?" dialog with ₹5 today copy | `POST /change-plan { planSlug:'premium' }` (= currentSlug) | cancel-at-cycle-end is idempotent (already set), sweep deferred-G sub from a prior amend, create new P sub `start_at=cycle_end` → checkout for ₹5 | `A_P` (no pending) |

Materialisation: **Path B1** kicks in — existing doc has `P` planSnapshot
and the new sub is also `P` → merge in place, clear pending flags, swap
razorpaySubscriptionId. The user's already-paid Premium period continues
uninterrupted.

This path is responsible for the ₹5 charge that the user previously found
mysterious — the dialog now explains it explicitly.

### Amend pending downgrade (replace target plan)

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_P \| P_G` | Click Starter | Three-line dialog with "Replaces the previously scheduled switch to Growth" | `POST /change-plan { planSlug:'starter' }` | cancel-at-cycle-end is idempotent, sweep deferred-G sub, create new S sub `start_at=cycle_end` → checkout for ₹5 | `A_P \| P_S` (after /verify) |

Each amendment costs ₹5. The dialog discloses this — every change of mind
is a separate mandate auth.

### Cancel

| Start | User action | API | Razorpay | End |
|---|---|---|---|---|
| `A_P` | Profile → Subscription → Cancel | `POST /cancel` | `cancelRazorpaySubscription(sub, cancel_at_cycle_end=1)` | `A_P` with `cancelAtPeriodEnd=true`, `cancelledAt`, no pending |

Pure cancel (no replacement). User keeps access until cycle_end. The
banner shows "Subscription ends on {date}" with no actionable button on
plan cards (other plans are still clickable to re-subscribe).

### Reactivate after pure cancel

| Start | User action | Dialog | API | Razorpay | End |
|---|---|---|---|---|---|
| `A_P + cancelAtPeriodEnd, no pending` | Click "Reactivate" | "Keep Premium?" dialog | `POST /reactivate` (legacy; `/change-plan` with current plan slug also works) | cancel-at-cycle-end already set, create new P sub `start_at=cycle_end` → checkout for ₹5 | `A_P` (no cancellation flags) |

Same shape as Keep-current. Path B1 merges in place.

`/reactivate` is a kept-for-now legacy route that funnels into the same
deferred-resubscribe-on-current-plan logic. Eventually it can be replaced
by `/change-plan { planSlug: currentSlug }`.

### Resubscribe from CANCELLED (period ended, fully expired)

| Start | User action | API | Razorpay | End |
|---|---|---|---|---|
| `CANCELLED` | Click any plan | `POST /subscribe { planSlug:'growth' }` | `subscriptions.create(planId=growth)` (no start_at) → checkout for full ₹9,999 + mandate auth | `A_G` |

Same as first-subscribe. Fresh mandate, full first-cycle charge.

---

## Permutations matrix

For an ACTIVE plan X, with optional pending plan Y, what does clicking plan
Z do?

| Clicked Z | Behaviour |
|---|---|
| Z = X, no pending | No-op echo (`effective: 'immediate', requiresCheckout: false`) |
| Z = X, with pending Y | Keep-current flow → cancel-pending sweep + new deferred-X sub + ₹5 |
| Z = pending Y | No-op echo (`effective: 'cycle_end', requiresCheckout: false`) |
| Z higher than X, default mode | Schedule deferred-Z + ₹5 today, ₹Z at cycle_end |
| Z higher than X, mode='now' | Cancel X + immediate Z + full ₹Z today |
| Z lower than X | Schedule deferred-Z + ₹5 today, ₹Z at cycle_end |
| Z above pending Y but ≤ X | Same as "Z lower than X" — replace pending with deferred-Z |
| Z below pending Y | Same — replace pending with deferred-Z (the cheaper one) |

Click sequences (e.g. U+D+D, D+D+U, etc.) are just a sequence of these
single-step transitions. Each transition is independently consistent and
idempotent on the local DB until `/verify` materialises.

---

## Edge cases & race conditions

### Abandoned checkout

User opens Razorpay iframe and closes without paying.

- `/change-plan` already created the new Razorpay sub (in `created` state).
- No `/verify` ever fires.
- Local DB **stays as it was** before the click (B7 invariant).
- The next `/change-plan` call runs `prepareCancelAndFutureSubscribe`,
  whose orphan-sweep step finds and cancels the abandoned sub before
  creating a new one (B13 fix).

### Failed payment in the Razorpay iframe

User submits a card that fails (international card, wrong OTP, etc.).

- Razorpay returns a `payment.failed` event to the iframe handler. The
  frontend surfaces a toast ("Payment failed: {reason}").
- The Razorpay sub stays in `created` state on Razorpay's side — same
  as abandoned checkout — and gets swept on the next attempt.
- DB unchanged. User can retry from the same plan card.

### Webhook race / network blip

`subscription.charged` webhook never lands (e.g. ngrok is down or the
endpoint is rate-limited).

- `/current` calls `reconcileSubscriptionWithRazorpay` on every read; it
  fetches live Razorpay state for any local doc in CREATED/AUTHENTICATED
  and advances it (rank-guarded so it can't regress).
- This is the safety net. Even if the webhook never arrives, the user's
  next page load will reconcile the state correctly.

### Stuck in AUTHENTICATED ("Activating…")

This was the original B1 user-visible bug. Two stages of fix:

1. **B1 fix** — `/subscribe` no longer treats AUTHENTICATED as
   "unpaid checkout, safe to replace". Replacing a paid-but-not-yet-
   reconciled sub used to charge the user a second time. Now the duplicate
   guard is more conservative.
2. **B11 fix** — `/change-plan` runs reconcile up front to advance any
   transient AUTHENTICATED → ACTIVE before the status check.

Combined, the user can never get a 400 "must be active" or a duplicate
charge from a webhook delay.

### Multiple amendments in quick succession

User toggles plan A → B → A → C → A within minutes.

- Each amendment is independently safe — `prepareCancelAndFutureSubscribe`
  is idempotent on the cancel-at-cycle-end step and always sweeps prior
  deferred subs before creating a new one.
- Each amendment costs the user ~₹5 mandate auth — disclosed in the dialog.
- The local doc is unchanged through the amendments; only the *final*
  successful `/verify` materialises a swap.

### User pays for one Razorpay sub but the local DB never sees it

Possible if `/verify` errors out and webhooks are blocked. The next
`/current` call reconciles via Razorpay; if the doc somehow points to a
different sub ID, see the next item.

### Local doc has wrong razorpaySubscriptionId (data corruption)

The B1 bug used to cause this. Today, only `materializeSubscriptionFromRazorpay`
mutates `razorpaySubscriptionId`, and it does so only on verified events —
so the doc and the Razorpay sub stay aligned.

If somehow the IDs diverge (e.g. manual DB intervention), the operational
remedy is to query Razorpay invoices for the customer's paid charges and
realign the doc to the most-recently-charged Razorpay sub.

---

## File map

Backend:

| File | Role |
|---|---|
| `apps/api/src/routes/subscriptions.ts` | All routes: /current, /subscribe, /verify, /change-plan, /cancel, /reactivate, /webhook |
| `apps/api/src/services/razorpay.ts` | Razorpay API thin wrappers (createSubscription, cancelSubscription, listSubscriptionsForCustomer, etc.) |
| `apps/api/src/middleware/auth.ts` | requireAuth — JWT + Razorpay-customer-id resolution |
| `packages/db/src/subscriptions.ts` | DB helpers: findActiveSubscription, findSubscriptionByRazorpayId, createSubscription, updateSubscription |
| `packages/db/src/invoices.ts` | findInvoiceByPaymentId, findInvoicesByRazorpaySubscriptionId |
| `packages/shared/src/index.ts` | `Subscription`, `SubscriptionPlan`, `SubscriptionStatus` types |

Frontend:

| File | Role |
|---|---|
| `apps/web/components/ProfileSheet.tsx` | The Subscription panel — current plan, banner, plan cards, dialogs, Razorpay checkout integration |
| `apps/web/api.ts` | `subscriptionAPI.subscribe`, `.changePlan(slug, opts?)`, `.verifySubscription`, `.reactivate`, `.cancel`, `.getCurrent`, `.getPlans` |
| `apps/web/components/ConfirmDialog.tsx` | Single-button confirmation dialog (used for downgrade, cancel, keep-current after pure cancel) |

Key helpers in subscriptions.ts:

| Helper | Line | Purpose |
|---|---|---|
| `materializeSubscriptionFromRazorpay()` | 84 | The one place that mutates the local doc for plan changes |
| `reconcileSubscriptionWithRazorpay()` | 167 | Advance transitional state by reading Razorpay live |
| `prepareCancelAndFutureSubscribe()` | 786 | Unified plan-change dispatcher |
| `mapRazorpayStatus()` | 67 | Map Razorpay's `created`/`active`/etc. to our `Subscription['status']` |
| `SUBSCRIPTION_STATUS_RANK` | 56 | Status comparison so reconcile never regresses |

---

## Testing

Backend (`apps/api/tests/unit/subscriptions.test.ts`):
- 113 tests covering /subscribe, /verify, /change-plan, /reactivate, /cancel, /webhook, reconcile, materialise.
- Permutation tests for U-default, U-now, D, amend-pending Cases A/B/C/D.
- Mode='now' is rejected for non-upgrade transitions.
- Idempotent cancel-at-cycle-end is verified.
- Orphan sweep is verified (B13).
- Webhook race scenarios via reconcile.

Frontend (`apps/web/tests/ProfileSheet.test.tsx`):
- 118 tests covering the Subscription panel.
- Banner show/hide based on `pendingPlanSnapshot`.
- "Cancel scheduled change" → keep-current dialog → API call with `mode: 'cycle_end'`.
- Plan card click → unified dialog with three-line story.
- Upgrade dialog includes "Upgrade now" expandable section.
- Mode parameter is correctly passed to `/change-plan`.

End-to-end (Playwright MCP, manual via `docs/MCP-SETUP.md`):
- See `docs/SUBSCRIPTION-BUG-REPORT-2026-04-26.md` for the test sweep
  scenarios. The cheapest live verification path is one paid Premium
  subscription (₹16,999) + a series of ~₹5 amendments to exercise every
  permutation.

---

## What we're NOT doing

For the record, since these come up:

- **No mid-cycle proration**. Razorpay won't let us. The "Upgrade now"
  option charges the full new-plan amount; the default schedules at
  cycle_end. Users are told this in the dialog.
- **No in-place plan updates** (`updateRazorpaySubscription` PATCH). Removed
  in 2026-04-26 — Razorpay rejects them for card mandates. Helper still
  exists in `services/razorpay.ts` for future UPI mandate work.
- **No automatic plan switch on downgrade**. The current Razorpay sub
  cancels at cycle_end; the new (lower) sub is registered with
  `start_at=cycle_end` and starts charging then. Razorpay does NOT let us
  PATCH the existing sub to a different plan_id, so we can't avoid the
  cancel + re-create + re-mandate pattern.
- **No multiple concurrent active subs**. The unique partial index on
  `(restaurantId, endedAt: null)` enforces exactly one active doc per
  restaurant. Pre-`/verify` deferred Razorpay subs exist on Razorpay's
  side but are not represented locally.
- **No coupon-amount changes after subscribe**. We support `couponCode`
  on `/subscribe` only. Razorpay does support offer updates on existing
  subs; we don't expose that today.

---

## Pricing summary table

What the user pays today vs. on cycle_end for each transition (Indian card
mandate path):

| Transition | Today | At cycle_end |
|---|---|---|
| First subscribe | Plan price (₹2,999 / ₹9,999 / ₹16,999) + mandate auth | Plan price recurring |
| Upgrade — Schedule | ~₹5 mandate auth | New plan price |
| Upgrade — Now | New plan price | New plan price recurring |
| Downgrade | ~₹5 mandate auth | New (lower) plan price |
| Keep current (cancel pending) | ~₹5 mandate auth | Same plan recurring |
| Amend pending | ~₹5 mandate auth | New target plan price |
| Cancel | nothing | nothing — sub ends |
| Reactivate after pure cancel | ~₹5 mandate auth | Same plan recurring |

The ~₹5 is Razorpay's verify amount for registering a new e-mandate. It may
be refunded by some banks within 5–7 business days; this is between the
user and their bank. Production amounts can vary slightly (₹1, ₹2, ₹5, ₹10)
depending on the card network and bank.

---

## Future work

- **One-time-order proration** for upgrade-now: charge only the prorated
  difference via `orders.create`, then schedule the plan switch for
  cycle_end. Avoids the "forfeit unused days" UX hit. Adds an entire
  separate flow to maintain — defer until usage data shows it matters.
- **UPI mandate support**: UPI subscriptions on Razorpay DO support
  `subscriptions.update` PATCH. If we know the user is UPI-only we could
  attempt PATCH first and skip the cancel + recreate. Detection would
  require reading the customer's payment-method preference, which Razorpay
  exposes inconsistently — not worth pursuing until card-mandate UX is
  fully validated in production.
- **Annual billing**: schema supports it (`billingCycle: 'MONTHLY' | 'ANNUAL'`,
  `pricing.annual`, `razorpayPlanIds.annual`), but no UI exposes it yet.
  Annual would simplify the proration story significantly because the
  cycle_end is far away — no one minds waiting 11 months for a downgrade
  to take effect when they signed up annually.
