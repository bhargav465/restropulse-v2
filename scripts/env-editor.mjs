import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENV_PATHS = {
  api: path.resolve(ROOT, 'apps/api/.env'),
  web: path.resolve(ROOT, 'apps/web/.env'),
  publisher: path.resolve(ROOT, 'apps/publisher/.env'),
  'content-engine': path.resolve(ROOT, 'apps/content-engine/.env'),
};

const MPROCS_PANES = {
  api: 'api',
  web: 'web',
  publisher: 'publisher',
  'content-engine': 'content-engine',
};

const ENV_METADATA = {
  api: [
    {
      key: 'PORT',
      description: 'API server port',
      required: false,
      default: '3001',
      possible: ['any port number'],
    },
    {
      key: 'NODE_ENV',
      description: 'Environment mode',
      required: false,
      default: 'development',
      possible: ['development', 'staging', 'production'],
    },
    {
      key: 'CORS_ORIGIN',
      description: 'Allowed CORS origin',
      required: false,
      default: 'http://localhost:3000',
      format: 'full URL',
    },
    {
      key: 'MONGODB_URI',
      description: 'MongoDB Atlas connection string',
      required: true,
      format: 'mongodb+srv://user:pass@cluster.mongodb.net/',
    },
    {
      key: 'MONGODB_DB_NAME',
      description: 'Database name',
      required: false,
      default: 'restropulse',
    },
    {
      key: 'JWT_SECRET',
      description: 'JWT signing secret — must be changed in production',
      required: true,
      default: 'restropulse-dev-secret-change-in-production',
      generate: "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    },
    {
      key: 'ENCRYPTION_KEY',
      description: '32-byte hex key for AES-256-CBC token encryption',
      required: true,
      format: '64 hex chars (32 bytes)',
      generate: "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    },
    {
      key: 'INSTAGRAM_APP_ID',
      description: 'Facebook/Meta App ID',
      required: true,
      format: 'numeric App ID from Meta Developer Portal',
    },
    {
      key: 'INSTAGRAM_APP_SECRET',
      description: 'Facebook/Meta App Secret',
      required: true,
      format: '32-char hex from Meta Developer Portal',
    },
    {
      key: 'INSTAGRAM_REDIRECT_URI',
      description: 'OAuth redirect URI registered in Meta app settings',
      required: false,
      default: 'http://localhost:3001/api/integrations/instagram/callback',
      format: 'full URL',
    },
    {
      key: 'INSTAGRAM_REDIRECT_FRONTEND_URL',
      description: 'Frontend URL for post-OAuth redirect',
      required: false,
      default: 'http://localhost:3000',
      format: 'full URL',
    },
    {
      key: 'BACKEND_URL',
      description: 'Backend URL used in GDPR status links',
      required: false,
      default: 'http://localhost:3001',
      format: 'full URL',
    },
    {
      key: 'FIREBASE_SERVICE_ACCOUNT',
      description: 'Firebase service account credentials as inline JSON (conditional — use this OR FIREBASE_SERVICE_ACCOUNT_PATH)',
      required: false,
      format: 'inline JSON string from Firebase Console → Project Settings → Service Accounts',
    },
    {
      key: 'FIREBASE_SERVICE_ACCOUNT_PATH',
      description: 'Path to Firebase service account JSON file (conditional — use this OR FIREBASE_SERVICE_ACCOUNT)',
      required: false,
      format: 'path to firebase service account JSON file',
    },
    {
      key: 'FIREBASE_PROJECT_ID',
      description: 'Firebase project ID for limited Admin SDK usage',
      required: false,
      format: 'e.g. restropulse-prod',
    },
    {
      key: 'RAZORPAY_KEY_ID',
      description: 'Razorpay API key ID',
      required: false,
      format: 'rzp_test_... (test) or rzp_live_... (production)',
    },
    {
      key: 'RAZORPAY_KEY_SECRET',
      description: 'Razorpay API key secret',
      required: false,
      format: 'from Razorpay Dashboard → Settings → API Keys',
    },
    {
      key: 'RAZORPAY_WEBHOOK_SECRET',
      description: 'Razorpay webhook signature secret',
      required: false,
      format: 'from Razorpay Dashboard → Settings → Webhooks',
    },
    {
      key: 'FEATURE_DELETE_ACCOUNT',
      description: 'Feature flag: enable account deletion UI',
      required: false,
      default: 'false',
      possible: ['true', 'false'],
    },
    {
      key: 'FEATURE_TOPUP_CREDITS',
      description: 'Feature flag: enable credit pack topup purchase UI',
      required: false,
      default: 'false',
      possible: ['true', 'false'],
    },
    {
      key: 'FEATURE_UPDATES_SECTION',
      description: 'Feature flag: enable Updates (Inputs) section in nav',
      required: false,
      default: 'false',
      possible: ['true', 'false'],
    },
    {
      key: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
      description: 'Azure Monitor connection string — telemetry disabled if absent',
      required: false,
      format: 'InstrumentationKey=...;IngestionEndpoint=...',
    },
    {
      key: 'LOG_LEVEL',
      description: 'Pino log level',
      required: false,
      default: 'info',
      possible: ['debug', 'info', 'warn', 'error'],
    },
  ],
  web: [
    {
      key: 'VITE_API_URL',
      description: 'Backend API base URL — required in all environments',
      required: true,
      default: 'http://localhost:3001/api',
      format: 'backend API base URL (no trailing slash)',
    },
    {
      key: 'VITE_APP_URL',
      description: 'Frontend public URL — baked into Firebase email verification continueUrl at build time',
      required: true,
      default: 'http://localhost:3000',
      format: 'full URL',
    },
    {
      key: 'VITE_FIREBASE_API_KEY',
      description: 'Firebase Web API key',
      required: true,
      format: 'from Firebase Console → Project Settings → Web App',
    },
    {
      key: 'VITE_FIREBASE_AUTH_DOMAIN',
      description: 'Firebase auth domain',
      required: true,
      format: '<project-id>.firebaseapp.com',
    },
    {
      key: 'VITE_FIREBASE_PROJECT_ID',
      description: 'Firebase project ID',
      required: true,
      format: 'e.g. restropulse-prod',
    },
    {
      key: 'VITE_FIREBASE_STORAGE_BUCKET',
      description: 'Firebase storage bucket',
      required: true,
      format: '<project-id>.appspot.com',
    },
    {
      key: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
      description: 'Firebase messaging sender ID',
      required: true,
      format: 'numeric ID from Firebase Console',
    },
    {
      key: 'VITE_FIREBASE_APP_ID',
      description: 'Firebase app ID',
      required: true,
      format: '1:...:web:... from Firebase Console',
    },
    {
      key: 'VITE_GOOGLE_MAPS_API_KEY',
      description: 'Google Maps Places API key — when absent, onboarding falls back to manual address entry',
      required: false,
      format: 'from Google Cloud Console → APIs & Services → Credentials',
    },
    {
      key: 'VITE_RAZORPAY_KEY_ID',
      description: 'Razorpay key for checkout — fetched from API at runtime if not set',
      required: false,
      format: 'rzp_test_... or rzp_live_...',
    },
    {
      key: 'VITE_APPINSIGHTS_CONNECTION_STRING',
      description: 'App Insights browser SDK connection string',
      required: false,
      format: 'InstrumentationKey=...;IngestionEndpoint=...',
    },
    {
      key: 'VITE_TELEMETRY_SAMPLE_RATE',
      description: 'Trace sampling percentage',
      required: false,
      default: '100',
      possible: ['100', '50', '10', '1'],
    },
  ],
  publisher: [
    {
      key: 'NODE_ENV',
      description: 'Environment mode',
      required: false,
      default: 'development',
      possible: ['development', 'staging', 'production'],
    },
    {
      key: 'MONGODB_URI',
      description: 'MongoDB Atlas connection string — must match api',
      required: true,
      format: 'mongodb+srv://user:pass@cluster.mongodb.net/',
    },
    {
      key: 'MONGODB_DB_NAME',
      description: 'Database name',
      required: false,
      default: 'restropulse',
    },
    {
      key: 'ENCRYPTION_KEY',
      description: 'AES-256-CBC encryption key — must match api exactly',
      required: true,
      format: '64 hex chars (32 bytes)',
      generate: "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    },
    {
      key: 'INSTAGRAM_APP_ID',
      description: 'Facebook/Meta App ID — must match api',
      required: true,
      format: 'numeric App ID from Meta Developer Portal',
    },
    {
      key: 'INSTAGRAM_APP_SECRET',
      description: 'Facebook/Meta App Secret — must match api',
      required: true,
      format: '32-char hex from Meta Developer Portal',
    },
    {
      key: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
      description: 'Azure Monitor connection string — telemetry disabled if absent',
      required: false,
      format: 'InstrumentationKey=...;IngestionEndpoint=...',
    },
    {
      key: 'LOG_LEVEL',
      description: 'Pino log level',
      required: false,
      default: 'info',
      possible: ['debug', 'info', 'warn', 'error'],
    },
  ],
  'content-engine': [
    {
      key: 'NODE_ENV',
      description: 'Environment mode',
      required: false,
      default: 'development',
      possible: ['development', 'staging', 'production'],
    },
    {
      key: 'MONGODB_URI',
      description: 'MongoDB Atlas connection string — must match api',
      required: true,
      format: 'mongodb+srv://user:pass@cluster.mongodb.net/',
    },
    {
      key: 'MONGODB_DB_NAME',
      description: 'Database name',
      required: false,
      default: 'restropulse',
    },
    {
      key: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
      description: 'Azure Monitor connection string — telemetry disabled if absent',
      required: false,
      format: 'InstrumentationKey=...;IngestionEndpoint=...',
    },
    {
      key: 'LOG_LEVEL',
      description: 'Pino log level',
      required: false,
      default: 'info',
      possible: ['debug', 'info', 'warn', 'error'],
    },
  ],
};

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function writeEnvVar(filePath, key, value) {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }
  const lines = content.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return line;
    const lineKey = trimmed.slice(0, eqIndex).trim();
    if (lineKey === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (content.length > 0 && !content.endsWith('\n')) {
      updated.push('');
    }
    updated.push(`${key}=${value}`);
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, updated.join('\n'), 'utf8');
}

function clearEnvVar(filePath, key) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const updated = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return true;
    const lineKey = trimmed.slice(0, eqIndex).trim();
    return lineKey !== key;
  });
  fs.writeFileSync(filePath, updated.join('\n'), 'utf8');
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function buildVarLabel(meta, currentValues) {
  const val = currentValues[meta.key];
  let suffix;
  if (val !== undefined) {
    suffix = truncate(val, 50);
  } else if (meta.required) {
    suffix = '[MISSING]';
  } else {
    suffix = '[not set]';
  }
  return `${meta.key}  ${suffix}`;
}

