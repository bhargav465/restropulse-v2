/**
 * @restropulse/db - Posts collection helpers
 */

import { getPostsCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';
import type { GenerationStep, MediaJobRecord, Post, PostStatus } from '@restropulse/shared';

export async function findAllPosts(restaurantId?: string): Promise<Post[]> {
  const col = getPostsCollection();
  const query = restaurantId ? { restaurantId } : {};
  const docs = await col.find(query).sort({ createdAt: -1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

export async function findPostById(id: string): Promise<Post | null> {
  const col = getPostsCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as Post | null;
}

export async function createPost(post: Omit<Post, 'id'>): Promise<Post> {
  const col = getPostsCollection();
  const postWithTimestamps = {
    ...post,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await col.insertOne(postWithTimestamps);
  return { ...post, id: result.insertedId.toString() } as Post;
}

export async function updatePost(id: string, updates: Partial<Post>): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

export async function deletePost(id: string): Promise<boolean> {
  const col = getPostsCollection();
  const result = await col.deleteOne({ _id: toObjectId(id) as any });
  return result.deletedCount === 1;
}

export async function findPostsByStatus(status: string, restaurantId?: string): Promise<Post[]> {
  const col = getPostsCollection();
  const query: any = { status };
  if (restaurantId) query.restaurantId = restaurantId;
  const docs = await col.find(query).sort({ scheduledFor: 1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

/**
 * Find posts whose status is PENDING_MEDIA and whose lastStepAt is older than
 * the cutoff (or unset). Used by the media-job-poller and the worker boot
 * resume scan to surface jobs that need attention.
 */
export async function findStalePendingMediaPosts(olderThan: Date): Promise<Post[]> {
  const col = getPostsCollection();
  // Match either no lastStepAt (legacy) OR lastStepAt before the cutoff.
  const docs = await col.find({
    status: 'PENDING_MEDIA',
    $or: [
      { lastStepAt: { $exists: false } },
      { lastStepAt: { $lt: olderThan.toISOString() } },
    ],
  } as any).sort({ updatedAt: 1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

/**
 * Find every post still in PENDING_MEDIA. Used by the poller every tick.
 */
export async function findAllPendingMediaPosts(): Promise<Post[]> {
  const col = getPostsCollection();
  const docs = await col.find({ status: 'PENDING_MEDIA' } as any).sort({ updatedAt: 1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

/**
 * Atomically attach a mediaJobId + step to the post and flip its status to
 * PENDING_MEDIA. The status guard prevents accidental overwrites if the post
 * has already moved on (e.g. concurrent revision).
 */
export async function setPostMediaJobReference(
  postId: string,
  mediaJobId: string,
  step: GenerationStep,
): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: { $in: ['PENDING_CONTENT', 'PENDING_MEDIA', 'CHANGES_REQUESTED'] } as any },
    {
      $set: {
        status: 'PENDING_MEDIA' as PostStatus,
        mediaJobId,
        generationStep: step,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * Advance the post's generationStep checkpoint. Does not change status.
 */
export async function advanceGenerationStep(postId: string, step: GenerationStep): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any },
    {
      $set: {
        generationStep: step,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * On COMPLETED media job: copy the media URL/thumbnail/metadata onto the post,
 * mark generationStep MEDIA_DONE, and flip status to PENDING_APPROVAL.
 */
export async function applyMediaJobResultToPost(
  postId: string,
  job: MediaJobRecord,
): Promise<Post | null> {
  const col = getPostsCollection();
  const update: Record<string, unknown> = {
    status: 'PENDING_APPROVAL' as PostStatus,
    generationStep: 'MEDIA_DONE' as GenerationStep,
    lastStepAt: new Date().toISOString(),
    updatedAt: new Date(),
  };
  if (job.mediaUrl) {
    // Video posts use videoUrl + thumbnail; image posts use thumbnail and optionally mediaUrls.
    update.thumbnail = job.thumbnail ?? job.mediaUrl;
    if (job.postType === 'REEL' || job.postType === 'VIDEO') {
      update.videoUrl = job.mediaUrl;
    }
  }
  if (job.mediaUrls) {
    update.mediaUrls = job.mediaUrls;
    if (!update.thumbnail) update.thumbnail = job.mediaUrls[0];
  }
  if (job.metadata?.durationSeconds !== undefined) {
    update.duration = `${job.metadata.durationSeconds}s`;
  }
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: 'PENDING_MEDIA' as any },
    { $set: update as any },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * On FAILED media job: mark the post FAILED with a diagnostic error message.
 * (Reuses existing publishError field for surfacing; phase 6 may split out a
 * dedicated mediaError field.)
 */
export async function markPostFailedWithMedia(postId: string, error: string): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: 'PENDING_MEDIA' as any },
    {
      $set: {
        status: 'MISSED_DEADLINE' as PostStatus,
        publishError: `media-generation: ${error}`,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}
