export type AppName = 'api' | 'web' | 'publisher' | 'content-engine' | 'db-cli' | 'intelligence-worker';
export type SecretCategory = 'database' | 'auth' | 'meta' | 'ai' | 'azure' | 'payment' | 'config';

export interface SecretDefinition {
  key: string;
  kvName: string;
  description: string;
  apps: AppName[];
  required: boolean;
  category: SecretCategory;
  buildTime?: boolean;
}

export const SECRETS_MANIFEST: SecretDefinition[] = [
  // Database
  { key: 'MONGODB_URI', kvName: 'mongodb-uri', description: 'MongoDB Atlas connection string', apps: ['api', 'publisher', 'content-engine', 'db-cli', 'intelligence-worker'], required: true, category: 'database' },
  { key: 'MONGODB_DB_NAME', kvName: 'mongodb-db-name', description: 'MongoDB database name', apps: ['api', 'publisher', 'content-engine', 'db-cli', 'intelligence-worker'], required: false, category: 'database' },
  // Auth
  { key: 'JWT_SECRET', kvName: 'jwt-secret', description: 'JWT signing secret (>=64 char)', apps: ['api'], required: true, category: 'auth' },
  { key: 'ENCRYPTION_KEY', kvName: 'encryption-key', description: 'AES-256-CBC key for Instagram token encryption (64 hex chars)', apps: ['api', 'publisher'], required: true, category: 'auth' },
  { key: 'FIREBASE_SERVICE_ACCOUNT_KEY', kvName: 'firebase-service-account-key', description: 'Firebase Admin SDK service account JSON (single line)', apps: ['api'], required: false, category: 'auth' },
  { key: 'FIREBASE_PROJECT_ID', kvName: 'firebase-project-id', description: 'Firebase project ID', apps: ['api'], required: false, category: 'auth' },
  // Meta / Instagram
  { key: 'INSTAGRAM_APP_ID', kvName: 'instagram-app-id', description: 'Facebook App ID for Instagram OAuth', apps: ['api', 'publisher'], required: true, category: 'meta' },
  { key: 'INSTAGRAM_APP_SECRET', kvName: 'instagram-app-secret', description: 'Facebook App Secret', apps: ['api', 'publisher'], required: true, category: 'meta' },
  { key: 'INSTAGRAM_REDIRECT_URI', kvName: 'instagram-redirect-uri', description: 'OAuth callback URL', apps: ['api', 'publisher'], required: false, category: 'meta' },
  // AI backends
  { key: 'ANTHROPIC_API_KEY', kvName: 'anthropic-api-key', description: 'Anthropic Claude API key (content-engine captions + intelligence competitive analysis)', apps: ['content-engine', 'api'], required: false, category: 'ai' },
  { key: 'GOOGLE_MAPS_API_KEY', kvName: 'google-maps-api-key', description: 'Google Places API (New) key for Restaurant Intelligence scans (server-side)', apps: ['api'], required: false, category: 'ai' },
  { key: 'REPLICATE_API_TOKEN', kvName: 'replicate-api-token', description: 'Replicate API token', apps: ['content-engine'], required: false, category: 'ai' },
  { key: 'GOOGLE_CALENDAR_API_KEY', kvName: 'google-calendar-api-key', description: 'Google Calendar API key for India holidays', apps: ['content-engine'], required: false, category: 'ai' },
  { key: 'PERPLEXITY_API_KEY', kvName: 'perplexity-api-key', description: 'Perplexity Sonar Pro API key', apps: ['content-engine'], required: false, category: 'ai' },
  // Durable media storage (Azure Blob). One account per env class: prod vs non-prod (dev + staging).
  // The container is derived from MONGODB_DB_NAME, so storage is tied to the database.
  { key: 'MEDIA_STORAGE_CONNECTION_STRING', kvName: 'media-storage-connection-string', description: 'Azure Blob connection string for durable generated-media storage (prod account vs non-prod account per env)', apps: ['content-engine'], required: false, category: 'azure' },
  // Payments
  { key: 'RAZORPAY_KEY_ID', kvName: 'razorpay-key-id', description: 'Razorpay API key ID', apps: ['api', 'db-cli'], required: false, category: 'payment' },
  { key: 'RAZORPAY_KEY_SECRET', kvName: 'razorpay-key-secret', description: 'Razorpay API key secret', apps: ['api', 'db-cli'], required: false, category: 'payment' },
  { key: 'RAZORPAY_WEBHOOK_SECRET', kvName: 'razorpay-webhook-secret', description: 'Razorpay webhook HMAC signing secret', apps: ['api'], required: false, category: 'payment' },
  // Azure / Observability
  { key: 'APPLICATIONINSIGHTS_CONNECTION_STRING', kvName: 'applicationinsights-connection-string', description: 'Azure Monitor connection string', apps: ['api', 'publisher', 'content-engine', 'intelligence-worker'], required: false, category: 'azure' },
  { key: 'AZURE_KEY_VAULT_URL', kvName: '', description: 'Key Vault URL when SECRETS_BACKEND=azure-kv', apps: ['api', 'publisher', 'content-engine', 'intelligence-worker'], required: false, category: 'azure' },
  { key: 'AZURE_KEY_VAULT_KEY_PREFIX', kvName: '', description: 'Optional prefix for KV secret names', apps: ['api', 'publisher', 'content-engine', 'intelligence-worker'], required: false, category: 'azure' },
  // Web build-time (VITE_* -- cannot come from KV at runtime)
  { key: 'VITE_API_URL', kvName: '', description: 'Backend API base URL', apps: ['web'], required: true, category: 'config', buildTime: true }, // not in KV; supplied by CI vars
  { key: 'VITE_APP_URL', kvName: '', description: 'Frontend public URL', apps: ['web'], required: true, category: 'config', buildTime: true }, // not in KV; supplied by CI vars
  { key: 'VITE_FIREBASE_API_KEY', kvName: 'firebase-api-key', description: 'Firebase Web API key', apps: ['web'], required: true, category: 'auth', buildTime: true },
  { key: 'VITE_FIREBASE_AUTH_DOMAIN', kvName: 'firebase-auth-domain', description: 'Firebase auth domain', apps: ['web'], required: true, category: 'auth', buildTime: true },
  { key: 'VITE_FIREBASE_PROJECT_ID', kvName: 'firebase-project-id', description: 'Firebase project ID', apps: ['web'], required: true, category: 'auth', buildTime: true },
  { key: 'VITE_FIREBASE_STORAGE_BUCKET', kvName: 'firebase-storage-bucket', description: 'Firebase storage bucket', apps: ['web'], required: false, category: 'auth', buildTime: true },
  { key: 'VITE_FIREBASE_MESSAGING_SENDER_ID', kvName: 'firebase-messaging-sender-id', description: 'Firebase messaging sender ID', apps: ['web'], required: false, category: 'auth', buildTime: true },
  { key: 'VITE_FIREBASE_APP_ID', kvName: 'firebase-app-id', description: 'Firebase app ID', apps: ['web'], required: false, category: 'auth', buildTime: true },
  { key: 'VITE_RECAPTCHA_SITE_KEY', kvName: 'recaptcha-site-key', description: 'Google reCAPTCHA site key for Firebase Phone Auth', apps: ['web'], required: true, category: 'auth', buildTime: true },
  { key: 'VITE_APPINSIGHTS_CONNECTION_STRING', kvName: 'web-appinsights-connection-string', description: 'App Insights connection string for browser SDK', apps: ['web'], required: false, category: 'azure', buildTime: true },
  { key: 'VITE_GOOGLE_MAPS_API_KEY', kvName: 'web-google-maps-api-key', description: 'Google Maps Places API key', apps: ['web'], required: false, category: 'config', buildTime: true },
  { key: 'VITE_RAZORPAY_KEY_ID', kvName: 'razorpay-key-id', description: 'Razorpay public key for checkout SDK', apps: ['web'], required: false, category: 'payment', buildTime: true },
];

export function getAppSecretKeys(app: AppName): string[] {
  return SECRETS_MANIFEST.filter(s => s.apps.includes(app) && !s.buildTime).map(s => s.key);
}

export const API_SECRET_KEYS = getAppSecretKeys('api');
export const PUBLISHER_SECRET_KEYS = getAppSecretKeys('publisher');
export const CONTENT_ENGINE_SECRET_KEYS = getAppSecretKeys('content-engine');
export const INTELLIGENCE_WORKER_SECRET_KEYS = getAppSecretKeys('intelligence-worker');
export const DB_CLI_SECRET_KEYS = getAppSecretKeys('db-cli');
