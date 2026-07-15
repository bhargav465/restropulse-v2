/**
 * Vercel serverless entry point.
 *
 * Bundled by scripts/build-vercel-api.mjs (esbuild) into a single function.
 * server.ts skips app.listen() when process.env.VERCEL is set; instead every
 * invocation awaits the memoized ensureServerReady() (Mongo connect + index
 * bootstrap) and then delegates to the Express app.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import app, { ensureServerReady } from './server.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await ensureServerReady();
    (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
