# Subscription E2E Test Specification

Comprehensive Playwright MCP test scenarios covering all subscription model cases from `SUBSCRIPTION-MODEL.md`.

**How to run**: Use Playwright MCP tool (manual, interactive testing via `claude mcp`)

```bash
# Prerequisite: Start the dev environment
npm run dev

# Use Claude Code with Playwright MCP to test each scenario
# Reference: docs/MCP-SETUP.md
```

---

## Test Scenarios

### [S1] First-Time Subscription (NONE → ACTIVE_Starter)

**Initial State**: User onboarded, no subscription (free credits)

**Test Steps**:
1. Navigate to Profile → Subscription section
2. Verify "Change Plan" section displays three plans
3. Click "Starter" plan
4. Verify dialog shows "Subscribe to Starter" with plan price (₹2,999)
5. Complete Razorpay checkout
6. Verify subscription status shows "Active" → "Premium" or "Starter" depending on test user

**Expected**: 
- Dialog vanishes after successful `/verify`
- Page shows current plan as Starter
- Credit display updated

---

### [S2] Upgrade Default — Schedule from Next Cycle

**Initial State**: `ACTIVE_Starter`

**Test Steps**:
1. Open Profile → Subscription
2. Click "Growth" plan
3. Verify dialog shows:
   - ₹5 mandate auth charge today
   - "Starter continues until {cycle_end}"
   - "₹9,999 from {cycle_end}"
4. Complete Razorpay checkout
5. Verify banner shows "You're switching from Starter to Growth on {date}"

**Expected**: 
- Local state: `ACTIVE_Starter | PENDING_Growth`
- Razorpay: Two subs created (old cancel-at-cycle-end, new deferred)
- Dialog mentions cycle_end date

---

### [S3] Upgrade Now — Immediate

**Initial State**: `ACTIVE_Starter`

**Test Steps**:
1. Open Profile → Subscription
2. Click "Growth" plan
3. Expand "Upgrade now" section (if available)
4. Verify dialog shows:
   - ₹9,999 full amount today
   - "Unused days from Starter are forfeit"
5. Complete checkout
6. Verify current plan shows "Growth" immediately (after `/verify`)

**Expected**:
- No pending state; immediate `ACTIVE_Growth`
- Dialog warns about forfeited days
- `/verify` returns plan snapshot with Growth

---

### [S4] Downgrade

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Open Profile → Subscription
2. Click "Growth" plan (lower tier)
3. Verify dialog shows:
   - ₹5 mandate auth today
   - "Premium continues until {cycle_end}"
   - "₹9,999 from {cycle_end}"
4. Complete checkout
5. Verify banner shows pending switch to Growth

**Expected**:
- Same as S2 (default upgrade path)
- `ACTIVE_Premium | PENDING_Growth`
- ₹5 charge today, ₹9,999 at cycle_end

---

### [S5] Keep Current Plan (Cancel Pending Change)

**Initial State**: `ACTIVE_Premium | PENDING_Growth`

**Test Steps**:
1. Open Profile → Subscription
2. Verify banner shows "You're switching from Premium to Growth on {date}"
3. Click "Cancel scheduled plan change" button
4. Verify "Keep Premium?" dialog appears
5. Confirm dialog
6. Verify banner disappears
7. Verify current plan still shows "Premium" with no pending

**Expected**:
- Dialog shows ₹5 mandate auth charge
- After confirm, webhook advances sub
- No pending flag in DB

---

### [S6] Amend Pending (Replace Target Plan)

**Initial State**: `ACTIVE_Premium | PENDING_Growth`

**Test Steps**:
1. Open Profile → Subscription
2. Click "Starter" plan (different from pending Growth)
3. Verify dialog shows:
   - ₹5 mandate auth
   - "Replaces the previously scheduled switch to Growth"
4. Complete checkout
5. Verify banner now shows "Switching to Starter on {date}"

**Expected**:
- Previous deferred Growth sub swept
- New Starter sub created with start_at=cycle_end
- `ACTIVE_Premium | PENDING_Starter`

---

### [S7] Pure Cancel

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Open Profile → Subscription section
2. Find and click "Cancel" or "Log Out" → "Delete Account"
3. Verify confirmation dialog
4. Confirm cancellation
5. Verify banner shows "Subscription ends on {date}"
6. Verify plan cards remain clickable (can re-subscribe)

**Expected**:
- Local doc: `cancelAtPeriodEnd=true`, `cancelledAt=<timestamp>`
- No pending change
- Razorpay sub in cancel-at-cycle-end state
- Access continues until cycle_end

---

### [S8] Reactivate After Pure Cancel

**Initial State**: `ACTIVE_Premium + cancelAtPeriodEnd=true`

**Test Steps**:
1. Open Profile → Subscription
2. Verify "Reactivate" button visible
3. Click "Reactivate"
4. Verify "Keep Premium?" dialog
5. Complete checkout (₹5 mandate auth)
6. Verify banner disappears
7. Verify current plan shows "Premium" active (no cancellation flag)

**Expected**:
- Same ₹5 mandate auth as keep-current
- `ACTIVE_Premium` (no pending, no cancel flags)
- Path B1: existing doc updated in-place

---

### [S9] Resubscribe from CANCELLED

**Initial State**: `CANCELLED` (cycle_end passed, subscription fully ended)

**Test Steps**:
1. Open Profile → Subscription
2. Click any plan (e.g., "Growth")
3. Verify dialog shows full first-cycle price (₹9,999)
4. Complete Razorpay checkout (fresh mandate)
5. Verify current plan shows "Growth" active

**Expected**:
- New MongoDB doc created (archive old)
- Fresh Razorpay sub (no start_at)
- Full first-cycle charge (no mandate auth refund)

