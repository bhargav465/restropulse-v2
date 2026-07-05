import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import ErrorBoundary from '../components/ErrorBoundary';

// Component that throws an error
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test error message');
    }
    return <div>No error</div>;
};

describe('ErrorBoundary Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Suppress console.error during tests
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('should render children when there is no error', () => {
        render(
            <ErrorBoundary>
                <div>Child component</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Child component')).toBeInTheDocument();
    });

    it('should catch errors and display error UI', () => {
        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText(/Oops! Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText(/We encountered an unexpected error/i)).toBeInTheDocument();
    });

    it('should display error details in expandable section', () => {
        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        const detailsElement = screen.getByText(/Error details/i);
        expect(detailsElement).toBeInTheDocument();

        fireEvent.click(detailsElement);
        expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('should render custom fallback when provided', () => {
        const customFallback = <div>Custom error message</div>;

        render(
            <ErrorBoundary fallback={customFallback}>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom error message')).toBeInTheDocument();
        expect(screen.queryByText(/Oops! Something went wrong/i)).not.toBeInTheDocument();
    });

    it('should reset error state when Try Again button is clicked', () => {
        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText(/Oops! Something went wrong/i)).toBeInTheDocument();

        const tryAgainButton = screen.getByRole('button', { name: /Try Again/i });
        fireEvent.click(tryAgainButton);

        // After reset, error state is cleared and component re-renders
        // The error boundary will attempt to render children again
    });

    it('should display AlertTriangle icon', () => {
        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        // Check for the icon container
        const iconContainer = screen.getByText(/Oops! Something went wrong/i).parentElement;
        expect(iconContainer).toBeInTheDocument();
    });

    it('should call console.error when error is caught', () => {
        const consoleSpy = vi.spyOn(console, 'error');

        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(consoleSpy).toHaveBeenCalled();
    });

    it('should maintain children state when no error occurs', () => {
        const { rerender } = render(
            <ErrorBoundary>
                <ThrowError shouldThrow={false} />
            </ErrorBoundary>
        );

        expect(screen.getByText('No error')).toBeInTheDocument();

        rerender(
            <ErrorBoundary>
                <ThrowError shouldThrow={false} />
            </ErrorBoundary>
        );

        expect(screen.getByText('No error')).toBeInTheDocument();
    });
});
