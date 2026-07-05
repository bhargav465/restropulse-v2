import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowRight, ArrowLeft, Check, Loader2, ChevronDown, User, Mail, RefreshCw, CheckCircle2 } from 'lucide-react';
import { getGoogleMapsApiKey } from '../utils/env';

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    options: { label: string; value: string }[];
}

const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder = 'Select...',
    disabled,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = (val: string) => {
        onChange(val);
        setIsOpen(false);
    };

    const selectedOption = options.find((opt) => opt.value === value);

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full flex items-center justify-between text-left px-4 py-3.5 bg-white border rounded-xl transition-all outline-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300'
                    } ${isOpen
                        ? 'border-orange-500 ring-1 ring-orange-500'
                        : 'border-slate-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                    }`}
            >
                <span className={selectedOption ? 'text-slate-900' : 'text-slate-500'}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown
                    size={16}
                    className={`text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
                        }`}
                />
            </button>

            {isOpen && !disabled && (
                <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100">
                    {options.length === 0 ? (
                        <li className="px-4 py-3 text-sm text-slate-500 text-center">
                            No options available
                        </li>
                    ) : (
                        options.map((opt) => (
                            <li key={opt.value}>
                                <button
                                    type="button"
                                    onClick={() => handleSelect(opt.value)}
                                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${value === opt.value
                                        ? 'bg-orange-500/10 text-orange-400 font-medium'
                                        : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
};
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { PlacesAutocompleteInput } from './PlacesAutocompleteInput';
import type { Restaurant, AccountManager, City, EmailVerificationStatus } from '@restropulse/shared';
import { restaurantAPI, accountManagerAPI, citiesAPI, authAPI } from '../api';
import { sendEmailVerificationLink, completeEmailVerification, isEmailSignInLink, getStoredVerificationEmail } from '../firebase';

interface OnboardingProps {
    onComplete: (restaurant: Restaurant) => void;
}

// Module-level flag: persists across React StrictMode unmount/remount cycles.
// Must live here (not in a useRef) because React StrictMode re-initializes refs
// on remount. Without this guard, a rapid double-click or dev-mode StrictMode
// remount would call signInWithEmailLink twice — second call fails with
// auth/invalid-action-code because the oobCode was already consumed.
let emailVerificationAttempted = false;

/** Reset the email verification guard. Exposed for testing only. */
export function resetEmailVerificationState(): void {
    emailVerificationAttempted = false;
}

type OnboardingStep = 1 | 2 | 3;

const STEP_LABELS = ['About You', 'Your Restaurant', 'Account Manager'];



const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const googleMapsApiKey = getGoogleMapsApiKey() || '';
    const isMountedRef = useRef(true);
    const [step, setStep] = useState<OnboardingStep>(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cities from API
    const [cities, setCities] = useState<City[]>([]);

    // Step 1 - About You
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [emailStatus, setEmailStatus] = useState<EmailVerificationStatus>('idle');
    const [emailError, setEmailError] = useState<string | null>(null);
    const [resendCountdown, setResendCountdown] = useState(0);

    // Step 2 - Your Restaurant
    const [city, setCity] = useState('');
    const [restaurantName, setRestaurantName] = useState('');
    const [cuisine, setCuisine] = useState('');
    const [address, setAddress] = useState('');
    const [lat, setLat] = useState(0);
    const [lng, setLng] = useState(0);
    const [mapUrl, setMapUrl] = useState('');
    const [locationConfirmed, setLocationConfirmed] = useState(false);

    // Step 3 - Account Manager
    const [zone, setZone] = useState('');
    const [zones, setZones] = useState<string[]>([]);
    const [managers, setManagers] = useState<AccountManager[]>([]);
    const [selectedManager, setSelectedManager] = useState<AccountManager | null>(null);
    const [loadingManagers, setLoadingManagers] = useState(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        // Detect returning from email verification link.
        // Do NOT consume the oobCode here — set link_ready instead so the user
        // must click a button. Email security scanners follow links automatically
        // but don't click buttons; consuming the oobCode on page load would cause
        // auth/invalid-action-code when the human clicks the link moments later.
        if (isEmailSignInLink()) {
            setEmailStatus('link_ready');
            const storedEmail = getStoredVerificationEmail();
            if (storedEmail) setEmail(storedEmail);
            const storedName = localStorage.getItem('rp_onboarding_name');
            if (storedName) setUserName(storedName);
        }
    }, []);

    const handleConfirmVerification = () => {
        if (emailVerificationAttempted) return;
        emailVerificationAttempted = true;
        setEmailStatus('verifying');
        completeEmailVerification()
            .then((result) => {
                if (!isMountedRef.current) return;
                if (result) {
                    setEmail(result.email);
                    setEmailStatus('verified');
                    setEmailError(null);
                    const savedName = localStorage.getItem('rp_onboarding_name');
                    if (savedName) {
                        setUserName(savedName);
                        localStorage.removeItem('rp_onboarding_name');
                    }
                    authAPI.verifyEmail(result.idToken).catch(() => {
                        // Non-fatal: email locally verified; persisted on restaurantAPI.create
                    });
                } else {
                    setEmailStatus('error');
                    setEmailError('Could not verify email. Please try again.');
                }
            })
            .catch((err: unknown) => {
                if (!isMountedRef.current) return;
                emailVerificationAttempted = false;
                const code = (err as { code?: string })?.code;
                console.error('[email-verification] signInWithEmailLink failed', { code, err });
                setEmailStatus('error');
                setEmailError('Email verification failed. The link may have expired.');
            });
    };

    useEffect(() => {
        if (resendCountdown > 0) {
            const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendCountdown]);

    const handleSendVerification = async () => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setEmailError('Please enter a valid email address');
            return;
        }
        setEmailStatus('sending');
        setEmailError(null);
        try {
            if (userName.trim()) {
                localStorage.setItem('rp_onboarding_name', userName.trim());
            }
            await sendEmailVerificationLink(email);
            setEmailStatus('sent');
            setResendCountdown(60);
        } catch (err: any) {
            setEmailStatus('error');
            setEmailError(err.message || 'Failed to send verification email. Please try again.');
        }
    };

    const handleResendVerification = async () => {
        if (resendCountdown > 0) return;
        setEmailStatus('sending');
        setEmailError(null);
        try {
            await sendEmailVerificationLink(email);
            setEmailStatus('sent');
            setResendCountdown(60);
        } catch (err: any) {
            setEmailStatus('error');
            setEmailError(err.message || 'Failed to resend verification email.');
        }
    };

    const fetchManagers = useCallback(async (selectedCity: string, selectedZone?: string) => {
        if (!selectedCity) return;
        if (!isMountedRef.current) return;
        setLoadingManagers(true);
        try {
            const result = await accountManagerAPI.getByCityAndZone(selectedCity, selectedZone);
            if (!isMountedRef.current) return;
            setManagers(result);

            // Extract unique zones from results
            if (!selectedZone) {
                const uniqueZones = [...new Set(result.map((m) => m.zone))];
                setZones(uniqueZones);
                if (uniqueZones.length === 1) {
                    setZone(uniqueZones[0]);
                }
            }

            // Auto-select if only one manager
            if (result.length === 1) {
                setSelectedManager(result[0]);
            }
        } catch {
            if (isMountedRef.current) {
                setManagers([]);
            }
        } finally {
            if (isMountedRef.current) {
                setLoadingManagers(false);
            }
        }
    }, []);

    useEffect(() => {
        let isActive = true;

        citiesAPI.getAll()
            .then((result) => {
                if (!isActive || !isMountedRef.current) return;
                setCities(result);
                if (result.length === 1) {
                    setCity(result[0].name);
                }
            })
            .catch(() => {
                if (isActive && isMountedRef.current) {
                    setCities([]);
                }
            });

        return () => {
            isActive = false;
        };
    }, []);

    const handlePlaceSelect = useCallback(
        (result: { address: string; lat: number; lng: number; city?: string }) => {
            setAddress(result.address);
            setLat(result.lat);
            setLng(result.lng);
            setMapUrl(`https://www.google.com/maps?q=${result.lat},${result.lng}`);
            setLocationConfirmed(true);

            if (result.city) {
                setCity((prev) => prev || result.city!);
            }
        },
        [],
    );

    useEffect(() => {
        if (city) {
            setZone('');
            setSelectedManager(null);
            fetchManagers(city);
        }
    }, [city, fetchManagers]);

    useEffect(() => {
        if (city && zone) {
            setSelectedManager(null);
            fetchManagers(city, zone);
        }
    }, [zone, city, fetchManagers]);

    const canProceed = (): boolean => {
        switch (step) {
            case 1:
                return userName.trim().length >= 2 && emailStatus === 'verified';
            case 2:
                return city.length > 0 && restaurantName.trim().length >= 2 && cuisine.trim().length >= 2 && address.trim().length > 0;
            case 3:
                return selectedManager !== null;
        }
    };

    const handleNext = () => {
        if (step < 3) {
            setStep((step + 1) as OnboardingStep);
            setError(null);
        }
    };

    const handleBack = () => {
        if (step > 1) {
            setStep((step - 1) as OnboardingStep);
            setError(null);
        }
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            const result = await restaurantAPI.create({
                userName: userName.trim(),
                email: email.trim(),
                name: restaurantName.trim(),
                cuisine: cuisine.trim(),
                location: {
                    address: address.trim(),
                    lat,
                    lng,
                    mapUrl,
                },
                accountManager: selectedManager
                    ? {
                        name: selectedManager.name,
                        phone: selectedManager.phone,
                        email: selectedManager.email,
                        avatar: selectedManager.avatar,
                    }
                    : { name: '', phone: '', email: '', avatar: '' },
            });

            // Store new tokens
            localStorage.setItem('rp_token', result.token);
            localStorage.setItem('rp_refresh_token', result.refreshToken);
            localStorage.setItem('rp_restaurant_id', result.restaurant.id);

            onComplete(result.restaurant);
        } catch (err: any) {
            setError('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderHeader = () => (
        <div className="mb-8">
            <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0">
                    <span className="text-slate-900 font-bold text-lg">R</span>
                </div>
                <span className="text-slate-900 font-semibold text-sm tracking-wide">RestroPulse</span>
            </div>
            <div className="flex items-start">
                {STEP_LABELS.map((label, index) => {
                    const stepNum = (index + 1) as OnboardingStep;
                    const isActive = step === stepNum;
                    const isCompleted = step > stepNum;

                    return (
                        <React.Fragment key={label}>
                            <div className="flex flex-col items-center" style={{ flex: '0 0 auto' }}>
                                <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${isActive
                                        ? 'bg-gradient-to-br from-orange-500 to-amber-600 text-slate-900 shadow-lg shadow-orange-500/30 ring-4 ring-orange-500/20'
                                        : isCompleted
                                            ? 'bg-green-500/20 text-green-400 border-2 border-green-500/50'
                                            : 'bg-white text-slate-500 border-2 border-slate-200'
                                        }`}
                                >
                                    {isCompleted ? <Check size={14} /> : stepNum}
                                </div>
                                <span
                                    className={`text-xs mt-2 text-center ${isActive ? 'text-orange-400 font-semibold' : isCompleted ? 'text-green-400 font-medium' : 'text-slate-500'
                                        }`}
                                >
                                    {label}
                                </span>
                            </div>
                            {index < STEP_LABELS.length - 1 && (
                                <div className="flex-1 h-8 flex items-center px-2">
                                    <div
                                        className={`w-full h-0.5 rounded-full ${step > stepNum ? 'bg-green-500/50' : 'bg-slate-100'
                                            }`}
                                    />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );

    const renderStep1 = () => (
        <div className="space-y-6">
            <div className="mb-2">
                <h2 className="text-lg font-bold text-slate-900">Welcome to RestroPulse</h2>
                <p className="text-slate-500 text-sm mt-0.5">Tell us about yourself</p>
            </div>

            <div>
                <label className="block text-slate-500 text-sm mb-2">Your name</label>
                <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. Arjun Mehta"
                    disabled={emailStatus === 'link_ready' || emailStatus === 'verifying'}
                    className="w-full bg-white text-slate-900 px-4 py-3.5 rounded-xl border border-slate-200 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    autoFocus
                />
            </div>

            <div>
                <label className="block text-slate-500 text-sm mb-2">Email address</label>
                <div className="flex gap-2">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            if (emailStatus === 'verified' || emailStatus === 'sent') {
                                setEmailStatus('idle');
                            }
                            setEmailError(null);
                        }}
                        placeholder="e.g. arjun@example.com"
                        disabled={emailStatus === 'verified' || emailStatus === 'sending' || emailStatus === 'verifying' || emailStatus === 'link_ready'}
                        className="flex-1 bg-white text-slate-900 px-4 py-3.5 rounded-xl border border-slate-200 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {emailStatus !== 'verified' && emailStatus !== 'sent' && emailStatus !== 'link_ready' && (
                        <button
                            type="button"
                            onClick={handleSendVerification}
                            disabled={emailStatus === 'sending' || emailStatus === 'verifying' || !email}
                            className="px-4 py-3.5 bg-orange-500 hover:bg-orange-600 text-slate-900 font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                        >
                            {emailStatus === 'sending' || emailStatus === 'verifying'
                                ? <Loader2 size={16} className="animate-spin" />
                                : <Mail size={16} />}
                            Verify
                        </button>
                    )}
                </div>

                {emailError && (
                    <p className="text-red-500 text-xs mt-2">{emailError}</p>
                )}

                {emailStatus === 'sent' && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <p className="text-amber-700 text-sm font-medium">Verification email sent</p>
                        <p className="text-slate-500 text-xs mt-1">
                            Check your inbox for a verification link. Click the link to verify your email.
                        </p>
                        {resendCountdown > 0 ? (
                            <p className="mt-2 text-slate-400 text-xs">
                                Resend in {resendCountdown}s
                            </p>
                        ) : (
                            <button
                                type="button"
                                onClick={handleResendVerification}
                                className="mt-2 text-orange-500 hover:text-orange-600 text-xs font-medium flex items-center gap-1 transition-colors"
                            >
                                <RefreshCw size={12} />
                                Resend verification email
                            </button>
                        )}
                    </div>
                )}

                {emailStatus === 'link_ready' && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                        <div>
                            <p className="text-blue-700 text-sm font-medium">Verification link ready</p>
                            {email && (
                                <p className="text-slate-500 text-xs mt-0.5">Confirming: {email}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleConfirmVerification}
                            className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-slate-900 font-medium rounded-xl text-sm flex items-center justify-center gap-2 transition-all"
                        >
                            <CheckCircle2 size={15} />
                            Confirm email verification
                        </button>
                    </div>
                )}

                {emailStatus === 'verifying' && (
                    <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-orange-500" />
                        <p className="text-slate-600 text-sm">Verifying your email...</p>
                    </div>
                )}

                {emailStatus === 'verified' && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-green-600" />
                        <p className="text-green-700 text-sm font-medium">Email verified</p>
                    </div>
                )}
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="space-y-6">
            <div className="mb-2">
                <h2 className="text-lg font-bold text-slate-900">Your Restaurant</h2>
                <p className="text-slate-500 text-sm mt-0.5">Tell us about your restaurant</p>
            </div>

            <div>
                <label className="block text-slate-500 text-sm mb-2">City</label>
                <div className="relative">
                    <CustomSelect
                        value={city}
                        onChange={(value) => setCity(value)}
                        placeholder="Select city"
                        options={cities.map((c) => ({ label: c.name, value: c.name }))}
                    />
                </div>
            </div>

            <div>
                <label className="block text-slate-500 text-sm mb-2">Restaurant name</label>
                <input
                    type="text"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    placeholder="e.g. The Spice Lounge"
                    className="w-full bg-white text-slate-900 px-4 py-3.5 rounded-xl border border-slate-200 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400"
                />
            </div>

            <div>
                <label className="block text-slate-500 text-sm mb-2">Cuisine type</label>
                <input
                    type="text"
                    value={cuisine}
                    onChange={(e) => setCuisine(e.target.value)}
                    placeholder="e.g. Modern Indian Fusion"
                    className="w-full bg-white text-slate-900 px-4 py-3.5 rounded-xl border border-slate-200 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400"
                />
            </div>

            {googleMapsApiKey ? (
                <APIProvider apiKey={googleMapsApiKey}>
                    <div>
                        <label className="block text-slate-500 text-sm mb-2">Restaurant address</label>
                        <PlacesAutocompleteInput onSelect={handlePlaceSelect} city={city} cityNames={cities.map(c => c.name)} initialValue={address} />
                    </div>

                    <div>
                        <div
                            className={`rounded-xl overflow-hidden border border-slate-200 transition-all duration-500 ease-out ${locationConfirmed
                                ? 'max-h-56 opacity-100 mt-4'
                                : 'max-h-0 opacity-0 overflow-hidden'
                                }`}
                            data-testid="map-container"
                        >
                            <Map
                                style={{ width: '100%', height: '14rem' }}
                                defaultCenter={{ lat, lng }}
                                center={{ lat, lng }}
                                zoom={16}
                                disableDefaultUI

                                mapId="onboarding-map"
                            >
                                {lat !== 0 && lng !== 0 && <AdvancedMarker position={{ lat, lng }} />}
                            </Map>
                        </div>
                    </div>
                </APIProvider>
            ) : (
                <div>
                    <label className="block text-slate-500 text-sm mb-2">Restaurant address</label>
                    <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="e.g. 12, Indiranagar, Bangalore, KA"
                        className="w-full bg-white text-slate-900 px-4 py-3.5 rounded-xl border border-slate-200 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400"
                    />
                    {!googleMapsApiKey && (
                        <p className="text-slate-500 text-xs mt-2">
                            Google Maps API key not configured. Enter address manually.
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    const renderStep3 = () => (
        <div className="space-y-6">
            <div className="mb-2">
                <h2 className="text-lg font-bold text-slate-900">Account Manager</h2>
                <p className="text-slate-500 text-sm mt-0.5">Choose your dedicated account manager</p>
            </div>

            {city && (
                <p className="text-slate-500 text-sm">Showing managers in <span className="text-slate-900 font-medium">{city}</span></p>
            )}

            <div>
                <label className="block text-slate-500 text-sm mb-2">Zone</label>
                <div className="relative">
                    <CustomSelect
                        value={zone}
                        onChange={(value) => setZone(value)}
                        placeholder="All zones"
                        disabled={!city || zones.length === 0}
                        options={zones.map((z) => ({ label: z, value: z }))}
                    />
                </div>
            </div>

            {loadingManagers && (
                <div className="flex items-center justify-center py-6 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading managers...
                </div>
            )}

            {!loadingManagers && city && managers.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-sm">
                    No account managers available for this area.
                </div>
            )}

            {!loadingManagers && managers.length > 0 && (
                <div className="space-y-3 max-h-48 overflow-y-auto">
                    {managers.map((manager) => (
                        <button
                            key={manager.id}
                            onClick={() =>
                                setSelectedManager(selectedManager?.id === manager.id ? null : manager)
                            }
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${selectedManager?.id === manager.id
                                ? 'border-orange-500 bg-orange-500/10'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                        >
                            {manager.avatar ? (
                                <img
                                    src={manager.avatar}
                                    alt={manager.name}
                                    className="w-10 h-10 rounded-full object-cover bg-slate-100"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                    <User size={20} className="text-slate-500" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-slate-900 font-medium text-sm truncate">{manager.name}</p>
                                <p className="text-slate-500 text-xs truncate">{manager.phone}</p>
                            </div>
                            {selectedManager?.id === manager.id && (
                                <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                                    <Check size={14} className="text-slate-900" />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="h-screen bg-slate-50 flex flex-col relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-500 rounded-full blur-[100px]"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-amber-600 rounded-full blur-[100px]"></div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto z-10">
                <div className="w-full max-w-md mx-auto px-6 pt-6 pb-4">
                    {renderHeader()}

                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
                            {error}
                        </div>
                    )}

                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                </div>
            </div>

            {/* Sticky Navigation */}
            <div className="z-10 border-t border-slate-200 bg-white/95 backdrop-blur-sm px-6 py-4">
                <div className="flex gap-3 max-w-md mx-auto">
                    {step > 1 && (
                        <button
                            onClick={handleBack}
                            className="flex-1 bg-white hover:bg-slate-100 text-slate-900 font-medium py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all border border-slate-200"
                        >
                            <ArrowLeft size={18} />
                            Back
                        </button>
                    )}

                    {step < 3 ? (
                        <button
                            onClick={handleNext}
                            disabled={!canProceed()}
                            className="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-slate-900 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                            <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !canProceed()}
                            className="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-slate-900 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    Setting up...
                                </>
                            ) : (
                                <>
                                    Get Started
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
