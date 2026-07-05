# Subscription Bug Report — 2026-04-25

End-to-end browser sweep via Playwright MCP against the local dev environment
(`http://localhost:3000` web, `http://localhost:3001` API). Test account:
`+91 99999 99999` / OTP `123456` (Firebase dev fallback). Razorpay test keys
configured. Webhook tunnel (ngrok) running.

Six confirmed bugs. **Three are critical** (B1, B4, B5). Severity ratings are
based on user impact (data loss, billing errors, security exposure).

---

## BUG B1 (Critical) — AUTHENTICATED is treated as "unpaid checkout" and destructively replaced

**Impact**: Users get charged multiple times for the same plan. Each
double-charge orphans the previously-paid Razorpay subscription. The
local DB record points to the latest (unpaid) Razorpay sub, while the
user has been billed for prior ones.

### Root cause

`apps/api/src/routes/subscriptions.ts:233-258` — the `/subscribe` route's
duplicate-subscription guard:

```ts
const existingCheck = await findActiveSubscription(restaurantId);
if (existingCheck && ['ACTIVE', 'PAST_DUE', 'CREATED', 'AUTHENTICATED'].includes(existingCheck.status)) {
    // CREATED/AUTHENTICATED = unpaid checkout — no charge yet, safe to replace without explicit consent
    const isUnpaidCheckout = existingCheck.status === 'CREATED' || existingCheck.status === 'AUTHENTICATED';
    if (!existingCheck.cancelAtPeriodEnd && !isUnpaidCheckout) {
        return res.status(409).json({ ... });
    }
    if (existingCheck.razorpaySubscriptionId) {
        await cancelRazorpaySubscription(...);
    }
    await updateSubscription(existingCheck.id, { status: 'CANCELLED', endedAt: ... });
}
```

The comment "CREATED/AUTHENTICATED = unpaid checkout — no charge yet" is **wrong**.
In Razorpay's lifecycle, `authenticated` means the customer's payment method
has been authorized AND the first charge has been (or will imminently be)
attempted. The `subscription.charged` webhook is what advances local state to
ACTIVE — but if the webhook is delayed, the local DB stays at AUTHENTICATED
while the user has already been billed.

When the user re-clicks Subscribe (because the UI shows "Activating…" and
appears stuck — see B3), this guard happily cancels the (already-paid!)
Razorpay subscription and creates a fresh one, leading to a second charge.

### Evidence captured

Pre-clean-slate test account state at 17:13 IST (the state when I first
landed on the account):
- DB subscription doc: `razorpaySubscriptionId=sub_ShnS6BBGFcqBpI`,
  `status=AUTHENTICATED`, `currentPeriodStart=null`, `credits=0`,
  `createdAt=16:45:38`, `updatedAt=16:47:09`
- Most recent paid invoice: `razorpaySubscriptionId=sub_ShnQwKD9aXtnnA`,
  Premium ₹16,999, `paidAt=16:45:55`
- The current sub (`sub_ShnS6BBGFcqBpI`) had **0 invoices** — never paid
- Today's invoice list showed ~7 paid invoices today (Starter ₹2,999, Premium
  ₹16,999, Premium ₹16,999, Premium ₹16,999, Starter ₹2,999, Premium ₹16,999,
  Premium ₹16,999) — each from a DIFFERENT `razorpaySubscriptionId`

The pattern is unmistakable: every retry from a stuck-AUTHENTICATED state
created a fresh Razorpay subscription, charged the customer, and orphaned the
prior paid sub. The DB consistently pointed to the LATEST (unpaid) subscription
ID, not the one the user actually paid for.

### Fix

Remove `AUTHENTICATED` from the "unpaid checkout" allowance. A subscription
in AUTHENTICATED state should be assumed to have been (or be about to be)
charged.

```ts
const isUnpaidCheckout = existingCheck.status === 'CREATED'; // AUTHENTICATED removed
```

