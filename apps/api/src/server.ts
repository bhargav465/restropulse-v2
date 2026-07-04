import './instrument.js';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'node:http';
import { fileURLToPath } from 'url';
import { loadAndValidateEnv, z } from '@restropulse/shared';
import { connectDB, disconnectDB } from '@restropulse/db';
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

// Middleware - Allow both ports 3000 and 3001 for development
app.use(cors({
    origin: [CORS_ORIGIN, 'http://localhost:3001'],
    credentials: true
}));
// Razorpay webhook needs raw body for signature verification
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
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

startServer();

export default app;
