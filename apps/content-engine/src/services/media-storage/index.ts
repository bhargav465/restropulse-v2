import { createLogger } from '@restropulse/telemetry/server';
import { AzureBlobMediaStorage } from './azure-blob-media-storage.js';
import { containerNameForDatabase } from './container-name.js';
import { PassthroughMediaStorage } from './passthrough-media-storage.js';
import type { IMediaStorage } from './types.js';

export type { IMediaStorage, PersistMediaContext } from './types.js';
export { AzureBlobMediaStorage } from './azure-blob-media-storage.js';
export { PassthroughMediaStorage } from './passthrough-media-storage.js';
export { containerNameForDatabase } from './container-name.js';

const log = createLogger('media-storage');

function accountNameOf(connectionString: string): string {
  return connectionString.match(/AccountName=([^;]+)/i)?.[1] ?? 'unknown';
}

/**
 * Build the media storage from env. The connection string comes from Key Vault
 * (`{env}-media-storage-connection-string`) and selects the ACCOUNT (prod vs
 * non-prod); the CONTAINER is derived from MONGODB_DB_NAME so storage is tied to
 * the database (override with MEDIA_STORAGE_CONTAINER).
 *
 * Without a connection string this returns a passthrough, which stores
 * provider URLs that expire -- so it is logged loudly.
 */
export function createMediaStorage(env: NodeJS.ProcessEnv = process.env): IMediaStorage {
  const connectionString = env.MEDIA_STORAGE_CONNECTION_STRING?.trim();
  if (!connectionString) {
    log.error(
      'MEDIA_STORAGE_CONNECTION_STRING is not set: generated media URLs will be stored as-is and EXPIRE after ~1 hour (Replicate retention). ' +
        'Set it (Key Vault reference in App Service, or `npm run secrets:pull` locally) to enable durable media storage.',
    );
    return new PassthroughMediaStorage();
  }

  const dbName = env.MONGODB_DB_NAME?.trim() || 'restropulse';
  const containerName = env.MEDIA_STORAGE_CONTAINER?.trim() || containerNameForDatabase(dbName);
  try {
    const storage = new AzureBlobMediaStorage({ connectionString, containerName });
    log.info({ account: accountNameOf(connectionString), container: containerName, db: dbName }, 'Durable media storage enabled');
    return storage;
  } catch (err) {
    // Never throw at boot: startup.sh stops every process (API included) if one
    // exits, so a malformed secret must degrade to a loud error, not a crash loop.
    log.error(
      { err, container: containerName },
      'MEDIA_STORAGE_CONNECTION_STRING is invalid: generated media URLs will be stored as-is and EXPIRE after ~1 hour',
    );
    return new PassthroughMediaStorage();
  }
}
