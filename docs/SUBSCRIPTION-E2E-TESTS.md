# Subscription E2E Test Specification

Playwright MCP test scenarios covering the subscription cases in `SUBSCRIPTION-MODEL.md`.

Billing is manual: the owner requests a plan in the Profile sheet, and a
platform admin activates it through the API. No payment is taken in the app,
so no test card or checkout is involved.

**How to run**: Use Playwright MCP tool (manual, interactive testing via `claude mcp`)

```bash
# Prerequisite: Start the dev environment
npm run dev

# Use Claude Code with Playwright MCP to test each scenario
# Reference: docs/MCP-SETUP.md
```

**Admin steps** use the platform billing API with an access token for a user
whose role is `ADMIN` (there is no admin screen yet):

```bash
API=http://localhost:3001
ADMIN_TOKEN=...          # access token of an ADMIN user
RID=...                  # restaurantId under test

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" $API/api/platform-admin/billing/requests
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"months":1}' $API/api/platform-admin/billing/restaurants/$RID/activate
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"credits":50}' $API/api/platform-admin/billing/restaurants/$RID/credits
```

---

## Test Scenarios

### [S1] First Plan Request and Activation (NONE → ACTIVE Starter)

**Initial State**: User onboarded, no paid plan (free trial or free credits)

**Test Steps**:
1. Navigate to Profile → Subscription section
2. Verify "Change Plan" lists three plans, each with a "Request" button
3. Verify the footer reads "No payment is taken in the app. The RestroPulse team arranges payment with you directly."
4. Click "Request" on Starter
5. Verify the "Plan request received" banner: "You asked for the Starter plan on {date}"
6. Verify the Starter card shows "Requested"
7. Admin: `GET /requests` lists the restaurant with `requestedPlan.slug = 'starter'`
8. Admin: `POST /restaurants/:restaurantId/activate { "months": 1 }`
9. Reload the Profile sheet

**Expected**:
- Banner gone; current plan Starter, "Active", "Paid until {now + 1 month}"
- `/current` shows `status: 'ACTIVE'`, no `pendingPlanSnapshot`, `entitlement.activePlan: true`

---

### [S2] Upgrade Request

**Initial State**: `ACTIVE` Starter

**Test Steps**:
1. Open Profile → Subscription
2. Click "Upgrade" on Growth and confirm
3. Verify banner: "You asked to switch from Starter to Growth on {date}" and "You stay on Starter until then."
4. Admin: activate (no `planSlug` needed; the request is used)
5. Reload

**Expected**:
- Before activation: still on Starter, Growth card shows "Requested"
- After activation: current plan Growth, new period starting today

---

### [S3] Downgrade Request

**Initial State**: `ACTIVE` Premium

**Test Steps**:
1. Click "Downgrade" on Growth and confirm
2. Verify the request banner names Premium → Growth
3. Admin: activate

**Expected**: Same as S2; Growth active from activation

---

### [S4] Withdraw Request

**Initial State**: `ACTIVE` Premium with a request for Growth

**Test Steps**:
1. Click "Withdraw request" in the banner
2. Confirm "Withdraw your request for Growth?"
3. Verify banner disappears

**Expected**:
- `/current`: Premium still active, no `pendingPlanSnapshot`, no `planRequestedAt`
- Admin `GET /requests` no longer lists the restaurant

---

### [S5] Replace a Request

**Initial State**: `ACTIVE` Premium with a request for Growth

**Test Steps**:
1. Click "Downgrade" on Starter and confirm
2. Verify banner now names Starter

**Expected**: one request (Starter); `planRequestedAt` updated

---

### [S6] Renewal by Admin

**Initial State**: `ACTIVE` Premium, period ends in the future

**Test Steps**:
1. Note "Paid until {date}"
2. Admin: activate `{ "months": 3 }` (no request needed)
3. Reload

**Expected**: "Paid until" moves 3 months past the old end date; `currentPeriodStart` unchanged

---

### [S7] Cancel

**Initial State**: `ACTIVE` Premium

**Test Steps**:
1. Click "Cancel plan"
2. Verify "Cancel subscription?" dialog says the plan stays active until {period end}
3. Confirm

