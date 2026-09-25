import { vi, describe, it, expect, beforeEach, afterAll, Mock } from 'vitest';

// Define mocks first
const mockInitializeApp = vi.fn();
const mockCert = vi.fn();
const mockApplicationDefault = vi.fn();
const mockVerifyIdToken = vi.fn();
const mockGetUser = vi.fn();

// Mock the external library using unstable_mockModule for ESM
vi.mock('firebase-admin', () => ({
    __esModule: true,
    default: {
        initializeApp: mockInitializeApp,
        credential: {
            cert: mockCert,
            applicationDefault: mockApplicationDefault
        },
        auth: vi.fn(() => ({
            verifyIdToken: mockVerifyIdToken,
            getUser: mockGetUser
        }))
    }
}));

// Import the service dynamically
// Note: We deliberately omit .js extension to bypass moduleNameMapper used for other tests
const firebaseService = await import('../../src/services/firebase-admin');

describe('Firebase Admin Service', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        // Reset initialization state
        if ((firebaseService as any).resetFirebaseConfigForTesting) {
            (firebaseService as any).resetFirebaseConfigForTesting();
        }
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('Initialization', () => {
        it('should initialize with service account key (Option 1)', () => {
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"project_id": "test-sa"}';

            firebaseService.initializeFirebaseAdmin();

            expect(mockInitializeApp).toHaveBeenCalled();
            expect(mockCert).toHaveBeenCalledWith({ project_id: 'test-sa' });
            expect(firebaseService.isFirebaseInitialized()).toBe(true);
        });

        it('should initialize with application default credentials (Option 2)', () => {
            delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

            firebaseService.initializeFirebaseAdmin();

            expect(mockInitializeApp).toHaveBeenCalled();
            expect(mockApplicationDefault).toHaveBeenCalled();
            expect(firebaseService.isFirebaseInitialized()).toBe(true);
        });

        it('should initialize in development mode with project ID (Option 3)', () => {
            delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
            process.env.FIREBASE_PROJECT_ID = 'dev-project';

            firebaseService.initializeFirebaseAdmin();

            expect(mockInitializeApp).toHaveBeenCalledWith({ projectId: 'dev-project' });
            expect(firebaseService.isFirebaseInitialized()).toBe(true);
        });

        it('should NOT initialize if no config provided', () => {
            delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
            delete process.env.FIREBASE_PROJECT_ID;

            firebaseService.initializeFirebaseAdmin();

            expect(mockInitializeApp).not.toHaveBeenCalled();
            expect(firebaseService.isFirebaseInitialized()).toBe(false);
        });

        it('should not re-initialize if already initialized', () => {
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"project_id": "test"}';

            firebaseService.initializeFirebaseAdmin();
            expect(mockInitializeApp).toHaveBeenCalledTimes(1);

            // Second call
            firebaseService.initializeFirebaseAdmin();
            expect(mockInitializeApp).toHaveBeenCalledTimes(1);
        });

        it('should handle invalid JSON in service account key', () => {
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{invalid-json}';

            // Should catch error internally
            expect(() => firebaseService.initializeFirebaseAdmin()).not.toThrow();
            expect(firebaseService.isFirebaseInitialized()).toBe(false);
        });
    });

    describe('Verification', () => {
        beforeEach(() => {
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"project_id": "test"}';
            firebaseService.initializeFirebaseAdmin();
            vi.clearAllMocks(); // Clear calls from init
        });

        it('verifyFirebaseToken should call admin.auth().verifyIdToken', async () => {
            const mockUid = 'test-uid-123';
            (mockVerifyIdToken as Mock<any>).mockResolvedValue({ uid: mockUid });

            const result = await firebaseService.verifyFirebaseToken('valid-token');

            expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token');
            expect(result).toEqual({ uid: mockUid });
        });

        it('verifyFirebaseToken should return null on error', async () => {
            (mockVerifyIdToken as Mock<any>).mockRejectedValue(new Error('Auth error'));

            const result = await firebaseService.verifyFirebaseToken('invalid-token');

            expect(result).toBeNull();
        });

        it('verifyFirebaseToken should return null if not initialized', async () => {
            (firebaseService as any).resetFirebaseConfigForTesting();
            const result = await firebaseService.verifyFirebaseToken('token');
            expect(result).toBeNull();
        });
    });

    describe('GetUser', () => {
        beforeEach(() => {
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"project_id": "test"}';
            firebaseService.initializeFirebaseAdmin();
        });

        it('should get user by uid', async () => {
            const mockUser = { uid: 'u1', email: 'test@it.com' };
            (mockGetUser as Mock<any>).mockResolvedValue(mockUser);

            const result = await firebaseService.getFirebaseUser('u1');
            expect(result).toEqual(mockUser);
            expect(mockGetUser).toHaveBeenCalledWith('u1');
        });

        it('should return null on error', async () => {
            (mockGetUser as Mock<any>).mockRejectedValue(new Error('Ooops'));
            const result = await firebaseService.getFirebaseUser('u1');
            expect(result).toBeNull();
        });

        it('should return null if not initialized', async () => {
            (firebaseService as any).resetFirebaseConfigForTesting();
            const result = await firebaseService.getFirebaseUser('u1');
            expect(result).toBeNull();
        });
    });
});
