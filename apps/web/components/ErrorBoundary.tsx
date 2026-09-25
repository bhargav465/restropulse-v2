import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportError } from '@restropulse/telemetry/browser';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        reportError(error, { componentStack: errorInfo.componentStack || '' });
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: undefined });
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                    <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-lg border border-slate-100">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                                <AlertTriangle size={32} className="text-red-600" />
                            </div>

                            <h2 className="text-2xl font-bold text-slate-800 mb-2">
                                Oops! Something went wrong
                            </h2>

                            <p className="text-slate-600 mb-6">
                                We encountered an unexpected error. Don't worry, your data is safe.
                            </p>

                            {this.state.error && (
                                <details className="w-full mb-6 text-left">
                                    <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-700 mb-2">
                                        Error details
                                    </summary>
                                    <pre className="text-xs bg-slate-100 p-3 rounded-lg overflow-auto max-h-32 text-slate-700">
                                        {this.state.error.message}
                                    </pre>
                                </details>
                            )}

                            <button
                                onClick={this.handleReset}
                                className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.97] shadow-lg"
                            >
                                <RefreshCw size={20} />
                                Try Again
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
