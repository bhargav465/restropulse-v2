/**
 * IMediaJobStore -- thin abstraction over the mediaJobs persistence backend.
 * Phase 4 ships MongoMediaJobStore. Future backends (Redis for ephemeral,
 * Postgres for analytics) plug in here without changing ReplicateMediaGenerator.
 */

import type { MediaJobRecord } from '@restropulse/shared';
import type { MediaJobUpdatable } from '@restropulse/db';

export interface IMediaJobStore {
  insert(job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaJobRecord>;
  findById(jobId: string): Promise<MediaJobRecord | null>;
  updateStatus(jobId: string, update: MediaJobUpdatable): Promise<MediaJobRecord | null>;
  incrementAttempts(jobId: string): Promise<void>;
}

export type { MediaJobUpdatable };