**Expected**:
- `cancelAtPeriodEnd=true`, `cancelledAt` set, any request withdrawn
- Date label switches to "Expires {date}"; "Reactivate" link visible
- Access continues until period end plus the 3-day grace

---

### [S8] Reactivate After Cancel

**Initial State**: `ACTIVE` Premium with `cancelAtPeriodEnd=true`

**Test Steps**:
1. Click "Reactivate"
2. Confirm "Continue on Premium?" ("Keep my plan")

**Expected**: `cancelAtPeriodEnd=false`; label back to "Paid until"

---

### [S9] Lapsed Plan and Grace

**Initial State**: `ACTIVE` Premium whose `currentPeriodEnd` is set (DB edit) to
(a) 2 days ago and (b) 4 days ago

**Test Steps**:
1. Load the Profile sheet and call `/current` for each case
2. In case (b), request any plan and have an admin activate it

**Expected**:
- (a) `entitlement.activePlan: true` (inside the 3-day grace)
- (b) `entitlement.activePlan: false`; requesting is allowed; activation starts a new period today

---

### [PERM-1] Current Plan Has No Button

**Initial State**: `ACTIVE` Premium

**Expected**: Premium card shows a check mark and no button; no API call possible

---

### [PERM-2] Requested Plan Has No Button

**Initial State**: `ACTIVE` Premium with a request for Growth

**Expected**: Growth card shows "Requested"; withdrawing lives in the banner

---

### [EDGE-1] Subscribe While Active

**Test Steps**: `POST /api/subscriptions/subscribe { planSlug: 'growth' }` with a live, non-cancelling plan

**Expected**: 409 "An active subscription already exists. Use change-plan to switch plans."

---

### [EDGE-2] Admin Bounds and Role

**Test Steps**:
1. Activate with `months: 0` and `months: 37`
2. Add `credits: 0`
3. Call any `/api/platform-admin/billing` route with an owner token

**Expected**: 400, 400, 400, 403

---

### [COUPON] Coupon on a Request

**Initial State**: No paid plan

**Test Steps**:
1. Enter a valid coupon in "Have a coupon code?" and click "Apply"
2. Request a plan the coupon applies to
3. Admin: `GET /requests` shows `couponCode`
4. Admin: activate the requested plan

**Expected**:
- Valid coupon: "Coupon applied!"; invalid: "Invalid coupon code"
- After activation a `couponRedemptions` record exists and the coupon's `redemptionCount` went up by 1
- If the admin activates a different plan, or the coupon expired meanwhile, no redemption is recorded

---

### [CREDITS] Admin Credit Grant

**Test Steps**:
1. Note the credits balance in the Profile sheet
2. Admin: `POST /restaurants/:restaurantId/credits { "credits": 50 }`
3. Reload

**Expected**: balance +50; the "Top Up Credits" card tells the owner to contact their account manager (no purchase button)

---

## Test Data Requirements

- **Firebase test phone number** for OTP auth
- **Test restaurant** already onboarded (reuse across runs)
- **An ADMIN user** and its access token for the admin steps
- **Subscription states**: reach them through the scenarios above, or by DB edits (e.g. `currentPeriodEnd` for S9)

## Coverage Summary

| Category | Tests | Status |
|----------|-------|--------|
| Core scenarios (S1–S9) | 9 | Documented |
| Plan-card states | 2 | Documented |
| Edge cases | 2 | Documented |
| Coupon | 1 | Documented |
| Credits | 1 | Documented |
| **Total** | **15** | **Documented** |

---

## Running Tests Manually via Playwright MCP

1. Ensure `npm run dev` is running (all services up)
2. Use Claude Code Playwright MCP tool:
   ```
   # Example: Test S2 (Upgrade Request)
   Use Playwright MCP to:
   - Navigate to http://localhost:3000
   - Click Profile button
   - Click "Upgrade" on Growth and confirm
   - Verify the "Plan request received" banner names Starter -> Growth
   ```
3. Run the admin step with curl, reload, and log observations in the test report

---

## Notes

- Tests are **manual via Playwright MCP** (interactive, not automated)
- Each test verifies both UI messaging and backend state via the `/current` endpoint
- Unit coverage for the same rules: `apps/api/tests/unit/subscriptions.test.ts`, `platform-billing.test.ts`, `manual-billing.test.ts`
