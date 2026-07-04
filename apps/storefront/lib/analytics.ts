/**
 * Lightweight storefront analytics.
 * Fires fire-and-forget events to POST /api/storefront/:slug/events with a
 * sessionId persisted in localStorage.
 */
import { getApiBaseUrl } from '../api';

const SESSION_KEY = 'sf_session_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export type StorefrontEventName =
  | 'page_view'
  | 'menu_view'
  | 'item_view'
  | 'add_to_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'login_prompt'
  | 'order_placed';

export function track(
  slug: string,
  name: StorefrontEventName,
  payload?: Record<string, unknown>,
  customerId?: string,
): void {
  if (!slug) return;
  try {
    void fetch(`${getApiBaseUrl()}/storefront/${encodeURIComponent(slug)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        sessionId: getSessionId(),
        ...(customerId ? { customerId } : {}),
        ...(payload ? { payload } : {}),
      }),
      keepalive: true,
    }).catch(() => { /* analytics must never break the UI */ });
  } catch {
    /* ignore */
  }
}
