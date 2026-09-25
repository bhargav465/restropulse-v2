/**
 * Firebase Configuration
 * 
 * For production, create a Firebase project at https://console.firebase.google.com/
 * 1. Create a new project
 * 2. Enable Authentication > Sign-in method > Phone
 * 3. Add your domain to authorized domains
 * 4. Copy the config from Project Settings > General > Your apps > Web app
 */

import { getAppUrl } from './utils/env';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
    getAuth,
    Auth,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    ConfirmationResult,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
} from 'firebase/auth';
import type { ClientConfig } from '@restropulse/shared';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/**
 * Initialize Firebase using the resolved runtime client config.
 * Must be called once (after `initClientConfig()` resolves) before any
 * other function in this module is used.
 */
export function initFirebase(cfg: ClientConfig): void {
    app = initializeApp(cfg.firebase);
    auth = getAuth(app);
    auth.useDeviceLanguage();
}

function requireAuth(): Auth {
    if (!auth) {
        throw new Error('Firebase not initialized: call initFirebase() first');
    }
    return auth;
}

// Store confirmation result for OTP verification
let confirmationResult: ConfirmationResult | null = null;
let otpRequestInProgress = false;

/**
 * Initialize invisible reCAPTCHA verifier
 * Must be called before sending OTP
 */
export function initRecaptcha(buttonId: string): RecaptchaVerifier {
    if ((window as any).recaptchaVerifier) {
        return (window as any).recaptchaVerifier as RecaptchaVerifier;
    }

    // The site key is provisioned by the Firebase Auth backend for the project;
    // RecaptchaVerifier rejects/ignores a client-supplied one, so none is passed.
    const verifier = new RecaptchaVerifier(requireAuth(), buttonId, {
        size: 'invisible',
        callback: () => {
            // reCAPTCHA solved - will proceed with phone auth
            console.log('reCAPTCHA verified');
        },
        'expired-callback': () => {
            // Reset reCAPTCHA
            console.log('reCAPTCHA expired');
        }
    });

    (window as any).recaptchaVerifier = verifier;
    return verifier;
}

/**
 * Send OTP to phone number using Firebase
 */
export async function sendOTP(phoneNumber: string, recaptchaVerifier: RecaptchaVerifier): Promise<void> {
    if (otpRequestInProgress) {
        throw new Error('OTP request already in progress. Please wait.');
    }

    otpRequestInProgress = true;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
        // Create a timeout that clears reCAPTCHA to stop Firebase SDK retries
        timeoutHandle = setTimeout(() => {
            console.warn('OTP request timeout after 10s, clearing reCAPTCHA');
            try {
                recaptchaVerifier.clear();
            } catch (e) {
                console.error('Error clearing reCAPTCHA:', e);
            }
        }, 10000);

        confirmationResult = await signInWithPhoneNumber(requireAuth(), phoneNumber, recaptchaVerifier);
        console.log('OTP sent successfully');
    } catch (error: any) {
        console.error('Error sending OTP:', error);
        throw error;
    } finally {
        otpRequestInProgress = false;
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Verify OTP and get Firebase ID token
 */
export async function verifyOTP(otp: string): Promise<string> {
    if (!confirmationResult) {
        throw new Error('No OTP request in progress. Please request OTP first.');
    }

    try {
        const result = await confirmationResult.confirm(otp);
        const idToken = await result.user.getIdToken();
        console.log('OTP verified successfully');
        return idToken;
    } catch (error: any) {
        console.error('Error verifying OTP:', error);
        throw error;
    }
}

/**
 * Get current user's ID token (refreshes if expired)
 */
export async function getIdToken(): Promise<string | null> {
    const user = requireAuth().currentUser;
    if (!user) return null;
    return user.getIdToken(true);
}

/**
 * Sign out from Firebase
 */
export async function signOut(): Promise<void> {
    await requireAuth().signOut();
    confirmationResult = null;
}

/**
 * Get Firebase auth instance
 */
export function getFirebaseAuth(): Auth {
    return requireAuth();
}

const EMAIL_STORAGE_KEY = 'rp_email_for_verification';

export async function sendEmailVerificationLink(email: string): Promise<void> {
    const actionCodeSettings = {
        url: `${getAppUrl()}?emailVerified=true`,
        handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(requireAuth(), email, actionCodeSettings);
    localStorage.setItem(EMAIL_STORAGE_KEY, email);
}

export async function completeEmailVerification(): Promise<{ email: string; idToken: string } | null> {
    const currentUrl = window.location.href;
    if (!isSignInWithEmailLink(requireAuth(), currentUrl)) {
        return null;
    }
    // Strip the oobCode from the URL immediately so back-navigation or remounts
    // cannot attempt to reuse the now-spent action code.
    window.history.replaceState({}, '', window.location.pathname);
    let email = localStorage.getItem(EMAIL_STORAGE_KEY);
    if (!email) {
        email = window.prompt('Please enter your email to confirm verification');
    }
    if (!email) return null;
    const credential = await signInWithEmailLink(requireAuth(), email, currentUrl);
    localStorage.removeItem(EMAIL_STORAGE_KEY);
    const idToken = await credential.user.getIdToken();
    return { email, idToken };
}

export function isEmailSignInLink(): boolean {
    return isSignInWithEmailLink(requireAuth(), window.location.href);
}

export function getStoredVerificationEmail(): string | null {
    return localStorage.getItem(EMAIL_STORAGE_KEY);
}