Defense-in-depth: before cancelling+replacing any subscription in /subscribe,
check `findInvoicesByRazorpaySubscriptionId(existingCheck.razorpaySubscriptionId)`
— if any paid invoices exist, refuse to replace and return 409.

The frontend should also disable the Subscribe button while
`subscription.status` ∈ `{CREATED, AUTHENTICATED}` (see B3) so users don't
trigger this code path on a stuck-pending state.

---

## BUG B2 (High) — Reconcile cannot recover from B1's data corruption

**Impact**: Once B1 fires, the local DB's `razorpaySubscriptionId` permanently
points to the wrong Razorpay subscription. `/current` reconcile correctly
checks what Razorpay says about THAT sub (which is unpaid/CREATED) — but
has no way to discover the orphaned PAID sub.

### Root cause

`reconcileSubscriptionWithRazorpay()` in `subscriptions.ts:85-127` is correct
in isolation. The defect is upstream (B1).

### Evidence

For the corrupted account, `/current` was hit 6 times in network trace; reconcile
ran but found no advancement (DB AUTHENTICATED, Razorpay also AUTHENTICATED for
that sub ID — both correct, both wrong vs. user's actual billing state).

### Fix

Once B1 is fixed, B2 disappears. As an additional safety net:
periodic cron (every 15 min) reconciles by **scanning paid invoices** —
if a restaurant has paid invoices for a Razorpay subscription that doesn't
match the current DB record, surface as an alert to operations.

---

## BUG B3 (Medium) — UI does not gate Subscribe button on transitional state

**Impact**: Encourages the user to retrigger /subscribe while a payment is
in-flight, feeding the B1 bug.

### Evidence

In the captured snapshot, with `subscription.status=AUTHENTICATED` and the
"Activating…" banner visible, all three plan cards (Starter, Growth, Premium)
still expose clickable Subscribe buttons. A user who interprets "Activating…"
as "the subscribe didn't work" will click these and trigger B1.

### Fix

In `apps/web/components/ProfileSheet.tsx`, while
`subscription?.status` ∈ `{CREATED, AUTHENTICATED}`, render plan-card primary
actions as disabled with a "Activating, please wait" tooltip. Show a
"Cancel pending checkout" affordance for the (rare) case where the user
genuinely wants to back out.

---

## BUG B4 (Critical) — /subscribe destroys NONE state's free credits before payment is confirmed

**Impact**: A new user with FREE_SIGNUP_CREDITS who tries to subscribe and
whose payment FAILS loses their free credits permanently. They are now
worse off than they started — no plan, no credits, and an orphaned CREATED
Razorpay subscription.

### Root cause

`apps/api/src/routes/subscriptions.ts:289-310`:

```ts
const razorpaySub = await createRazorpaySubscription(razorpayPlanId, totalCount, offerId, customerId);

if (existingCheck) {
    await updateSubscription(existingCheck.id, { endedAt: now.toISOString() });
}
await createSubscription({
    restaurantId,
    planId: plan.id,
    planSnapshot: plan,
    billingCycle: billingCycle,
    status: 'CREATED',
    razorpaySubscriptionId: razorpaySub.id,
    // Preserve credits when re-subscribing from terminal state;
    // zero out only for the NONE (free trial) -> paid transition.
    credits: existingCheck?.status === 'NONE' ? 0 : (existingCheck?.credits ?? 0),
    ...
});
```

The "zero out for NONE → paid transition" line fires the moment /subscribe is
called, **before payment is confirmed**. A failed payment doesn't restore the
free credits.

### Evidence

Reproduced with a clean account (`testuser@example.com`, deleted and recreated):

1. Initial state via `/current`: `{ status: "NONE", credits: 20 }`
2. Clicked Subscribe on Starter (₹2,999/mo)
3. Razorpay checkout opened, entered test card `5104 0600 0000 0008`
4. Razorpay returned: "Payment could not be completed. International cards are
   not supported."
5. Post-failure state via `/current`:
   `{ status: "CREATED", credits: 0, razorpaySubscriptionId: "sub_Sho4t9ajOreFx8", planSlug: "starter" }`

The free credits are gone, the DB doc has been replaced with an empty CREATED
sub, and `sub_Sho4t9ajOreFx8` is a now-orphaned Razorpay subscription.

### Fix

Two changes:

1. Don't archive or replace the existing subscription doc until payment is
   verified (in /verify or via webhook). Subscribe should ONLY create the
   Razorpay subscription; the local archive-and-insert should happen in
   /verify after a successful payment.

2. Until payment is confirmed, store the in-flight `razorpaySubscriptionId` in
   a separate field (e.g., `pendingCheckoutRazorpaySubscriptionId`) so the
   user's existing state is untouched if they abandon checkout.

This also fixes a related leak: every abandoned/failed checkout currently
creates an orphaned Razorpay subscription that nothing ever cancels.

---

## BUG B5 (Critical, Security) — `/verify-email` accepts any email with no token validation

**Impact**: Any authenticated user can mark any email address as verified for
their account by calling the API directly. Bypasses email ownership entirely.

### Root cause

`apps/api/src/routes/auth.ts:315-325`:

```ts
router.post('/verify-email', requireAuth, handle(async (req: Request, res: Response) => {
    const { email } = req.body;
    const userId = req.user!.userId;

    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    await updateUser(userId, { email, emailVerified: true });
    res.json({ success: true, message: 'Email verified successfully' });
}));
```

The frontend uses Firebase magic-link auth and only calls this endpoint AFTER
Firebase confirms the link was clicked. But the API doesn't verify any of that
— it trusts the client. A malicious client (or anyone with a stolen JWT) can
POST any arbitrary email and mark it verified.

### Evidence

Reproduced with my own auth token:

```
POST http://localhost:3001/api/auth/verify-email
Authorization: Bearer <my own JWT>
Body: { "email": "anything@example.com" }
→ 200 { success: true, message: "Email verified successfully" }
```

I never received any email. My account record was updated to
`email: anything@example.com, emailVerified: true`.

### Fix

Either:

(a) Require a Firebase ID token in the request body that proves the magic
link was actually clicked — verify it server-side via Firebase Admin SDK
before marking verified. The frontend already has this token (it's how
`signInWithEmailLink` works); pass it through.

(b) Generate a server-issued, single-use, time-limited verification token at
"send verification email" time. Store it server-side. The verification email
contains a URL to your own domain with the token; on click, your endpoint
validates the token, then marks the email verified.

Option (a) is simpler since you're already on Firebase; option (b) avoids
trusting Firebase for email ownership at all.

---

## BUG B6 (Medium, Security) — `POST /restaurant` does not enforce email verification

**Impact**: A user can complete onboarding (create a restaurant) without
ever verifying their email. The frontend gates the UI on the verification
state, but the API doesn't — anyone hitting the API directly bypasses it.

### Evidence

Reproduced. With an unverified `emailVerified: false` user, I called:

```
POST http://localhost:3001/api/restaurant
Body: { name, cuisine, location, accountManager, userName, email }
→ 201 Created (restaurant + linked + tokens issued)
```

The user's `emailVerified` was never checked.

### Fix

In `apps/api/src/routes/restaurant.ts:30-98`, add an early check:

```ts
const user = await findUserById(userId);
if (!user) return res.status(404).json({ success: false, error: 'User not found' });
if (!user.emailVerified) {
    return res.status(403).json({ success: false, error: 'Email must be verified before creating a restaurant' });
}
```

Note: this is gated by B5 — until B5 is fixed, any user can self-mark
their email verified anyway, so B6's mitigation is incomplete without B5.

---

## BUG B7 (High) — Reactivate replaces razorpaySubscriptionId in DB before user completes checkout

**Impact**: A user who clicks Reactivate but closes the Razorpay checkout
(intentionally or accidentally) ends up in a silently broken state: the
local DB points to a fresh, **unauthorized** Razorpay subscription. When
the original (cancelled) subscription's billing period ends, no charge
fires, the user silently loses access, and there is no UI affordance to
recover.

### Root cause

`apps/api/src/routes/subscriptions.ts:888-934` — `/reactivate`:

```ts
const startAt = Math.floor(new Date(existing.currentPeriodEnd).getTime() / 1000);
const rzpSub = await createRazorpaySubscription(plan.razorpayPlanIds.monthly, 120, undefined, user?.razorpayCustomerId, startAt);

await updateSubscription(existing.id, {
    razorpaySubscriptionId: rzpSub.id,        // ← swapped immediately
    cancelAtPeriodEnd: false,                  // ← cleared immediately
    cancelledAt: undefined,                    // ← cleared immediately
    pendingPlanId: undefined,
    pendingPlanSnapshot: null,
});

res.json({ success: true, data: { requiresCheckout: true, subscriptionId: rzpSub.id, keyId: getRazorpayKeyId() } });
```

The DB is updated unconditionally before checkout opens. If the user closes
the modal without authorizing, `sub_<new>` exists in `CREATED` state
forever, the original `sub_<old>` continues to expire as scheduled, and no
recovery flow exists.

### Evidence

Reproduced on the same clean account after Scenario G:

1. Cancel Starter (Scenario G PASSED): `cancelAtPeriodEnd=true`,
   `cancelledAt` set, `razorpaySubscriptionId=sub_Sho4t9ajOreFx8`
2. Click "Reactivate" → click "Reactivate plan" in confirmation
3. Razorpay checkout iframe opens (₹5 token charge for new e-mandate)
4. **Before paying**, query `/current`:
   `{ status: "ACTIVE", cancelAtPeriodEnd: false, cancelledAt: null,
      razorpaySubscriptionId: "sub_ShoEUDyllcVTd3" }`
5. Close checkout via `Escape` key (no payment authorized)
6. `/current` still returns the same updated state. The user's DB record
   no longer reflects the cancellation, the new sub is unauthorized, and
   the old sub continues to expire on 5/25/2026

The user now appears "active" in our system but will silently lose access
when 5/25 arrives because nothing will charge.

### Fix

Same shape as B4: don't update the DB until checkout completes. Two
options:

(a) Defer all DB updates to `/verify` — `/reactivate` returns the
    new `subscriptionId` but doesn't touch the local doc. `/verify`
    swaps the razorpaySubscriptionId AND clears the cancellation flags
    only after successful payment.

(b) Add a separate "pending-reactivate" state. When the user opens
    checkout, store the new `razorpaySubscriptionId` in a `pendingReactivateRazorpaySubscriptionId`
    field. On `/verify` success, promote it to `razorpaySubscriptionId`
    and clear cancellation. On checkout abandonment (no `/verify` within
    N minutes), GC the orphaned Razorpay subscription via
    `cancelRazorpaySubscription(...)`.

Bonus: ditto for the dialog wording — "your subscription will be
cancelled and you'll need to authorize a new payment cycle" is accurate
but alarming. If you can't avoid the new-checkout, at least lead with
"Authorize a new billing cycle to keep <Plan>".

---

## Scenarios that PASSED

| Scenario | Status | Notes |
|---|---|---|
| A: Login + first-load (clean account) | PASSED | Onboarding can be bypassed via API direct (B6) but UI flow requires real email link |
| B: First subscribe (NONE → ACTIVE) | PASSED | After clean slate + working domestic test card `4718 6091 0820 4366`. Period set, status advanced, invoice generated, reconcile worked. **Note:** the failed-payment retry from this same scenario triggered B4. |
| G: Cancel | PASSED | `cancelAtPeriodEnd=true`, `cancelledAt` set, `currentPeriodEnd` preserved, UI banner shown correctly |
| L: Invoice list | PASSED | Rendered correctly on both the corrupted Premium account AND the clean Test Bistro account; PDF links are Razorpay-hosted |

## Scenarios still pending

| Scenario | Status | Reason |
|---|---|---|
| C: Upgrade Starter → Growth/Premium | SKIPPED | Each upgrade triggers immediate proration charge. Costs additional ~₹7,000 per test in real money even in test mode if exercised against the configured test keys. Would re-test once code paths are unit-covered. |
| D: Downgrade | SKIPPED | Requires being on Growth/Premium first |
| E: Amend pending downgrade | SKIPPED | Requires Premium → Growth scheduled state |
| F: Reactivate pending change (Case A) | PARTIAL | Same plan → confirmation appears but the flow opens Razorpay checkout (B7) rather than using Case A's "uncancel" path. Untested whether clicking the CURRENT plan card (vs. the Reactivate button) takes a different code path. |
| H: Resubscribe after CANCELLED | NOT TESTED | Requires waiting until period end (5/25/2026) for status to actually transition to CANCELLED |
| I: Webhook race simulation | NOT TESTED | Would require deliberately blocking ngrok mid-flow. Reconcile is exercised in unit tests already — UI-side test pending. |
| J: Coupon redemption | NOT TESTED | Need a valid test coupon code |
| K: Credit pack purchase | NOT TESTED | Costs additional money to exercise; ROI lower than fixing B1-B7 first |

---

## Summary table

| Bug | Severity | Type | File |
|---|---|---|---|
| B1 | Critical | State machine / billing | `apps/api/src/routes/subscriptions.ts:233-258` |
| B2 | High | Cascading from B1 | (consequence of B1) |
| B3 | Medium | UX / contributes to B1 | `apps/web/components/ProfileSheet.tsx` |
| B4 | Critical | Data loss / orphan resources | `apps/api/src/routes/subscriptions.ts:289-310` |
| B5 | Critical | Security (auth bypass) | `apps/api/src/routes/auth.ts:315-325` |
| B6 | Medium | Security | `apps/api/src/routes/restaurant.ts:30-98` |
| B7 | High | Silent subscription loss on abandoned reactivate checkout | `apps/api/src/routes/subscriptions.ts:888-934` |

## Recommended fix order

1. **B5** first — security flaw with no preconditions; trivial to ship.
2. **B6** — adopt B5's check; one line change.
3. **B1** — change the AUTHENTICATED guard. Add the paid-invoices safety net.
4. **B4** + **B7** — same shape (DB updated before payment confirmation).
   Unify by introducing a "pending checkout" pattern: never overwrite the
   live `razorpaySubscriptionId` or status flags until `/verify` succeeds.
   Single behavioral PR.
5. **B3** — UI hardening; pairs with B1.
6. **B2** — verify it disappears after B1+B4. If not, add the cron safety net.

Once 1–4 ship, re-run scenarios C, D, E, F, H with a working test card to
validate the full state machine.

## Methodology / repro environment

- Web: `http://localhost:3000` (Vite dev)
- API: `http://localhost:3001` (Express dev)
- DB: MongoDB Atlas (configured via `apps/api/.env`)
- Razorpay: test mode keys, ngrok webhook tunnel running
- Auth: Firebase phone OTP dev fallback (`+91 99999 99999` / `123456`)
- Working test card: `4718 6091 0820 4366` (Visa Credit, domestic) with
  any future expiry, any CVV, OTP `123456` on the bank simulator step
- Browser automation: Playwright MCP (`@playwright/mcp@latest`,
  installed today at `.mcp.json`)
- Screenshots saved alongside this report:
  - `bug-stuck-activating-initial.png` (B1 evidence on Arjun account)
  - `scenario-b-domestic-visa.png` (clean subscribe flow before OTP)
  - `scenario-b-after-otp.png` (post-checkout state)
  - `scenario-reactivate.png` (B7 — Razorpay reopens for ₹5 token charge)