function buildNoteLines(meta, currentValues) {
  const lines = [];
  lines.push(`Key:         ${meta.key}`);
  if (meta.description) {
    lines.push(`Description: ${meta.description}`);
  }
  lines.push(`Required:    ${meta.required ? 'Yes' : 'No'}`);
  if (meta.default !== undefined) {
    lines.push(`Default:     ${meta.default}`);
  }
  if (meta.format) {
    lines.push(`Format:      ${meta.format}`);
  }
  if (meta.possible && meta.possible.length > 0) {
    lines.push(`Allowed:     ${meta.possible.join(' | ')}`);
  }
  if (meta.generate) {
    lines.push(`Generate:    ${meta.generate}`);
  }
  const val = currentValues[meta.key];
  lines.push(`Current:     ${val !== undefined ? val : '(not set)'}`);
  return lines.join('\n');
}

async function varDetailScreen(appName, meta, envPath) {
  while (true) {
    const currentValues = readEnvFile(envPath);
    p.note(buildNoteLines(meta, currentValues), `${appName} / ${meta.key}`);
    const action = await p.select({
      message: 'Action',
      options: [
        { value: 'edit', label: 'Edit value' },
        { value: 'clear', label: 'Clear (remove line)' },
        { value: 'back', label: 'Back to var list' },
      ],
    });
    if (p.isCancel(action)) {
      p.outro('Bye.');
      process.exit(0);
    }
    if (action === 'back') return;
    if (action === 'edit') {
      const newVal = await p.text({
        message: `New value for ${meta.key}`,
        placeholder: meta.default ?? '',
        initialValue: currentValues[meta.key] ?? '',
      });
      if (p.isCancel(newVal)) {
        p.outro('Bye.');
        process.exit(0);
      }
      writeEnvVar(envPath, meta.key, newVal);
      p.log.success(`Updated ${envPath}`);
      p.log.warn(`Restart the "${MPROCS_PANES[appName]}" pane in mprocs (select pane, press r)`);
    } else if (action === 'clear') {
      clearEnvVar(envPath, meta.key);
      p.log.success(`Cleared ${meta.key} from ${envPath}`);
      p.log.warn(`Restart the "${MPROCS_PANES[appName]}" pane in mprocs (select pane, press r)`);
    }
  }
}

