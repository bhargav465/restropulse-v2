/**
 * The worker's heartbeat: every `intervalMs` drain due delivery jobs; every
 * `pollEveryMs` also ask polled partners for news. A pass never overlaps the
 * previous one, and `stop()` waits for the pass in flight.
 */

import { pollLiveShipments, processDueJobs, type WorkerDeps } from '@restropulse/delivery';

export interface LoopOptions {
  intervalMs: number;
  pollEveryMs: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export interface DispatchLoop {
  start(): void;
  stop(): Promise<void>;
  /** One pass (exported for tests and a one-shot run). */
  tick(): Promise<void>;
}

export function createDispatchLoop(deps: WorkerDeps, opts: LoopOptions): DispatchLoop {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const now = opts.now ?? Date.now;
  let handle: unknown = null;
  let running: Promise<void> | null = null;
  let stopped = true;
  let lastPoll = 0;

  const tick = async () => {
    if (running) return running;
    running = (async () => {
      try {
        const r = await processDueJobs(deps);
        if (r.done || r.retried || r.failed) deps.log?.info({ ...r }, 'dispatch pass');
        if (now() - lastPoll >= opts.pollEveryMs) {
          lastPoll = now();
          const changed = await pollLiveShipments(deps);
          if (changed) deps.log?.info({ changed }, 'shipments updated from partners');
        }
      } catch (err) {
        deps.log?.error({ err: err instanceof Error ? err.message : String(err) }, 'dispatch pass failed');
      } finally {
        running = null;
      }
    })();
    return running;
  };

  const schedule = () => {
    if (stopped) return;
    handle = setTimer(() => {
      void tick().then(schedule);
    }, opts.intervalMs);
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (handle !== null) clearTimer(handle);
      handle = null;
      if (running) await running;
    },
    tick,
  };
}
