/**
 * Instagram OAuth Callback Handler
 * Handles both popup and redirect OAuth flows
 */

import React, { useEffect, useState } from 'react';
import { instagramAPI } from '../api';
import { InstagramAccount, InstagramConnectionError } from '@restropulse/shared';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { InstagramIcon } from './BrandIcons';

interface InstagramCallbackProps {
    onComplete?: (success: boolean, username?: string) => void;
    onError?: (error: InstagramConnectionError, message: string) => void;
}

// Error messages for user display
const ERROR_MESSAGES: Record<InstagramConnectionError, { title: string; description: string }> = {
    NO_PAGES_FOUND: {
        title: 'No Facebook Pages Found',
        description: 'Please ensure you are an Admin of a Facebook Page.'
    },
    NO_IG_ACCOUNT_FOUND: {
        title: 'Personal Instagram Account',
        description: 'Your Instagram is currently a Personal account. Switch to Professional in Instagram Settings to continue.'
    },
    PERMISSIONS_MISSING: {
        title: 'Permissions Required',
        description: 'Please re-authenticate and ensure all checkboxes are checked in the Facebook popup.'
    },
    INVALID_STATE: {
        title: 'Session Expired',
        description: 'Invalid or expired authorization request. Please try again.'
    },
    TOKEN_EXCHANGE_FAILED: {
        title: 'Authorization Failed',
        description: 'Failed to complete authorization. Please try again.'
    },
    API_ERROR: {
        title: 'Connection Error',
        description: 'An error occurred while connecting to Instagram. Please try again.'
    },
    ACCOUNT_TYPE_MISMATCH: {
        title: 'Account Type Issue',
        description: 'Your account type may not support all required features. Please check your Instagram account settings.'
    },
    RATE_LIMITED: {
        title: 'Too Many Attempts',
        description: 'Instagram is temporarily rate limiting requests. Please wait a few minutes and try again.'
    },
    CONFIG_ERROR: {
        title: 'Configuration Issue',
        description: 'Instagram integration is not configured correctly. Please contact support if this continues.'
    },
    TIMEOUT: {
        title: 'Request Timed Out',
        description: 'The request timed out. Please check your network connection and try again.'
    }
};

// Module-level flag — Meta OAuth authorization codes are single-use. Without this guard,
// React StrictMode's unmount/remount cycle would call instagramAPI.handleCallback twice
// with the same code; the second call would fail because the code was already consumed.
let callbackProcessed = false;

