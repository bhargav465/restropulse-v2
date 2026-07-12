/**
 * Payment Service Type Definitions
 * Shared types for Razorpay integration across API, storefront, and web admin.
 */

// ----- Storefront ordering payments (payments collection) -----

/** Lifecycle of a single storefront order payment (Razorpay). */
export type PaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

/** One appended audit entry per payment lifecycle event. Never stores full payloads. */
export interface PaymentEventEntry {
  at: string;                                  // ISO
  /** e.g. 'intent_created' | 'verify_ok' | 'verify_failed' | 'webhook:payment.captured' | 'webhook:payment.failed' | 'retry_intent' */
  type: string;
  source: 'intent' | 'verify' | 'webhook';
  providerPaymentId?: string;
  errorCode?: string;
  errorDescription?: string;
}

/** One document per storefront order in the `payments` collection. */
export interface Payment {
  id: string;
  restaurantId: string;
  orderId: string;                             // our order _id (string)
  provider: 'razorpay';
  providerOrderId: string;                     // razorpay order id (order_xxx)
  providerPaymentId?: string;                  // pay_xxx once known
  amount: number;                              // PAISE (integer) — server-computed from order.totals.total
  currency: 'INR';
  status: PaymentStatus;
  signatureVerified: boolean;
  events: PaymentEventEntry[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Payload returned to the storefront to open Razorpay Checkout. */
export interface PaymentIntent {
  providerOrderId: string;
  keyId: string;
  amount: number;                              // PAISE
  currency: 'INR';
}

/**
 * Razorpay Order Payload
 * Response from createRazorpayOrder(), sent to frontend for checkout.
 */
export interface RazorpayOrderPayload {
  razorpayOrderId: string;
  amount: number;
  currency: 'INR';
}

/**
 * Razorpay Webhook Event
 * Parsed body from Razorpay webhook notifications.
 * Supports payment.authorized, payment.failed, order.paid events.
 */
export interface RazorpayWebhookEvent {
  event: 'payment.authorized' | 'payment.failed' | 'order.paid' | string;
  payload: {
    order?: {
      id: string;
      amount: number;
      amount_paid?: number;
      amount_due?: number;
      currency?: string;
      receipt?: string;
      status?: string;
      attempts?: number;
      notes?: Record<string, string>;
      created_at?: number;
    };
    payment?: {
      id: string;
      amount: number;
      currency?: string;
      status?: string;
      method?: string;
      order_id?: string;
      invoice_id?: string | null;
      international?: boolean;
      failed_at?: number;
      error_code?: string;
      error_description?: string;
      error_source?: string;
      error_reason?: string;
      error_step?: string;
      notes?: Record<string, string>;
      created_at?: number;
    };
    subscription?: {
      id: string;
      plan_id: string;
      customer_id?: string;
      status?: string;
      current_start?: number;
      current_end?: number;
      ended_at?: number;
      total_count?: number;
      paid_count?: number;
      customer_notify?: number;
      created_at?: number;
    };
    invoice?: {
      id: string;
      subscription_id?: string;
      order_id?: string;
      status?: string;
      amount?: number;
      amount_paid?: number;
      amount_due?: number;
      currency?: string;
      description?: string;
      short_url?: string;
      created_at?: number;
    };
  };
}

/**
 * Razorpay Payment Verification Request
 * Sent from frontend after checkout completion.
 */
export interface RazorpayPaymentVerificationRequest {
  orderId: string;
  paymentId: string;
  signature: string;
}

/**
 * Razorpay Webhook Signature Request
 * Internal structure for webhook signature verification.
 */
export interface RazorpayWebhookSignatureRequest {
  event: string;
  payload: RazorpayWebhookEvent['payload'];
  signature: string;
}

/**
 * Razorpay Order Creation Request
 * Parameters for createRazorpayOrder().
 */
export interface RazorpayOrderRequest {
  amount: number; // in paise (1 INR = 100 paise)
  orderId?: string; // optional, for Receipt field
  notes?: Record<string, string>;
}

/**
 * Razorpay Payment Details Response
 * Response from fetchRazorpayPayment().
 */
export interface RazorpayPaymentDetails {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  order_id?: string;
  invoice_id?: string | null;
  international?: boolean;
  failed_at?: number;
  error_code?: string;
  error_description?: string;
  notes?: Record<string, string>;
  created_at?: number;
}

/**
 * Razorpay Configuration
 * Subset of env vars needed for API calls.
 * Never expose RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET to client.
 */
export interface RazorpayConfig {
  keyId: string; // RAZORPAY_KEY_ID - safe for client (public key)
  keySecret: string; // RAZORPAY_KEY_SECRET - server-only
  webhookSecret?: string; // RAZORPAY_WEBHOOK_SECRET - server-only
}
