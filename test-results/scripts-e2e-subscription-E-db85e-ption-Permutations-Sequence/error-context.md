# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scripts\e2e-subscription.spec.ts >> Execute Subscription Permutations Sequence
- Location: scripts\e2e-subscription.spec.ts:136:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Growth Active')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Growth Active')

```

# Test source

```ts
  64  |         cancelAtPeriodEnd,
  65  |         cancelledAt: cancelAtPeriodEnd ? now : null,
  66  |         pendingPlanSnapshot: pendingSlug ? plans[pendingSlug] : null,
  67  |         currentPeriodStart: start,
  68  |         currentPeriodEnd: end,
  69  |         updatedAt: now,
  70  |         createdAt: now,
  71  |         restaurantId: RESTAURANT_ID,
  72  |         razorpaySubscriptionId: 'sub_' + Math.random().toString(36).substring(7)
  73  |     };
  74  |     if (pendingSlug) {
  75  |         sub.pendingRazorpaySubscriptionId = 'sub_pending_' + Math.random().toString(36).substring(7);
  76  |     }
  77  |     await db.collection('subscriptions').updateMany({ restaurantId: RESTAURANT_ID, endedAt: null }, { $set: { endedAt: now } });
  78  |     await db.collection('subscriptions').insertOne(sub);
  79  | }
  80  | 
  81  | async function handleRazorpayCheckout(page, expectedAmountStr) {
  82  |     console.log(`\n\n[Rzp Checkout] Starting for expected amount: ${expectedAmountStr}`);
  83  |     
  84  |     // Wait for the iframe
  85  |     const checkoutFrame = page.frameLocator('.razorpay-checkout-frame').first();
  86  |     await expect(checkoutFrame.getByText('Price Summary')).toBeVisible({ timeout: 20000 });
  87  |     
  88  |     // Verify amount in summary
  89  |     const summary = await checkoutFrame.locator('.price-summary-wrapper').innerText();
  90  |     console.log(`[Rzp Checkout] Rendered Price Summary: ${summary.replace(/\n+/g, ' ')}`);
  91  |     
  92  |     // Check if the expected amount shows up
  93  |     if (expectedAmountStr && !summary.includes(expectedAmountStr)) {
  94  |         console.warn(`[Rzp Checkout] WARNING: Expected amount ${expectedAmountStr} not found in summary!`);
  95  |     }
  96  | 
  97  |     console.log(`[Rzp Checkout] Filling card details...`);
  98  |     
  99  |     // Attempt card fill
  100 |     const cardOption = checkoutFrame.getByText('Card', { exact: true }).or(checkoutFrame.getByText('Cards', { exact: true }));
  101 |     if (await cardOption.count() > 0) {
  102 |         await cardOption.first().click();
  103 |     }
  104 |     
  105 |     const cardInput = checkoutFrame.locator('input[id="card_number"]');
  106 |     if (await cardInput.isVisible()) {
  107 |         console.log('[Rzp Checkout] Using Test Card: 4718 6091 0820 4366, random CVV, future date');
  108 |         await cardInput.fill('4718 6091 0820 4366'); 
  109 |         await checkoutFrame.locator('input[id="card_expiry"]').fill('12/30'); 
  110 |         await checkoutFrame.locator('input[id="card_name"]').fill('Test User');
  111 |         await checkoutFrame.locator('input[id="card_cvv"]').fill('123'); 
  112 |         
  113 |         const payBtn = checkoutFrame.locator('button', { hasText: 'Pay' }).first();
  114 |         if (await payBtn.isVisible()) {
  115 |             await payBtn.click();
  116 |         } else {
  117 |              await checkoutFrame.locator('button[id="footer-cta"]').click();
  118 |         }
  119 |     } 
  120 | 
  121 |     await page.waitForTimeout(4000);
  122 |     const bankFrame = checkoutFrame.frameLocator('iframe').first();  // The bank popup is often an iframe inside the popup frame
  123 |     const successBtn = bankFrame.locator('button', { hasText: 'Success' }).or(page.getByText('Success'));
  124 |     if (await successBtn.count() > 0) {
  125 |         console.log('[Rzp Checkout] Clicking Success on mock bank page...');
  126 |         await successBtn.first().click();
  127 |     } else {
  128 |         console.log('[Rzp Checkout] Success button not found. Assuming payment proceeded directly or was skipped.');
  129 |     }
  130 |     
  131 |     // Wait for the modal to close and return back to app UI
  132 |     await expect(page.locator('.razorpay-checkout-frame')).toBeHidden({ timeout: 30000 }).catch(() => console.log('Iframe not completely hidden, proceeding...'));
  133 |     console.log('[Rzp Checkout] Payment simulated successfully and modal closed.');
  134 | }
  135 | 
  136 | test('Execute Subscription Permutations Sequence', async ({ page }) => {
  137 |     test.setTimeout(180000); 
  138 | 
  139 |     page.on('response', async response => {
  140 |         if (response.url().includes('/api/')) {
  141 |             const body = await response.json().catch(() => null);
  142 |             const status = response.status();
  143 |             // log only paths and summary to prevent huge output
  144 |             console.log(`[API Response] ${status} ${new URL(response.url()).pathname} ->`, body ? JSON.stringify(body).slice(0, 150) : null);
  145 |         }
  146 |     });
  147 | 
  148 |     console.log('\n--- 0. Starting with Growth baseline ---');
  149 |     await seedSubscriptionState('ACTIVE', 'growth');
  150 | 
  151 |     await page.goto(`${BASE_URL}/login`);
  152 |     await page.getByLabel('Phone number').fill(TARGET_PHONE);
  153 |     await page.getByRole('button', { name: 'Get OTP' }).click();
  154 |     await page.waitForTimeout(1000);
  155 |     
  156 |     for (let i = 1; i <= 6; i++) {
  157 |         await page.getByRole('textbox', { name: `OTP digit ${i}` }).fill(i.toString()); // using 123456
  158 |     }
  159 |     await page.waitForTimeout(4000);
  160 |     await page.goto(`${BASE_URL}/settings/subscription#subscription`);
  161 | 
  162 |     await page.waitForTimeout(4000);
  163 |     await page.screenshot({ path: 'test-fails.png' });
> 164 |     await expect(page.getByText('Growth Active')).toBeVisible({ timeout: 10000 });
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  165 | 
  166 |     console.log('\n\n--- Permutation 1: Growth to Premium Upgrade ---');
  167 |     await page.locator('div').filter({ hasText: /^Premium.*Upgrade$/ }).getByRole('button', { name: 'Upgrade' }).click();
  168 |     await expect(page.getByRole('heading', { name: 'Upgrade to Premium?' })).toBeVisible();
  169 |     await page.getByRole('button', { name: 'Upgrade now' }).click();
  170 |     
  171 |     await handleRazorpayCheckout(page, '16,999'); 
  172 |     await page.waitForTimeout(2000);
  173 |     await expect(page.getByText(/^Premium.*Active$/)).toBeVisible({ timeout: 15000 });
  174 |     console.log('[Validated] Changed to Premium Active correctly.');
  175 | 
  176 |     console.log('\n\n--- Permutation 2: Premium Cancel ---');
  177 |     await page.getByRole('button', { name: 'Cancel plan' }).click();
  178 |     await page.getByRole('button', { name: 'Yes, cancel plan' }).click();
  179 |     
  180 |     await expect(page.getByText('Premium Active (Canceling)')).toBeVisible({ timeout: 10000 });
  181 |     console.log('[Validated] Properly displayed Premium Canceling state.');
  182 | 
  183 |     console.log('\n\n--- Permutation 3: Reactivate ---');
  184 |     await page.getByRole('button', { name: 'Reactivate plan' }).click();
  185 |     
  186 |     await handleRazorpayCheckout(page, '5'); // Validation charge for reactivation
  187 |     await page.waitForTimeout(2000);
  188 |     await expect(page.getByText(/^Premium.*Active$/)).toBeVisible({ timeout: 15000 });
  189 |     console.log('[Validated] Reactivated successfully.');
  190 | 
  191 |     console.log('\n\n--- Permutation 4: Downgrade to Starter ---');
  192 |     await page.locator('div').filter({ hasText: /^Starter.*Downgrade$/ }).getByRole('button', { name: 'Downgrade' }).click();
  193 |     await expect(page.getByRole('heading', { name: 'Downgrade to Starter?' })).toBeVisible();
  194 |     await page.getByRole('button', { name: 'Schedule from next cycle' }).click();
  195 |     
  196 |     await expect(page.getByText('Premium Active (Changes to Starter)')).toBeVisible({ timeout: 10000 });
  197 |     console.log('[Validated] Scheduled downgrade successfully.');
  198 | 
  199 |     console.log('\n\n--- Permutation 5: Amend Pending to Growth ---');
  200 |     await page.locator('div').filter({ hasText: /^Growth.*Upgrade$/ }).getByRole('button', { name: 'Upgrade' }).click();
  201 |     await page.getByRole('button', { name: 'Change scheduled plan' }).click();
  202 |     
  203 |     await expect(page.getByText('Premium Active (Changes to Growth)')).toBeVisible({ timeout: 10000 });
  204 |     console.log('[Validated] Amended the scheduled plan correctly.');
  205 | });
  206 | 
```