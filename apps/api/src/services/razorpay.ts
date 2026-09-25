/**
 * Razorpay Service
 * Handles Razorpay Subscriptions, Orders, Offers, and signature verification.
 */

import crypto from 'crypto';

function getConfig() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!keyId || !keySecret) {
        throw new Error('Razorpay not configured: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required');
    }

    return { keyId, keySecret, webhookSecret };
}

function getAuthHeader(): string {
    const { keyId, keySecret } = getConfig();
    return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function razorpayRequest(path: string, method: string, body?: object): Promise<any> {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: {
            'Authorization': getAuthHeader(),
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as any;

    if (!response.ok) {
        const errorMsg = data?.error?.description || data?.message || `Razorpay API error: ${response.status}`;
        throw new Error(errorMsg);
    }

    return data;
}

/**
 * Create a Razorpay Customer for linking to subscriptions.
 * Returns the customer ID to be passed to createRazorpaySubscription.
 */
export async function createRazorpayCustomer(
    name: string,
    email: string,
    contact: string,
): Promise<{ id: string }> {
    return razorpayRequest('/customers', 'POST', { name, email, contact });
}

/**
 * Fetch Razorpay customers by contact (phone number).
 * Used to recover an existing customer ID when creation fails with "already exists".
 */
export async function fetchRazorpayCustomersByContact(
    contact: string,
): Promise<{ items: Array<{ id: string }> }> {
    return razorpayRequest(`/customers?contact=${encodeURIComponent(contact)}&count=1`, 'GET');
}

/**
 * Create a Razorpay Subscription for recurring billing.
 * Notes are round-tripped via fetchRazorpaySubscription so the /verify path can
 * recover context (e.g. couponCode, planSlug) without reaching back into our DB.
 */
export async function createRazorpaySubscription(
    planId: string,
    totalCount: number,
    offerId?: string,
    customerId?: string,
    startAt?: number,
    notes?: Record<string, string>,
): Promise<{ id: string; shortUrl: string; status: string }> {
    const body: any = {
        plan_id: planId,
        total_count: totalCount,
        quantity: 1,
    };

    if (offerId) body.offer_id = offerId;
    if (customerId) body.customer_id = customerId;
    if (startAt) body.start_at = startAt;
    if (notes && Object.keys(notes).length > 0) body.notes = notes;

    return razorpayRequest('/subscriptions', 'POST', body);
}

/**
 * Cancel a Razorpay Subscription.
 */
export async function cancelRazorpaySubscription(
    subscriptionId: string,
    cancelAtCycleEnd: boolean = true,
): Promise<any> {
    return razorpayRequest(`/subscriptions/${subscriptionId}/cancel`, 'POST', {
        cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
    });
}

/**
 * Update a Razorpay Subscription (change plan).
 * Use schedule_change_at='now' for upgrades (charges difference immediately).
 * Use schedule_change_at='cycle_end' for downgrades (switches plan after current period).
 */
export async function updateRazorpaySubscription(
    subscriptionId: string,
    params: {
        planId: string;
        scheduleChangeAt: 'now' | 'cycle_end';
    },
): Promise<{ id: string; status: string; plan_id: string }> {
    return razorpayRequest(`/subscriptions/${subscriptionId}`, 'PATCH', {
        plan_id: params.planId,
        quantity: 1,
        schedule_change_at: params.scheduleChangeAt,
    });
}

/**
 * Create a Razorpay Order for one-time payments (credit packs).
 */
export async function createRazorpayOrder(
    amountPaise: number,
    receipt: string,
    currency: string = 'INR',
): Promise<{ id: string; amount: number; currency: string; status: string }> {
    return razorpayRequest('/orders', 'POST', {
        amount: amountPaise,
        currency,
        receipt,
    });
}

/**
 * Create a Razorpay Offer (for coupon discounts).
 */
export async function createRazorpayOffer(params: {
    name: string;
    paymentMethod: string;
    discountType: 'percentage' | 'flat';
    discountValue: number;
    maxBillingCycles?: number;
}): Promise<{ id: string }> {
    const body: any = {
        name: params.name,
        payment_method: params.paymentMethod,
        discount: {
            type: params.discountType,
            value: params.discountValue,
        },
    };

    if (params.maxBillingCycles) {
        body.max_billing_cycles = params.maxBillingCycles;
    }

    return razorpayRequest('/offers', 'POST', body);
}

/**
 * Verify Razorpay webhook signature (HMAC-SHA256).
 */
export function verifyWebhookSignature(body: string | Buffer, signature: string): boolean {
    const { webhookSecret } = getConfig();
    if (!webhookSecret) {
        throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
    }

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature),
    );
}

