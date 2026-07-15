import './instrument.js';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'node:http';
import { fileURLToPath } from 'url';
import { loadAndValidateEnv, z } from '@restropulse/shared';
import { connectDB, disconnectDB, ensureOrderingIndexes, ensureIntelligenceIndexes, ensureAssetIndexes } from '@restropulse/db';
import { createLogger, requestLoggingMiddleware, errorHandlerMiddleware, shutdownServerTelemetry } from '@restropulse/telemetry/server';
import { createSecretsProvider, hydrateEnvFromProvider, API_SECRET_KEYS } from '@restropulse/secrets';
import { initializeFirebaseAdmin } from './services/firebase-admin.js';
// NOTE: Cron jobs (publishing + token refresh) are now handled by apps/publisher
import authRoutes from './routes/auth.js';
import restaurantRoutes from './routes/restaurant.js';
import postsRoutes from './routes/posts.js';
import strategyRoutes from './routes/strategy.js';
import integrationsRoutes from './routes/integrations.js';
import subscriptionRoutes from './routes/subscriptions.js';
import couponRoutes from './routes/coupons.js';
import creditPackRoutes from './routes/credit-packs.js';
import invoiceRoutes from './routes/invoices.js';
import configRoutes from './routes/config.js';
import accountRoutes from './routes/account.js';
import storefrontRoutes from './routes/storefront.js';
import adminOrderingRoutes from './routes/admin-ordering.js';
import adminIntelligenceRoutes from './routes/admin/intelligence.js';
import paymentsWebhookRoutes from './routes/payments-webhook.js';
import assetsRoutes from './routes/assets.js';
import superRoutes from './routes/super.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PortConfig = {
    web: number;
    api: number;
    publisher: number;
    strictInDevelopment?: boolean;
};

function getPortConfig(): PortConfig {
    const fallback: PortConfig = {
        web: 3000,
        api: 3001,
        publisher: 3002,
        strictInDevelopment: true,
    };

    try {
        const configPath = path.resolve(__dirname, '../../../config/ports.json');
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PortConfig>;

        return {
            web: typeof parsed.web === 'number' ? parsed.web : fallback.web,
            api: typeof parsed.api === 'number' ? parsed.api : fallback.api,
            publisher: typeof parsed.publisher === 'number' ? parsed.publisher : fallback.publisher,
            strictInDevelopment: typeof parsed.strictInDevelopment === 'boolean'
                ? parsed.strictInDevelopment
                : fallback.strictInDevelopment,
        };
    } catch {
        return fallback;
    }
}

const portConfig = getPortConfig();

const booleanFlag = z.preprocess((v) => v === 'true', z.boolean()).default(false);

if (process.env.SECRETS_BACKEND) {
    await hydrateEnvFromProvider(
        createSecretsProvider(process.env.SECRETS_BACKEND),
        API_SECRET_KEYS,
    );
}

// Vercel serverless: sensible defaults so a fresh deploy only needs
// MONGODB_URI + JWT_SECRET (+ Razorpay keys) as project env vars.
if (process.env.VERCEL) {
    const selfUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (selfUrl) {
        process.env.BACKEND_URL ||= `https://${selfUrl}`;
        process.env.FRONTEND_URL ||= `https://${selfUrl}`;
    }
    process.env.NODE_ENV ||= 'production';
}

const env = loadAndValidateEnv({
    serviceName: 'api',
    envPath: path.resolve(process.cwd(), '.env'),
    schema: z.object({
        NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(portConfig.api),
        CORS_ORIGIN: z.string().min(1).default(`http://localhost:${portConfig.web}`),
        MONGODB_URI: z.string().min(1),
        MONGODB_DB_NAME: z.string().min(1).default('restropulse'),
        FRONTEND_URL: z.string().url(),
        BACKEND_URL: z.string().url(),
        JWT_SECRET: z.string().min(1).default('restropulse-dev-secret-change-in-production'),
        ENCRYPTION_KEY: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
        FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),
        FIREBASE_PROJECT_ID: z.string().optional(),
        INSTAGRAM_APP_ID: z.string().optional(),
        INSTAGRAM_APP_SECRET: z.string().optional(),
        INSTAGRAM_REDIRECT_URI: z.string().optional(),
        APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
        SECRETS_BACKEND: z.enum(['env', 'azure-kv']).default('env'),
        AZURE_KEY_VAULT_URL: z.string().url().optional(),
        AZURE_KEY_VAULT_KEY_PREFIX: z.string().optional(),
        RAZORPAY_KEY_ID: z.string().min(1).optional(),
        RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
        RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
        FEATURE_DELETE_ACCOUNT: booleanFlag,
        ENABLED_PLATFORMS: z.string().default('INSTAGRAM,FACEBOOK'),
        // Adhoc post scheduling: minimum minutes ahead a post must be scheduled.
        // ASAP defaults to exactly this value. Must be > POST_APPROVAL_BUFFER (120 min)
        // to leave a review window. Default = 150 min (2h approval buffer + 30min review).
        MIN_SCHEDULE_AHEAD_MINS: z.coerce.number().positive().default(150),
    }).passthrough(),
});

