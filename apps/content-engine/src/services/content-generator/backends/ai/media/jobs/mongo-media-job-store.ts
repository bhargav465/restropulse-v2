/**
 * MongoMediaJobStore -- writes/reads MediaJobRecord rows in the mediaJobs
 * collection via the @restropulse/db helpers.
 */

import {
  insertMediaJob,
  findMediaJobById,
  updateMediaJobStatus,
  incrementMediaJobAttempts,
  type MediaJobUpdatable,
} from '@restropulse/db';
import type { MediaJobRecord } from '@restropulse/shared';
import type { IMediaJobStore } from './types.js';

export class MongoMediaJobStore implements IMediaJobStore {
  async insert(job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaJobRecord> {
    return insertMediaJob(job);
  }

  async findById(jobId: string): Promise<MediaJobRecord | null> {
    return findMediaJobById(jobId);
  }

  async updateStatus(jobId: string, update: MediaJobUpdatable): Promise<MediaJobRecord | null> {
    return updateMediaJobStatus(jobId, update);
  }

  async incrementAttempts(jobId: string): Promise<void> {
    return incrementMediaJobAttempts(jobId);
  }
}
