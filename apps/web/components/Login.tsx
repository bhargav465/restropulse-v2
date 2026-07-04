import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Smartphone, ShieldCheck, ArrowRight, KeyRound } from 'lucide-react';
import { initRecaptcha, sendOTP, verifyOTP, auth } from '../firebase';
import { RecaptchaVerifier } from 'firebase/auth';
import { getFirebaseApiKey } from '../utils/env';

interface LoginProps {
    onLogin: (firebaseIdToken: string) => Promise<void>;
    // Fallback for when Firebase is not configured
    onFallbackLogin?: (phone: string, otp: string) => Promise<void>;
}

type Step = 'phone' | 'otp';

// Check if Firebase is configured
const isFirebaseConfigured = () => {
    const apiKey = getFirebaseApiKey();
    return apiKey && apiKey !== 'your-api-key' && !apiKey.includes('your-');
};

// Check if development mode (allows fallback OTP)
const isDevelopment = () => import.meta.env.DEV;

const Login: React.FC<LoginProps> = ({ onLogin, onFallbackLogin }) => {
    const [step, setStep] = useState<Step>('phone');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(0);
    const [useFirebase, setUseFirebase] = useState(isFirebaseConfigured());

    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
    const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

    // Countdown timer for resend
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    // Initialize reCAPTCHA when component mounts (Firebase mode)
    useEffect(() => {
        if (useFirebase && step === 'phone') {
            // Small delay to ensure button is rendered
            const timer = setTimeout(() => {
                try {
                    recaptchaVerifierRef.current = initRecaptcha('send-otp-button');
                } catch (err) {
                    console.error('Failed to initialize reCAPTCHA:', err);
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [useFirebase, step]);

    // Format phone for display
    const formatPhone = (value: string) => {
        const digits = value.replace(/\D/g, '');
        if (digits.length <= 5) return digits;
        if (digits.length <= 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
        return `${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
        setPhone(digits);
        setError(null);
    };

    const handleSendOtp = async () => {
        if (phone.length !== 10) {
            setError('Please enter a valid 10-digit phone number');
            return;
        }

        setIsLoading(true);
        setError(null);

        const fullPhone = `+91${phone}`;

        try {
            if (useFirebase && recaptchaVerifierRef.current) {
                // Firebase Authentication
                await sendOTP(fullPhone, recaptchaVerifierRef.current);
                setStep('otp');
                setCountdown(30);
                setTimeout(() => otpRefs.current[0]?.focus(), 100);
            } else {
                // Fallback: Backend OTP (for development)
                setUseFirebase(false); // Ensure we use fallback mode for verification
                const response = await fetch(
                    `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/send-otp`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: fullPhone }),
                    }
                );

                const data = await response.json();

                if (data.success) {
                    setStep('otp');
                    setCountdown(30);

                    // Silent OTP: Auto-fill in development mode
                    if (data.devOtp) {
                        const otpDigits = data.devOtp.split('');
                        setOtp(otpDigits);
                        // Auto-verify after a short delay for UX
                        setTimeout(() => {
                            handleVerifyOtp(data.devOtp, true);
                        }, 500);
                    } else {
                        setTimeout(() => otpRefs.current[0]?.focus(), 100);
                    }
                } else {
                    setError(data.message || 'Failed to send OTP');
                }
            }
        } catch (err: any) {
            console.error('Send OTP error:', err);

            // Handle Firebase specific errors - fall back to dev OTP only in development
            if ((err.code === 'auth/billing-not-enabled' || err.code === 'auth/quota-exceeded') && isDevelopment()) {
                console.log('[DEV] Firebase billing/quota issue, falling back to dev OTP...');
                // Fall back to development OTP
                try {
                    const response = await fetch(
                        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/send-otp`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone: fullPhone }),
                        }
                    );
                    const data = await response.json();
                    if (data.success) {
                        setStep('otp');
                        setCountdown(30);
                        setUseFirebase(false); // Switch to fallback mode for verification
                        if (data.devOtp) {
                            const otpDigits = data.devOtp.split('');
                            setOtp(otpDigits);
                            // Auto-verify using fallback login
                            setTimeout(async () => {
                                if (onFallbackLogin) {
                                    try {
                                        // Force fallback here too
                                        await onFallbackLogin(fullPhone, data.devOtp);
                                    } catch (e) {
                                        console.error('Auto-verify failed:', e);
                                    }
                                }
                            }, 500);
                        } else {
                            setTimeout(() => otpRefs.current[0]?.focus(), 100);
                        }
                    } else {
                        setError(data.message || 'Failed to send OTP');
                    }
                } catch {
                    setError('Failed to send OTP. Please try again.');
                }
            } else if (err.code === 'auth/billing-not-enabled' || err.code === 'auth/quota-exceeded') {
                // Production - no fallback, show proper error
                setError('SMS service temporarily unavailable. Please try again later.');
            } else if (err.code === 'auth/invalid-phone-number') {
                setError('Invalid phone number format');
            } else if (err.code === 'auth/too-many-requests') {
                setError('Too many attempts. Please try again later.');
            } else {
                setError('Failed to send OTP. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleOtpChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;

        const newOtp = [...otp];
        newOtp[index] = value.slice(-1);
        setOtp(newOtp);
        setError(null);

        // Auto-focus next input
        if (value && index < 5) {
            otpRefs.current[index + 1]?.focus();
        }

        // Auto-submit when all digits entered
        if (value && index === 5 && newOtp.every((d) => d)) {
            handleVerifyOtp(newOtp.join(''));
        }
    };

    const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pastedData.length === 6) {
            const newOtp = pastedData.split('');
            setOtp(newOtp);
            otpRefs.current[5]?.focus();
            handleVerifyOtp(pastedData);
        }
    };

    const handleVerifyOtp = useCallback(async (otpCode?: string, forceFallback = false) => {
        const code = otpCode || otp.join('');
        if (code.length !== 6) {
            setError('Please enter the 6-digit OTP');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // If fallback is available and we're not explicitly using Firebase (or forced), use fallback
            // This is important for dev mode where OTP is auto-filled via backend
            if (onFallbackLogin && (!useFirebase || forceFallback)) {
                await onFallbackLogin(`+91${phone}`, code);
            } else if (useFirebase) {
                // Firebase: Verify OTP and get ID token
                try {
                    const idToken = await verifyOTP(code);
                    await onLogin(idToken);
                } catch (firebaseErr: any) {
                    // If Firebase verification fails and fallback is available, try fallback
                    if (onFallbackLogin && firebaseErr.message?.includes('No OTP request in progress')) {
                        await onFallbackLogin(`+91${phone}`, code);
                    } else {
                        throw firebaseErr;
                    }
                }
            } else {
                throw new Error('No authentication method available');
            }
        } catch (err: any) {
            console.error('Verify OTP error:', err);
            // Handle Firebase specific errors
            if (err.code === 'auth/invalid-verification-code') {
                setError('Invalid OTP. Please check and try again.');
            } else if (err.code === 'auth/code-expired') {
                setError('OTP has expired. Please request a new one.');
            } else {
                setError('Verification failed. Please try again.');
            }
            setOtp(['', '', '', '', '', '']);
            otpRefs.current[0]?.focus();
        } finally {
            setIsLoading(false);
        }
    }, [otp, phone, useFirebase, onLogin, onFallbackLogin]);

    const handleResendOtp = () => {
        if (countdown > 0) return;
        setOtp(['', '', '', '', '', '']);
        handleSendOtp();
    };

    const handleBack = () => {
        setStep('phone');
        setOtp(['', '', '', '', '', '']);
        setError(null);
    };

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-500 rounded-full blur-[100px]"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-amber-600 rounded-full blur-[100px]"></div>
            </div>

            <div className="z-10 w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-orange-500/20">
                        <span className="text-white font-bold text-2xl">R</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-1">RestroPulse</h1>
                    <p className="text-slate-400 text-sm">Sign in to your account</p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
                        {error}
                    </div>
                )}

                {step === 'phone' ? (
                    /* Phone Input Step */
                    <div className="space-y-6">
                        <div>
                            <label className="block text-slate-400 text-sm mb-2">
                                <Smartphone className="inline w-4 h-4 mr-1" />
                                Enter your phone number
                            </label>
                            <div className="flex gap-2">
                                <div className="bg-slate-800 text-white px-4 py-3.5 rounded-xl border border-slate-700 text-center font-medium">
                                    +91
                                </div>
                                <input
                                    type="tel"
                                    value={formatPhone(phone)}
                                    onChange={handlePhoneChange}
                                    aria-label="Phone number"
                                    placeholder="98765 43210"
                                    className="flex-1 bg-slate-800 text-white px-4 py-3.5 rounded-xl border border-slate-700 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 text-lg tracking-wider placeholder:text-slate-500"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <button
                            id="send-otp-button"
                            onClick={handleSendOtp}
                            disabled={isLoading || phone.length !== 10}
                            className="w-full bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <span className="animate-pulse">Sending OTP...</span>
                            ) : (
                                <>
                                    <KeyRound size={20} />
                                    <span>Get OTP</span>
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>

                        <p className="text-center text-xs text-slate-500">
                            We'll send a 6-digit verification code to your phone
                        </p>
                    </div>
                ) : (
                    /* OTP Verification Step */
                    <div className="space-y-6">
                        <div className="text-center">
                            <div className="w-12 h-12 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                <ShieldCheck className="w-6 h-6 text-orange-500" />
                            </div>
                            <p className="text-slate-400 text-sm mb-1">
                                Enter the code sent to
                            </p>
                            <p className="text-white font-medium">+91 {formatPhone(phone)}</p>
                            <button
                                onClick={handleBack}
                                className="text-orange-500 text-sm mt-1 hover:underline"
                            >
                                Change number
                            </button>
                        </div>

                        <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                            {otp.map((digit, index) => (
                                <input
                                    key={index}
                                    ref={(el) => { otpRefs.current[index] = el; }}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handleOtpChange(index, e.target.value)}
                                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                                    aria-label={`OTP digit ${index + 1}`}
                                    className="w-12 h-14 bg-slate-800 text-white text-center text-xl font-bold rounded-xl border border-slate-700 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                />
                            ))}
                        </div>

                        <button
                            onClick={() => handleVerifyOtp()}
                            disabled={isLoading || otp.some((d) => !d)}
                            className="w-full bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <span className="animate-pulse">Verifying...</span>
                            ) : (
                                'Verify & Login'
                            )}
                        </button>

                        <div className="text-center">
                            {countdown > 0 ? (
                                <p className="text-slate-500 text-sm">
                                    Resend code in <span className="text-white">{countdown}s</span>
                                </p>
                            ) : (
                                <button
                                    onClick={handleResendOtp}
                                    className="text-orange-500 text-sm hover:underline"
                                >
                                    Resend OTP
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <p className="mt-8 text-xs text-slate-500 text-center">
                    By continuing, you agree to our Terms of Service & Privacy Policy.
                </p>
            </div>
        </div>
    );
};

export default Login;