const InstagramCallback: React.FC<InstagramCallbackProps> = ({ onComplete, onError }) => {
    const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'selecting'>('loading');
    const [message, setMessage] = useState('Processing authorization...');
    const [errorType, setErrorType] = useState<InstagramConnectionError | null>(null);
    const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
    const [selectionId, setSelectionId] = useState<string | null>(null);
    const [username, setUsername] = useState<string | null>(null);

    useEffect(() => {
        if (callbackProcessed) return;
        callbackProcessed = true;
        handleCallback();
    }, []);

    const handleCallback = async () => {
        const params = new URLSearchParams(window.location.search);

        // Check for success (redirect flow)
        if (params.get('success') === 'true') {
            const connectedUsername = params.get('username');
            setStatus('success');
            setUsername(connectedUsername);
            setMessage(`Successfully linked to @${connectedUsername}!`);
            notifyParent(true, connectedUsername || undefined);
            return;
        }

        // Check for account selection (redirect flow)
        if (params.get('select') === 'true') {
            const sid = params.get('selectionId');
            if (sid) {
                setSelectionId(sid);
                await loadPendingAccounts(sid);
            }
            return;
        }

        // Check for error (redirect flow)
        const error = params.get('error') as InstagramConnectionError;
        if (error) {
            const errorMessage = params.get('message') || ERROR_MESSAGES[error]?.description || 'An error occurred';
            setStatus('error');
            setErrorType(error);
            setMessage(errorMessage);
            notifyParent(false, undefined, error, errorMessage);
            return;
        }

        // Try popup flow (code in URL)
        const code = params.get('code');
        const state = params.get('state');

        if (code && state) {
            try {
                const result = await instagramAPI.handleCallback(code, state);

                if (!result.success) {
                    setStatus('error');
                    setErrorType(result.error || 'API_ERROR');
                    setMessage(result.message || 'Connection failed');
                    notifyParent(false, undefined, result.error, result.message);
                    return;
                }

                if (result.requiresSelection && result.accounts) {
                    setStatus('selecting');
                    setAccounts(result.accounts);
                    setSelectionId(result.selectionId || null);
                    setMessage('Select an Instagram account to connect');
                    return;
                }

                if (result.account) {
                    setStatus('success');
                    setUsername(result.account.username);
                    setMessage(`Successfully linked to @${result.account.username}!`);
                    notifyParent(true, result.account.username);
                    return;
                }
            } catch (err) {
                console.error('Callback error:', err);
                setStatus('error');
                setErrorType('API_ERROR');
                setMessage('Failed to process authorization');
                notifyParent(false, undefined, 'API_ERROR', 'Failed to process authorization');
            }
        } else {
            // No valid params
            setStatus('error');
            setErrorType('INVALID_STATE');
            setMessage('Invalid callback URL');
            notifyParent(false, undefined, 'INVALID_STATE', 'Invalid callback URL');
        }
    };

    const loadPendingAccounts = async (sid: string) => {
        try {
            const accountList = await instagramAPI.getPendingAccounts(sid);
            setStatus('selecting');
            setAccounts(accountList);
            setMessage('Select an Instagram account to connect');
        } catch (err) {
            setStatus('error');
            setErrorType('API_ERROR');
            setMessage('Failed to load accounts');
        }
    };

    const handleSelectAccount = async (account: InstagramAccount) => {
        if (!selectionId) return;

        setStatus('loading');
        setMessage('Connecting account...');

        try {
            // Note: restaurantId is stored in the backend pending session, so we pass empty string
            // The backend will use the stored restaurantId from the OAuth flow
            const result = await instagramAPI.selectAccount(selectionId, account.id, '');
            setStatus('success');
            setUsername(result.username);
            setMessage(result.message);
            notifyParent(true, result.username);
        } catch (err) {
            setStatus('error');
            setErrorType('API_ERROR');
            setMessage('Failed to connect account');
            notifyParent(false, undefined, 'API_ERROR', 'Failed to connect account');
        }
    };

    const notifyParent = (success: boolean, username?: string, error?: InstagramConnectionError, errorMessage?: string) => {
        // For popup flow - send message to opener
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({
                type: 'instagram-oauth-callback',
                success,
                username,
                error,
                errorMessage
            }, window.location.origin);

            // Auto-close popup on success after short delay
            if (success) {
                setTimeout(() => window.close(), 2000);
            }
        }

        // Call props callbacks
        if (success && onComplete) {
            onComplete(true, username);
        } else if (!success && onError && error) {
            onError(error, errorMessage || 'Unknown error');
        }
    };

    const handleClose = () => {
        if (window.opener && !window.opener.closed) {
            window.close();
        }
    };

    const handleRetry = () => {
        // Notify parent to retry
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({
                type: 'instagram-oauth-retry'
            }, window.location.origin);
            window.close();
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
                {/* Header */}
                <div className="flex items-center justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-2xl flex items-center justify-center">
                        <InstagramIcon size={32} className="text-white" />
                    </div>
                </div>

                {/* Loading State */}
                {status === 'loading' && (
                    <div className="text-center">
                        <Loader2 className="w-12 h-12 text-pink-500 animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">{message}</p>
                    </div>
                )}

                {/* Success State */}
                {status === 'success' && (
                    <div className="text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 className="w-10 h-10 text-green-600" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 mb-2">Connected!</h2>
                        <p className="text-slate-600 mb-6">{message}</p>
                        <button
                            onClick={handleClose}
                            className="px-6 py-2 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
                        >
                            Close Window
                        </button>
                    </div>
                )}

                {/* Error State */}
                {status === 'error' && errorType && (
                    <div className="text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <XCircle className="w-10 h-10 text-red-600" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 mb-2">
                            {ERROR_MESSAGES[errorType]?.title || 'Connection Failed'}
                        </h2>
                        <p className="text-slate-600 mb-6">
                            {ERROR_MESSAGES[errorType]?.description || message}
                        </p>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={handleRetry}
                                className="px-6 py-2 bg-pink-600 text-white rounded-xl font-medium hover:bg-pink-700 transition-colors"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={handleClose}
                                className="px-6 py-2 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {/* Account Selection State */}
                {status === 'selecting' && (
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 mb-2 text-center">Select Account</h2>
                        <p className="text-slate-500 text-sm text-center mb-6">{message}</p>
                        <div className="space-y-3">
                            {accounts.map((account) => (
                                <button
                                    key={account.id}
                                    onClick={() => handleSelectAccount(account)}
                                    className="w-full p-4 border border-slate-200 rounded-xl hover:border-pink-300 hover:bg-pink-50 transition-all flex items-center gap-4"
                                >
                                    {account.profilePictureUrl ? (
                                        <img
                                            src={account.profilePictureUrl}
                                            alt={account.username}
                                            className="w-12 h-12 rounded-full"
                                        />
                                    ) : (
                                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                                            <InstagramIcon size={20} className="text-white" />
                                        </div>
                                    )}
                                    <div className="flex-1 text-left">
                                        <p className="font-bold text-slate-800">@{account.username}</p>
                                        <p className="text-xs text-slate-500">via {account.pageName}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default InstagramCallback;
