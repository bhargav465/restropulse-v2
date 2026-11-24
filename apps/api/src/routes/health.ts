/**
 * Readiness probe: `/health/ready`.
 *
 * `/health` (in server.ts) is a liveness check: it answers as long as the
 * Node process is up, so it stays green while MongoDB is unreachable and
 * every real request fails. `/health/ready` actually pings the database and
 * returns 503 when it can't, so smoke tests, App Insights availability tests
 * and on-call see a real outage.
 *
 * Deliberately unauthenticated and outside `/api` (no rate limit). It reveals
 * only check names and ok/fail, never connection strings or error text.
 */

import type { Request, Response } from 'express';
import { getDB } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('health');

export const READINESS_TIMEOUT_MS = 2000;

export type CheckResult = 'ok' | 'fail';
export type ReadinessCheck = () => Promise<void>;

export async function pingMongo(): Promise<void> {
    await getDB().command({ ping: 1 });
}

function withTimeout(check: ReadinessCheck, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        check().then(
            () => { clearTimeout(timer); resolve(); },
            (err) => { clearTimeout(timer); reject(err); },
        );
    });
}

export function createReadinessHandler(
    checks: Record<string, ReadinessCheck> = { mongo: pingMongo },
    timeoutMs: number = READINESS_TIMEOUT_MS,
) {
    return async (_req: Request, res: Response): Promise<void> => {
        const started = Date.now();
        const entries = await Promise.all(
            Object.entries(checks).map(async ([name, check]): Promise<[string, CheckResult]> => {
                try {
                    await withTimeout(check, timeoutMs);
                    return [name, 'ok'];
                } catch (err) {
                    log.error({ check: name, error: String(err) }, 'Readiness check failed');
                    return [name, 'fail'];
                }
            }),
        );
        const results = Object.fromEntries(entries);
        const ready = entries.every(([, r]) => r === 'ok');

        res.setHeader('Cache-Control', 'no-store');
        res.status(ready ? 200 : 503).json({
            status: ready ? 'ok' : 'unavailable',
            checks: results,
            durationMs: Date.now() - started,
            timestamp: new Date().toISOString(),
        });
    };
}
