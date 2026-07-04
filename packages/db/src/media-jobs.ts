/**
 * @restropulse/db - mediaJobs collection helpers.
 *
 * Each fal.ai (or other media-provider) call writes a MediaJobRecord. Phase 4
 * writes COMPLETED rows synchronously; phase 5 will write PENDING -> RUNNING
 * -> COMPLETED for slow video generation and add the media-job-poller cron.
 */

import { getMediaJobsCollection } from './connection.js';
import type { MediaJobRecord } from '@restropulse/shared';

export async function insertMediaJob(
  job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<MediaJobRecord> {
  const col = getMediaJobsCollection();
  const now = new Date();
  const doc = { ...job, createdAt: now, updatedAt: now };
  const result = await col.insertOne(doc as any);
  return { ...doc, id: result.insertedId.toString() } as MediaJobRecord;
}

export async function findMediaJobById(jobId: string): Promise<MediaJobRecord | null> {
  const col = getMediaJobsCollection();
  const doc = await col.findOne({ jobId });
  if (!doc) return null;
  const { _id, ...rest } = doc as any;
  return { ...rest, id: _id.toString() } as MediaJobRecord;
}

export type MediaJobUpdatable = Partial<
  Pick<
    MediaJobRecord,
    'status' | 'mediaUrl' | 'mediaUrls' | 'thumbnail' | 'metadata' | 'error' | 'lastPolledAt' | 'completedAt'
  >
>;

export async function updateMediaJobStatus(
  jobId: string,
  update: MediaJobUpdatable,
): Promise<MediaJobRecord | null> {
  const col = getMediaJobsCollection();
  const result = await col.findOneAndUpdate(
    { jobId },
    { $set: { ...update, updatedAt: new Date() } as any },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  const { _id, ...rest } = result as any;
  return { ...rest, id: _id.toString() } as MediaJobRecord;
}

export async function incrementMediaJobAttempts(jobId: string): Promise<void> {
  const col = getMediaJobsCollection();
  await col.updateOne({ jobId }, { $inc: { attempts: 1 }, $set: { updatedAt: new Date() } } as any);
}

export async function findStaleRunningJobs(olderThan: Date): Promise<MediaJobRecord[]> {
  // Phase 5 uses this to reset stale RUNNING jobs to PENDING. Phase 4 ships
  // the helper so phase 5 has a one-line change to add the cron.
  const col = getMediaJobsCollection();
  const docs = await col.find({ status: 'RUNNING', startedAt: { $lt: olderThan } } as any).toArray();
  return docs.map((d) => {
    const { _id, ...rest } = d as any;
    return { ...rest, id: _id.toString() } as MediaJobRecord;
  });
}
