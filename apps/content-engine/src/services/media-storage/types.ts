/**
 * IMediaStorage -- durable home for generated media.
 *
 * Replicate deletes API prediction output files after one hour, so the URL it
 * returns cannot be stored on a post. persist() copies the file into storage we
 * control and returns the durable public URL that is safe to store and to hand
 * to Instagram/Facebook at publish time.
 */

export interface PersistMediaContext {
  restaurantId?: string;
  postId?: string;
  /** Media job id; used in the blob path when no postId is known yet. */
  jobId?: string;
}

export interface IMediaStorage {
  readonly name: string;
  /** false when persist() is a passthrough and URLs are NOT durable. */
  readonly durable: boolean;
  /** Copy `sourceUrl` into durable storage and return the durable public URL. Rejects on failure. */
  persist(sourceUrl: string, context: PersistMediaContext): Promise<string>;
}
