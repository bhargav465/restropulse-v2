/**
 * Firebase Admin SDK Configuration
 * 
 * For production:
 * 1. Go to Firebase Console > Project Settings > Service Accounts
 * 2. Click "Generate new private key"
 * 3. Save the JSON file securely
 * 4. Set FIREBASE_SERVICE_ACCOUNT_KEY env variable to the JSON content
 *    OR set GOOGLE_APPLICATION_CREDENTIALS to the file path
 */

import admin from 'firebase-admin';
import { DecodedIdToken } from 'firebase-admin/auth';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('firebase-admin');

let initialized = false;

/**
 * Initialize Firebase Admin SDK
 */
export function initializeFirebaseAdmin(): void {
    if (initialized) return;

    try {
        // Option 1: Service account from environment variable (JSON string)
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

        if (serviceAccountKey) {
            const serviceAccount = JSON.parse(serviceAccountKey);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            log.info('Firebase Admin initialized with service account');
        }
        // Option 2: GOOGLE_APPLICATION_CREDENTIALS env var (file path)
        else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
            log.info('Firebase Admin initialized with application default credentials');
        }
        // Option 3: Development mode with project ID only (limited functionality)
        else if (process.env.FIREBASE_PROJECT_ID) {
            admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
            log.info('Firebase Admin initialized in development mode with project ID only');
        }
        else {
            log.warn(
                'Firebase Admin not configured. ' +
                'Set FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) or ' +
                'GOOGLE_APPLICATION_CREDENTIALS (file path).'
            );
            return;
        }

        initialized = true;
    } catch (error) {
        log.error({ err: error }, 'Failed to initialize Firebase Admin');
    }
}

/**
 * Verify a Firebase ID token and return the decoded token
 */
export async function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken | null> {
    if (!initialized) {
        log.error('Firebase Admin not initialized');
        return null;
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return decodedToken;
    } catch (error) {
        log.error({ err: error }, 'Error verifying Firebase token');
        return null;
    }
}

/**
 * Get user info from Firebase by UID
 */
export async function getFirebaseUser(uid: string) {
    if (!initialized) return null;

    try {
        return await admin.auth().getUser(uid);
    } catch (error) {
        log.error({ err: error }, 'Error getting Firebase user');
        return null;
    }
}

/**
 * Check if Firebase Admin is initialized
 */
export function isFirebaseInitialized(): boolean {
    return initialized;
}


/**
 * Reset initialization state (for testing only)
 */
export function resetFirebaseConfigForTesting(): void {
    initialized = false;
}

export { admin };