if (env.NODE_ENV === 'development' && portConfig.strictInDevelopment && env.PORT !== portConfig.api) {
    throw new Error(`Invalid PORT for development. Expected ${portConfig.api}, received ${env.PORT}. Update config/ports.json or .env.`);
}

const log = createLogger('server');
const app: Express = express();
const PORT = env.PORT;
const CORS_ORIGIN = env.CORS_ORIGIN;

// Initialize Firebase Admin SDK (optional - for production auth)
initializeFirebaseAdmin();

// Serve static content from public directory
app.use('/content', express.static(path.join(__dirname, '../public')));

// Middleware - CORS_ORIGIN supports a comma-separated list of origins.
// On Vercel with no explicit CORS_ORIGIN, reflect the request origin (auth is
// via Bearer tokens, not cookies, so this is safe and keeps setup simple).
const corsOrigins = CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
    origin: process.env.VERCEL && !process.env.CORS_ORIGIN
        ? true
        : [...corsOrigins, 'http://localhost:3001'],
    credentials: true
}));
// Razorpay webhook needs raw body for signature verification
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use(requestLoggingMiddleware());

// Health check
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/strategy', strategyRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/credit-packs', creditPackRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/config', configRoutes);
app.use('/api/account', accountRoutes);
// Online ordering (v1): public storefront + merchant admin
app.use('/api/storefront/:slug', storefrontRoutes);
app.use('/api/admin/ordering', adminOrderingRoutes);
// Restaurant Intelligence (v1): merchant scan pipeline + reports (OWNER only).
app.use('/api/admin/intelligence', adminIntelligenceRoutes);
// Ordering payments webhook (Razorpay) — raw-body mount is above, next to subscriptions.
app.use('/api/payments', paymentsWebhookRoutes);
// Restaurant assets (logos/covers) — public read, served from GridFS. JSON-side
// mount (NOT near the raw-body webhook mounts above).
app.use('/api/assets', assetsRoutes);
// Super admin (platform owner): all restaurants, platform flags, landing content.
app.use('/api/super', superRoutes);

// Dev-only: proxy /dev-assets/* to the content-engine asset server (port 3002).
// Allows the single ngrok tunnel to serve both API routes and placeholder media
// URLs that Facebook CDN can reach during local publishing tests.
if (env.NODE_ENV === 'development') {
    const assetPort = parseInt(process.env.ASSET_SERVER_PORT ?? '3002', 10);
    app.use('/dev-assets', (req: Request, res: Response) => {
        const proxy = http.request(
            { hostname: 'localhost', port: assetPort, path: req.url, method: req.method, headers: req.headers },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            },
        );
        proxy.on('error', () => res.status(502).json({ error: 'Asset server unavailable' }));
        req.pipe(proxy, { end: true });
    });
}

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Error handler
app.use(errorHandlerMiddleware());

// Start server
const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        // Ensure ordering + intelligence indexes exist on real envs. Both are
        // idempotent and safe to call every boot; db-cli seed commands keep
        // their own calls for provisioning-only workflows. The menu_items
        // unique-upgrade path inside ensureOrderingIndexes never crashes on
        // legacy duplicate data (it falls back + warns).
        await ensureOrderingIndexes();
        await ensureIntelligenceIndexes();
        await ensureAssetIndexes();

        // Wrap listen() in a Promise so EADDRINUSE and other server errors are
        // caught by the try/catch below instead of escaping to uncaughtException.
        await new Promise<void>((resolve, reject) => {
            const server = app.listen(PORT, () => {
                log.info({
                    port: PORT,
                    corsOrigin: CORS_ORIGIN,
                    nodeEnv: process.env.NODE_ENV || 'development',
                }, `Server running at http://localhost:${PORT}`);
                resolve();
            });
            server.on('error', reject);
        });
    } catch (error) {
        log.error({ err: error }, 'Failed to start server');
        process.exit(1);
    }
};

// Process-level error safety net
// unhandledRejection: log and continue — rejection is isolated to one async chain,
// does not indicate heap corruption.
process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'Unhandled promise rejection');
});

// uncaughtException: log and exit — synchronous throw outside try/catch means the
// heap state is unknown; safest to restart cleanly.
process.on('uncaughtException', (error) => {
    log.error({ err: error }, 'Uncaught exception — shutting down');
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    log.info('Shutting down gracefully (SIGINT)');
    await shutdownServerTelemetry();
    await disconnectDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log.info('Shutting down gracefully (SIGTERM)');
    await shutdownServerTelemetry();
    await disconnectDB();
    process.exit(0);
});

// Serverless (Vercel): do NOT listen. The handler in vercel.ts awaits
// ensureServerReady() per invocation (memoized) before delegating to app.
let readyPromise: Promise<void> | null = null;
export function ensureServerReady(): Promise<void> {
    if (!readyPromise) {
        readyPromise = (async () => {
            await connectDB();
            await ensureOrderingIndexes();
            await ensureIntelligenceIndexes();
            await ensureAssetIndexes();
        })().catch((err) => {
            readyPromise = null; // allow retry on next invocation
            throw err;
        });
    }
    return readyPromise;
}

if (!process.env.VERCEL) {
    startServer();
}

export default app;
