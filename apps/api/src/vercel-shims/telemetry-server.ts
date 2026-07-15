/**
 * Lightweight console-backed replacement for '@restropulse/telemetry/server',
 * swapped in by scripts/build-vercel-api.mjs (esbuild alias) for the Vercel
 * serverless bundle. Skips pino + Azure Monitor OpenTelemetry entirely —
 * Vercel captures stdout/stderr as function logs.
 */
import type { Request, Response, NextFunction } from 'express';

type Fields = Record<string, unknown>;

function emit(level: string, name: string, a?: unknown, b?: unknown): void {
    const msg = typeof a === 'string' ? a : typeof b === 'string' ? b : '';
    const fields = typeof a === 'object' && a !== null ? a : undefined;
    const line = `[${level}] [${name}] ${msg}`;
    const payload = fields ? [line, JSON.stringify(fields, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)).slice(0, 4000)] : [line];
    if (level === 'error') console.error(...payload);
    else if (level === 'warn') console.warn(...payload);
    else console.log(...payload);
}

export function createLogger(name: string) {
    return {
        debug: (a?: unknown, b?: unknown) => emit('debug', name, a, b),
        info: (a?: unknown, b?: unknown) => emit('info', name, a, b),
        warn: (a?: unknown, b?: unknown) => emit('warn', name, a, b),
        error: (a?: unknown, b?: unknown) => emit('error', name, a, b),
        child: (_bindings?: Fields) => createLogger(name),
    };
}

export function initServerTelemetry(_config?: unknown): void { /* no-op on Vercel */ }
export function initLogger(_config?: unknown): void { /* no-op on Vercel */ }
export async function shutdownServerTelemetry(): Promise<void> { /* no-op */ }

export function trackEvent(name: string, properties?: Fields): void {
    emit('info', 'event', { event: name, ...properties }, name);
}

export function requestLoggingMiddleware() {
    return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function errorHandlerMiddleware() {
    // Same contract as the real one: last-resort JSON 500.
    return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        emit('error', 'server', { err }, 'Unhandled error');
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    };
}

/** Wrap a cron job body with logging (used by db/publishing packages). */
export function tracedCronJob<T extends (...args: unknown[]) => unknown>(name: string, fn: T): T {
    return (async (...args: unknown[]) => {
        try {
            return await fn(...args);
        } catch (err) {
            emit('error', 'cron', { err }, `cron ${name} failed`);
            throw err;
        }
    }) as unknown as T;
}
