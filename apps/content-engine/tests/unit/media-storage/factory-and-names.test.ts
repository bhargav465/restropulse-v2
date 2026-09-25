import { describe, it, expect, vi } from 'vitest';

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@restropulse/telemetry/server', () => ({ createLogger: () => logs }));

const { createMediaStorage, containerNameForDatabase, AzureBlobMediaStorage, PassthroughMediaStorage } = await import(
  '../../../src/services/media-storage/index.js'
);

const CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=restropulsemedianonprod;AccountKey=a2V5;EndpointSuffix=core.windows.net';

describe('containerNameForDatabase', () => {
  it.each([
    ['restropulse', 'restropulse'],
    ['restropulse-staging', 'restropulse-staging'],
    ['RestroPulse_Prod', 'restropulse-prod'],
    ['  weird__name!! ', 'weird-name'],
    ['ab', 'ab-media'],
    ['', 'restropulse'],
    ['---', 'restropulse'],
    ['x'.repeat(80), 'x'.repeat(63)],
  ])('maps %j to %j', (input, expected) => {
    expect(containerNameForDatabase(input)).toBe(expected);
  });

  it('never ends with a hyphen after truncation', () => {
    const name = containerNameForDatabase(`${'a'.repeat(62)}-b`);
    expect(name.endsWith('-')).toBe(false);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

describe('createMediaStorage', () => {
  it('falls back to passthrough and logs an error when no connection string is set', () => {
    logs.error.mockClear();
    const storage = createMediaStorage({});
    expect(storage).toBeInstanceOf(PassthroughMediaStorage);
    expect(storage.durable).toBe(false);
    expect(logs.error).toHaveBeenCalledWith(expect.stringContaining('EXPIRE'));
  });

  it('degrades to passthrough (never throws) when the connection string is malformed', () => {
    logs.error.mockClear();
    const storage = createMediaStorage({ MEDIA_STORAGE_CONNECTION_STRING: 'PLACEHOLDER - replace with actual value' });
    expect(storage).toBeInstanceOf(PassthroughMediaStorage);
    expect(logs.error).toHaveBeenCalledWith(expect.objectContaining({ container: 'restropulse' }), expect.stringContaining('invalid'));
  });

  it('treats a blank connection string as unset', () => {
    expect(createMediaStorage({ MEDIA_STORAGE_CONNECTION_STRING: '   ' })).toBeInstanceOf(PassthroughMediaStorage);
  });

  it('ties the container to the database name', () => {
    const storage = createMediaStorage({
      MEDIA_STORAGE_CONNECTION_STRING: CONNECTION_STRING,
      MONGODB_DB_NAME: 'restropulse-staging',
    });
    expect(storage).toBeInstanceOf(AzureBlobMediaStorage);
    expect((storage as any).container.containerName).toBe('restropulse-staging');
    expect((storage as any).container.url).toContain('restropulsemedianonprod.blob.core.windows.net');
  });

  it('defaults the database name to restropulse', () => {
    const storage = createMediaStorage({ MEDIA_STORAGE_CONNECTION_STRING: CONNECTION_STRING });
    expect((storage as any).container.containerName).toBe('restropulse');
  });

  it('lets MEDIA_STORAGE_CONTAINER override the derived name', () => {
    const storage = createMediaStorage({
      MEDIA_STORAGE_CONNECTION_STRING: CONNECTION_STRING,
      MONGODB_DB_NAME: 'restropulse-staging',
      MEDIA_STORAGE_CONTAINER: 'custom-media',
    });
    expect((storage as any).container.containerName).toBe('custom-media');
  });

  it('logs the account and container but never the connection string', () => {
    logs.info.mockClear();
    createMediaStorage({ MEDIA_STORAGE_CONNECTION_STRING: CONNECTION_STRING, MONGODB_DB_NAME: 'restropulse' });
    const logged = JSON.stringify(logs.info.mock.calls);
    expect(logged).toContain('restropulsemedianonprod');
    expect(logged).not.toContain('AccountKey');
    expect(logged).not.toContain('a2V5');
  });
});
