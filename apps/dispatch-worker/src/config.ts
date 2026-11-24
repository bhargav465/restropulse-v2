/** Worker settings from the environment. */

export interface WorkerConfig {
  intervalMs: number;
  pollEveryMs: number;
}

function positive(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 500) throw new Error(`${name} must be a whole number of milliseconds, at least 500.`);
  return n;
}

export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  return {
    intervalMs: positive(env.DISPATCH_INTERVAL_MS, 5_000, 'DISPATCH_INTERVAL_MS'),
    pollEveryMs: positive(env.DISPATCH_POLL_MS, 30_000, 'DISPATCH_POLL_MS'),
  };
}
