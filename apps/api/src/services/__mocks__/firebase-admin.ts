import { vi } from 'vitest';

export const verifyFirebaseToken = vi.fn();
export const isFirebaseInitialized = vi.fn().mockReturnValue(true);
export const initializeFirebaseAdmin = vi.fn();
export const getFirebaseUser = vi.fn();
