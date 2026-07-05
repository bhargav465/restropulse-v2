/**
 * DEMO MODE helpers.
 *
 * When the app is built/served with VITE_DEMO_MODE=true the storefront runs
 * as a static preview with no API/DB behind it: api.ts swaps in the
 * fixtures-backed client from demo-api.ts, analytics become console.debug
 * no-ops, and "/" redirects to the demo storefront.
 */

/** Slug of the built-in demo storefront (mirrors packages/db/src/seeds/ordering-demo.ts). */
export const DEMO_SLUG = 'demo';

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true';
}

/** Window event fired when a backend action is simulated in demo mode. */
export const DEMO_NOTICE_EVENT = 'sf:demo-notice';

const NOTICE_SHOWN_KEY = 'sf_demo_notice_shown';

/**
 * Signals that an action which would normally hit the real backend was
 * simulated locally. components/DemoNotice.tsx listens for this and shows a
 * dismissible "Demo preview — backend not connected" notice once per
 * browser session.
 */
export function notifyDemoBackendAction(): void {
  if (!isDemoMode() || typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem(NOTICE_SHOWN_KEY)) return;
    sessionStorage.setItem(NOTICE_SHOWN_KEY, '1');
  } catch {
    /* private mode — fall through and show the notice anyway */
  }
  window.dispatchEvent(new CustomEvent(DEMO_NOTICE_EVENT));
}