async function varListScreen(appName) {
  const envPath = ENV_PATHS[appName];
  const metaList = ENV_METADATA[appName];
  while (true) {
    const currentValues = readEnvFile(envPath);
    const options = metaList.map((meta) => ({
      value: meta.key,
      label: buildVarLabel(meta, currentValues),
    }));
    options.push({ value: '__back__', label: 'Back to main menu' });
    const selected = await p.select({
      message: `${appName} — select a variable`,
      options,
    });
    if (p.isCancel(selected)) {
      p.outro('Bye.');
      process.exit(0);
    }
    if (selected === '__back__') return;
    const meta = metaList.find((m) => m.key === selected);
    await varDetailScreen(appName, meta, envPath);
  }
}

async function viewAllScreen() {
  const lines = [];
  for (const [appName, envPath] of Object.entries(ENV_PATHS)) {
    lines.push(`=== ${appName} (${envPath}) ===`);
    const currentValues = readEnvFile(envPath);
    const metaList = ENV_METADATA[appName];
    for (const meta of metaList) {
      const val = currentValues[meta.key];
      let display;
      if (val !== undefined) {
        display = truncate(val, 60);
      } else if (meta.required) {
        display = '[MISSING]';
      } else {
        display = '[not set]';
      }
      lines.push(`  ${meta.key}=${display}`);
    }
    lines.push('');
  }
  p.note(lines.join('\n'), 'All environment variables (read-only)');
}

async function main() {
  p.intro('RestroPulse env editor');
  while (true) {
    const app = await p.select({
      message: 'Select app to manage',
      options: [
        { value: 'api', label: 'api' },
        { value: 'web', label: 'web' },
        { value: 'publisher', label: 'publisher' },
        { value: 'content-engine', label: 'content-engine' },
        { value: '__view_all__', label: 'View all (read-only)' },
        { value: '__exit__', label: 'Exit' },
      ],
    });
    if (p.isCancel(app)) {
      p.outro('Bye.');
      process.exit(0);
    }
    if (app === '__exit__') {
      p.outro('Bye.');
      process.exit(0);
    }
    if (app === '__view_all__') {
      await viewAllScreen();
      continue;
    }
    await varListScreen(app);
  }
}

main().catch((err) => {
  p.log.error(String(err));
  process.exit(1);
});