---

### [PERM-1] Click Current Plan (No Pending)

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Open Profile → Subscription
2. Click "Premium" plan (current)
3. Verify NO dialog appears (no-op)

**Expected**: No action, no API call

---

### [PERM-2] Click Pending Plan

**Initial State**: `ACTIVE_Premium | PENDING_Growth`

**Test Steps**:
1. Open Profile → Subscription
2. Verify banner shows pending Growth
3. Click "Growth" plan
4. Verify NO new dialog (no-op echo)

**Expected**: No action, no API call

---

### [PERM-3] Amendment Sequence

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Click Growth → complete checkout (state: `ACTIVE_Premium | PENDING_Growth`)
2. Click Starter → complete checkout (state: `ACTIVE_Premium | PENDING_Starter`)
3. Click Premium → complete checkout (state: `ACTIVE_Premium`, no pending)
4. Click Growth again → complete checkout (state: `ACTIVE_Premium | PENDING_Growth`)

**Expected**:
- Each amendment costs ~₹5
- Each amendment sweeps prior deferred sub
- Final `/verify` materialises only the last state
- DB shows single `ACTIVE_Premium | PENDING_Growth` after all amendments

---

### [EDGE-1] Abandoned Checkout

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Click "Growth" plan
2. Dialog shows checkout button
3. Do NOT complete; close browser tab or press Escape
4. Reload page
5. Verify subscription panel loads correctly

**Expected**:
- Local DB unchanged from ACTIVE_Premium
- Razorpay deferred sub exists but local has no record
- Next amendment `/change-plan` sweeps orphan sub

---

### [EDGE-2] Failed Payment

**Initial State**: `ACTIVE_Premium`

**Test Steps**:
1. Click "Growth" plan
2. Enter invalid card (or use Razorpay test failure)
3. Verify error toast appears
4. Retry same plan

**Expected**:
- Razorpay sub stays in `created` state
- DB unchanged
- Next attempt sweeps the abandoned sub

---

### [EDGE-3] Webhook Race (Reconciliation)

**Initial State**: `AUTHENTICATED` (post-checkout, pre-webhook)

**Test Steps**:
1. Complete upgrade checkout (state: `AUTHENTICATED` locally)
2. Close browser immediately before webhook arrives
3. Reload page after 5 seconds
4. Verify `/current` endpoint called
5. Verify plan shows ACTIVE, not stuck in AUTHENTICATED

**Expected**:
- `/current` calls `reconcileSubscriptionWithRazorpay`
- Fetches live Razorpay state
- Advances AUTHENTICATED → ACTIVE
- User sees correct active plan

---

### [COUPON] Apply Coupon Code

**Initial State**: Any subscription state

**Test Steps**:
1. Open Profile → Subscription
2. Scroll to "Have a coupon code?" input
3. Enter valid coupon code
4. Click "Apply"
5. Verify success/error message

**Expected**:
- Valid coupon: discount applied to next checkout
- Invalid coupon: error toast, no change
- Dialog updates to show discount

---

### [PRICING] Verify Pricing Summary Table

**Reference**: SUBSCRIPTION-MODEL.md § Pricing summary table

| Transition | Today | At cycle_end | Test |
|---|---|---|---|
| First subscribe | Plan price | Plan price recurring | [S1] ✓ |
| Upgrade—Schedule | ~₹5 auth | New plan price | [S2] ✓ |
| Upgrade—Now | New plan price | New plan price recurring | [S3] ✓ |
| Downgrade | ~₹5 auth | New (lower) plan price | [S4] ✓ |
| Keep current | ~₹5 auth | Same plan recurring | [S5] ✓ |
| Amend pending | ~₹5 auth | New target plan price | [S6] ✓ |
| Cancel | nothing | nothing—sub ends | [S7] ✓ |
| Reactivate | ~₹5 auth | Same plan recurring | [S8] ✓ |

**Test Steps**:
1. For each scenario, capture the Razorpay checkout modal
2. Verify displayed amount matches table
3. Verify "cycle_end" date is shown for deferred charges

**Expected**: All pricing matches table; cycle_end dates are valid

---

## Test Data Requirements

- **Razorpay test keys** (configured in API .env for staging)
- **Firebase test phone number** for OTP auth
- **Test restaurant** already onboarded (reuse across runs)
- **Subscription states**: Manual DB edits or run through sequences to reach each state

## Coverage Summary

| Category | Tests | Status |
|----------|-------|--------|
| Core scenarios (S1–S9) | 9 | Documented |
| Permutation matrix | 3 | Documented |
| Edge cases | 3 | Documented |
| Coupon validation | 1 | Documented |
| Pricing verification | 1 | Documented |
| **Total** | **17** | **Documented** |

---

## Running Tests Manually via Playwright MCP

1. Ensure `npm run dev` is running (all services up)
2. Use Claude Code Playwright MCP tool:
   ```
   # Example: Test S2 (Upgrade Default)
   Use Playwright MCP to:
   - Navigate to http://localhost:3000
   - Click Profile button
   - Find and click Growth plan
   - Verify dialog mentions "₹5 today"
   - Verify "Starter continues until {date}"
   - Click checkout button (don't complete payment for non-destructive test)
   ```
3. Log observations in test report
4. For payment testing, use Razorpay test card: `4111 1111 1111 1111` + any future OTP

---

## Notes

- Tests are **manual via Playwright MCP** (interactive, not automated)
- Each test verifies both UI messaging and backend state via `/current` endpoint
- The orphan-sweep (B13 fix) is verified indirectly—if an amendment sequence completes without "duplicate sub" errors, sweep worked
- Reconciliation (B11 fix) is tested by checking page state after reload during AUTHENTICATED state
