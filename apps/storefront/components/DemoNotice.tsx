import React, { useEffect, useState } from 'react';
import { DEMO_NOTICE_EVENT, isDemoMode } from '../lib/demo';

/**
 * DEMO MODE only: small dismissible toast shown (once per browser session)
 * when an action that would need the real backend is simulated locally.
 * Triggered via notifyDemoBackendAction() in lib/demo.ts.
 */
const DemoNotice: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isDemoMode()) return undefined;
    const show = () => setVisible(true);
    window.addEventListener(DEMO_NOTICE_EVENT, show);
    return () => window.removeEventListener(DEMO_NOTICE_EVENT, show);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 max-w-[92vw] bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg"
    >
      <span>Demo preview — backend not connected</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss demo notice"
        className="shrink-0 text-slate-300 hover:text-white font-bold"
      >
        ✕
      </button>
    </div>
  );
};

export default DemoNotice;