/**
 * Verify payment signature for client-side payment verification.
 * Used after Razorpay checkout to confirm payment authenticity.
 */
export function verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string,
): boolean {
    const { keySecret } = getConfig();
    const payload = `${orderId}|${paymentId}`;

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature),
    );
}

/**
 * Verify subscription-checkout signature.
 * Razorpay signs subscription payments as `payment_id|subscription_id`
 * (reverse of orders, which are `order_id|payment_id`).
 */
export function verifySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
): boolean {
    const { keySecret } = getConfig();
    const payload = `${paymentId}|${subscriptionId}`;

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature),
    );
}

/**
 * Fetch a Razorpay Subscription by ID.
 * Used as a webhook-independent fallback to reconcile local state after checkout.
 */
export async function fetchRazorpaySubscription(
    subscriptionId: string,
): Promise<{
    id: string;
    status: string;
    current_start: number | null;
    current_end: number | null;
    start_at?: number | null;
    customer_id?: string;
    plan_id: string;
    notes?: Record<string, string>;
}> {
    return razorpayRequest(`/subscriptions/${subscriptionId}`, 'GET');
}

/**
 * List Razorpay Subscriptions for a customer.
 * Used to sweep orphan in-flight (created/authenticated) subscriptions left
 * over from abandoned/failed checkouts before creating a new one.
 */
export async function listRazorpaySubscriptionsForCustomer(
    customerId: string,
    count: number = 25,
): Promise<{
    items: Array<{
        id: string;
        status: string;
        plan_id: string;
        customer_id?: string;
        created_at?: number;
    }>;
}> {
    return razorpayRequest(`/subscriptions?customer_id=${encodeURIComponent(customerId)}&count=${count}`, 'GET');
}

/**
 * Fetch a Razorpay Payment by ID.
 * Used during subscription verify to attach a real payment record to the invoice.
 */
export async function fetchRazorpayPayment(
    paymentId: string,
): Promise<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    invoice_id?: string | null;
}> {
    return razorpayRequest(`/payments/${paymentId}`, 'GET');
}

/**
 * Fetch a Razorpay Invoice by ID.
 */
export async function fetchRazorpayInvoice(
    invoiceId: string,
): Promise<{ id: string; short_url: string; status: string; amount: number; currency: string }> {
    return razorpayRequest(`/invoices/${invoiceId}`, 'GET');
}

/**
 * List Razorpay Invoices for a subscription.
 */
export async function listRazorpayInvoices(
    subscriptionId: string,
): Promise<{ items: Array<{ id: string; short_url: string; status: string; amount: number; currency: string }> }> {
    return razorpayRequest(`/invoices?type=invoice&subscription_id=${subscriptionId}`, 'GET');
}

/**
 * Anonymize a Razorpay customer's PII on account deletion.
 * Razorpay has no delete API; this clears name/email/contact so no identifiable
 * data remains while Razorpay retains the customer record for their own compliance.
 */
export async function anonymizeRazorpayCustomer(customerId: string): Promise<void> {
    await razorpayRequest(`/customers/${customerId}`, 'PATCH', {
        name: 'Deleted User',
        email: '',
        contact: '',
    });
}

/**
 * Get the Razorpay key ID for frontend checkout.
 */
export function getRazorpayKeyId(): string {
    return getConfig().keyId;
}

/**
 * Returns true if Razorpay credentials are present in the environment.
 */
export function isRazorpayConfigured(): boolean {
    return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
