/**
 * DEMO MODE helpers (merchant dashboard).
 *
 * When the app is built/served with VITE_DEMO_MODE=true the dashboard runs as
 * a static preview with no API/DB/Firebase behind it: api.ts swaps in the
 * fixtures-backed client from demo-api.ts, the Login view accepts any
 * credentials and signs in the sample owner, and a small amber DEMO badge is
 * shown in the header. Mirrors apps/storefront/lib/demo.ts.
 */

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true';
}

/** Window event fired when a backend action is simulated in demo mode. */
export const DEMO_NOTICE_EVENT = 'rp:demo-notice';

const NOTICE_SHOWN_KEY = 'rp_demo_notice_shown';

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
