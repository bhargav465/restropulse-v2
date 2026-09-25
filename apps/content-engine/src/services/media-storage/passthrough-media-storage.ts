import type { IMediaStorage, PersistMediaContext } from './types.js';

/**
 * Used when no storage is configured (local dev, tests). Returns the source URL
 * unchanged, so provider URLs that expire (Replicate: 1 hour) are stored as-is.
 */
export class PassthroughMediaStorage implements IMediaStorage {
  readonly name = 'passthrough';
  readonly durable = false;

  async persist(sourceUrl: string, _context: PersistMediaContext): Promise<string> {
    return sourceUrl;
  }
}
