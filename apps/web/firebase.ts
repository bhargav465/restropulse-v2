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
import { initializeApp } from 'firebase/app';
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

// Firebase configuration - replace with your actual config
// These values should be in environment variables for production
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'your-api-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'your-project.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'your-project-id',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'your-project.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abc123',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Configure auth settings
auth.useDeviceLanguage();

// Store confirmation result for OTP verification
let confirmationResult: ConfirmationResult | null = null;

/**
 * Initialize invisible reCAPTCHA verifier
 * Must be called before sending OTP
 */
export function initRecaptcha(buttonId: string): RecaptchaVerifier {
    // Clear any existing verifier
    if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
    }

    const verifier = new RecaptchaVerifier(auth, buttonId, {
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
    try {
        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
        console.log('OTP sent successfully');
    } catch (error: any) {
        console.error('Error sending OTP:', error);
        // Reset reCAPTCHA on error
        if ((window as any).recaptchaVerifier) {
            (window as any).recaptchaVerifier.clear();
            (window as any).recaptchaVerifier = null;
        }
        throw error;
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
    const user = auth.currentUser;
    if (!user) return null;
    return user.getIdToken(true);
}

/**
 * Sign out from Firebase
 */
export async function signOut(): Promise<void> {
    await auth.signOut();
    confirmationResult = null;
}

/**
 * Get Firebase auth instance
 */
export function getFirebaseAuth(): Auth {
    return auth;
}

const EMAIL_STORAGE_KEY = 'rp_email_for_verification';

export async function sendEmailVerificationLink(email: string): Promise<void> {
    const actionCodeSettings = {
        url: `${getAppUrl()}?emailVerified=true`,
        handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem(EMAIL_STORAGE_KEY, email);
}

export async function completeEmailVerification(): Promise<{ email: string; idToken: string } | null> {
    const currentUrl = window.location.href;
    if (!isSignInWithEmailLink(auth, currentUrl)) {
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
    const credential = await signInWithEmailLink(auth, email, currentUrl);
    localStorage.removeItem(EMAIL_STORAGE_KEY);
    const idToken = await credential.user.getIdToken();
    return { email, idToken };
}

export function isEmailSignInLink(): boolean {
    return isSignInWithEmailLink(auth, window.location.href);
}

export function getStoredVerificationEmail(): string | null {
    return localStorage.getItem(EMAIL_STORAGE_KEY);
}

export { auth };
