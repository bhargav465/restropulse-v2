/**
 * fal.ai queue API types.
 * https://queue.fal.run/<model> for async submission + polling.
 */

export type FalQueueStatusValue = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface FalQueueSubmission {
  requestId: string;
  /** fal.ai-provided URLs; we ignore them and reconstruct via model + requestId. */
  statusUrl?: string;
  responseUrl?: string;
}

export interface FalQueueStatus {
  status: FalQueueStatusValue;
  queuePosition?: number;
  logs?: Array<{ message?: string; level?: string }>;
}
