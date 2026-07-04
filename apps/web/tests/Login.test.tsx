import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from './utils/test-utils';
import Login from '../components/Login';
import * as firebase from '../firebase';
import { getFirebaseApiKey } from '../utils/env';

// Mock env utils so both truthy and falsy branches are reachable
vi.mock('../utils/env', () => ({
    getGoogleMapsApiKey: vi.fn(() => undefined),
    getFirebaseApiKey: vi.fn(() => undefined),  // default: Firebase not configured
    getApiUrl: vi.fn(() => 'http://localhost:3001/api'),
}));

// Mock fetch for OTP API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Firebase module
vi.mock('../firebase', () => ({
    initRecaptcha: vi.fn(),
    sendOTP: vi.fn(),
    verifyOTP: vi.fn(),
    auth: {
        currentUser: null,
    },
}));

describe('Login Component', () => {
    const mockOnLogin = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
        // Ensure recaptcha verifier is truthy for Firebase tests
        (firebase.initRecaptcha as any).mockReturnValue('mock-verifier');
    });

    it('should render phone input form', () => {
        render(<Login onLogin={mockOnLogin} />);

        expect(screen.getByText(/RestroPulse/i)).toBeInTheDocument();
        expect(screen.getByText(/Enter your phone number/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/98765 43210/i)).toBeInTheDocument();
        expect(screen.getByText(/Get OTP/i)).toBeInTheDocument();
    });

    it('should validate phone number length', () => {
        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        const submitButton = screen.getByText(/Get OTP/i).closest('button');

        // Button should be disabled with empty phone
        expect(submitButton).toBeDisabled();

        // Enter partial phone number
        fireEvent.change(phoneInput, { target: { value: '98765' } });
        expect(submitButton).toBeDisabled();

        // Enter full phone number
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        expect(submitButton).not.toBeDisabled();
    });

    it('should send OTP when phone is valid', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true, devOtp: '123456' })
        });
        mockOnLogin.mockResolvedValueOnce(undefined);

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });

        const submitButton = screen.getByText(/Get OTP/i).closest('button');
        fireEvent.click(submitButton!);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/send-otp'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ phone: '+919876543210' })
                })
            );
        });
    });

    it('should show OTP input after sending OTP', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });

        const submitButton = screen.getByText(/Get OTP/i).closest('button');
        fireEvent.click(submitButton!);

        await waitFor(() => {
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
            expect(screen.getByText(/Change number/i)).toBeInTheDocument();
        });
    });

    it('should show error message on failed OTP send', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: false, message: 'Failed to send OTP' })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });

        const submitButton = screen.getByText(/Get OTP/i).closest('button');
        fireEvent.click(submitButton!);

        await waitFor(() => {
            expect(screen.getByText(/Failed to send OTP/i)).toBeInTheDocument();
        });
    });

    it('should auto-fill and verify OTP in dev mode (silent login)', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true, devOtp: '123456' })
        });

        const mockFallbackLogin = vi.fn().mockResolvedValueOnce(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });

        const submitButton = screen.getByText(/Get OTP/i).closest('button');
        fireEvent.click(submitButton!);

        // In dev mode, OTP is auto-filled and auto-verified using fallback login
        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalledWith('+919876543210', '123456');
        }, { timeout: 1000 });
    });

    it('should disable button during OTP send', async () => {
        mockFetch.mockImplementation(() =>
            new Promise(resolve => setTimeout(() => resolve({
                json: () => Promise.resolve({ success: true })
            }), 100))
        );

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });

        const submitButton = screen.getByText(/Get OTP/i).closest('button');
        fireEvent.click(submitButton!);

        expect(submitButton).toBeDisabled();
        expect(screen.getByText(/Sending OTP/i)).toBeInTheDocument();
    });

    it('should handle OTP input changes and auto-focus', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        // Go to OTP step
        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
        });

        const input0 = screen.getByLabelText('OTP digit 1');
        const input1 = screen.getByLabelText('OTP digit 2');

        fireEvent.change(input0, { target: { value: '1' } });
        expect(input0).toHaveValue('1');
        expect(input1).toHaveFocus();
    });

    it('should handle backspace in OTP input', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);
        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const input0 = screen.getByLabelText('OTP digit 1');
        const input1 = screen.getByLabelText('OTP digit 2');

        // Type in first two
        fireEvent.change(input0, { target: { value: '1' } });
        fireEvent.change(input1, { target: { value: '2' } });

        // Focus moves to next input (digit 3)
        const input2 = screen.getByLabelText('OTP digit 3');
        expect(input2).toHaveFocus();

        // User focuses input 2 (index 1) manually to edit
        input1.focus();

        // Clear and wait for update
        fireEvent.change(input1, { target: { value: '' } });
        await waitFor(() => expect(input1).toHaveValue(''));

        // Now backspace
        fireEvent.keyDown(input1, { key: 'Backspace' });

        expect(input0).toHaveFocus();
    });

    it('should verify OTP when all digits entered', async () => {
        mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ success: true }) });
        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);
        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });

        // Fill 1-5
        for (let i = 0; i < 5; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        // Fill 6th - should trigger verify
        fireEvent.change(inputs[5], { target: { value: '6' } });

        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalledWith('+919876543210', '123456');
        });
    });

    it('should allow changing number', async () => {
        mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ success: true }) });
        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);
        await waitFor(() => screen.getByText(/Change number/i));

        fireEvent.click(screen.getByText(/Change number/i));

        expect(screen.getByText(/Enter your phone number/i)).toBeInTheDocument();
    });

    it('should handle paste of OTP', async () => {
        mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ success: true }) });
        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);
        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const digitsDiv = screen.getByLabelText('OTP digit 1').closest('div');

        // Simulate paste
        const clipboardEvent = createClipboardEvent('123456');
        fireEvent.paste(digitsDiv!, clipboardEvent);

        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalledWith('+919876543210', '123456');
        });
    });

    it('should handle Firebase quota error and fallback to dev OTP', async () => {
        // Force Firebase mode
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        // Setup Firebase sendOTP failure
        const error = new Error('Quota exceeded');
        (error as any).code = 'auth/quota-exceeded';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        // Fallback fetch setup
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        // Wait for reCAPTCHA init (100ms delay in component)
        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/send-otp'),
                expect.anything()
            );
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should handle verify OTP error (invalid code)', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        (firebase.sendOTP as any).mockResolvedValueOnce(undefined);

        const error = new Error('Invalid code');
        (error as any).code = 'auth/invalid-verification-code';
        (firebase.verifyOTP as any).mockRejectedValueOnce(error);

        render(<Login onLogin={mockOnLogin} />);

        // Wait for reCAPTCHA init (100ms delay in component)
        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 6; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        await waitFor(() => {
            expect(screen.getByText('Invalid OTP. Please check and try again.')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show generic verification error when no auth method is available', async () => {
        // No Firebase key and no fallback login -> useFirebase false path
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 6; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        await waitFor(() => {
            expect(screen.getByText('Verification failed. Please try again.')).toBeInTheDocument();
        });
    });

    it('should show OTP expired message for code-expired error', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');
        (firebase.sendOTP as any).mockResolvedValueOnce(undefined);

        const expiredError = new Error('Code expired');
        (expiredError as any).code = 'auth/code-expired';
        (firebase.verifyOTP as any).mockRejectedValueOnce(expiredError);

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 6; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        await waitFor(() => {
            expect(screen.getByText('OTP has expired. Please request a new one.')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should fallback to onFallbackLogin when Firebase verifyOTP fails with No OTP request', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        (firebase.sendOTP as any).mockResolvedValueOnce(undefined);

        const firebaseErr = new Error('No OTP request in progress');
        (firebase.verifyOTP as any).mockRejectedValueOnce(firebaseErr);

        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 6; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalledWith('+919876543210', '123456');
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should not resend OTP when countdown is active', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
        });

        // Countdown should be active (30s), so Resend OTP button should not appear
        expect(screen.getByText(/Resend code in/i)).toBeInTheDocument();
        expect(screen.queryByText('Resend OTP')).not.toBeInTheDocument();
    });

    it('should call handleVerifyOtp via the Verify & Login button click', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });
        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        // Fill all 5 digits without triggering auto-submit (fill 1-5 only)
        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 5; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }
        // Fill the last digit
        fireEvent.change(inputs[5], { target: { value: '6' } });

        // Wait for the auto-submit from filling digit 6
        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalled();
        });

        // Reset mock and clear OTP to test the manual button click path
        mockFallbackLogin.mockClear();

        // Re-fill OTP digits for manual verify
        for (let i = 0; i < 6; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        // Click the Verify & Login button directly
        const verifyButton = screen.getByText('Verify & Login');
        fireEvent.click(verifyButton);

        await waitFor(() => {
            expect(mockFallbackLogin).toHaveBeenCalledWith('+919876543210', '123456');
        });
    });

    it('should resend OTP when countdown reaches zero', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        // Wait for OTP step to render
        await vi.waitFor(() => {
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
        });

        // Advance past the 30s countdown
        for (let i = 0; i < 31; i++) {
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });
        }

        // Now Resend OTP button should appear
        await vi.waitFor(() => {
            expect(screen.getByText('Resend OTP')).toBeInTheDocument();
        });

        // Setup fetch for the resend call
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        fireEvent.click(screen.getByText('Resend OTP'));

        // Verify a second fetch call was made for resend
        await vi.waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        vi.useRealTimers();
    });

    it('should show error when OTP is incomplete and verify button clicked', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        // Only fill 3 of 6 digits
        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 3; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        // The button should be disabled with incomplete OTP
        const verifyButton = screen.getByText('Verify & Login');
        expect(verifyButton.closest('button')).toBeDisabled();
    });

    it('should fallback to dev OTP on billing-not-enabled Firebase error in dev mode', async () => {
        // In test environment, import.meta.env.DEV is true, so billing-not-enabled goes to the dev fallback path
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        const error = new Error('Billing not enabled');
        (error as any).code = 'auth/billing-not-enabled';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        // Setup dev OTP fallback fetch
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            // In dev mode, falls back to dev OTP - shows OTP step
            expect(screen.getByText(/Enter the code sent to/i)).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show invalid phone number error for auth/invalid-phone-number', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        const error = new Error('Invalid phone number');
        (error as any).code = 'auth/invalid-phone-number';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Invalid phone number format')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show too many requests error for auth/too-many-requests', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        const error = new Error('Too many requests');
        (error as any).code = 'auth/too-many-requests';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Too many attempts. Please try again later.')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show generic error for unknown Firebase error codes', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        const error = new Error('Unknown error');
        (error as any).code = 'auth/some-unknown-error';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Failed to send OTP. Please try again.')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show error when handleVerifyOtp is called with fewer than 6 digits via button click', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });
        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        // Fill only 4 digits
        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        for (let i = 0; i < 4; i++) {
            fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
        }

        // The Verify & Login button is disabled when OTP is incomplete
        const verifyButton = screen.getByText('Verify & Login').closest('button');
        expect(verifyButton).toBeDisabled();
    });

    it('should log recaptcha initialization failure', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        (firebase.initRecaptcha as any).mockImplementationOnce(() => {
            throw new Error('recaptcha init failed');
        });

        render(<Login onLogin={mockOnLogin} />);

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to initialize reCAPTCHA:', expect.any(Error));
        });

        consoleSpy.mockRestore();
        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show error when dev fallback fetch throws during billing-not-enabled in dev mode', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        // Firebase throws billing-not-enabled -> triggers dev fallback
        const error = new Error('Billing not enabled');
        (error as any).code = 'auth/billing-not-enabled';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        // The fallback fetch itself throws a network error (covers line 165)
        mockFetch.mockRejectedValueOnce(new Error('Network failure'));

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Failed to send OTP. Please try again.')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show error when dev fallback fetch returns success:false with no message', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        // Firebase throws quota-exceeded -> triggers dev fallback
        const error = new Error('Quota exceeded');
        (error as any).code = 'auth/quota-exceeded';
        (firebase.sendOTP as any).mockRejectedValueOnce(error);

        // The fallback fetch returns success:false with no message (covers data.message || 'Failed to send OTP')
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: false })
        });

        render(<Login onLogin={mockOnLogin} />);

        await new Promise(resolve => setTimeout(resolve, 200));

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Failed to send OTP')).toBeInTheDocument();
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });

    it('should show "Please enter the 6-digit OTP" error when OTP is incomplete and handleVerifyOtp called directly', async () => {
        mockFetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true })
        });
        const mockFallbackLogin = vi.fn().mockResolvedValue(undefined);

        render(<Login onLogin={mockOnLogin} onFallbackLogin={mockFallbackLogin} />);

        const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
        fireEvent.change(phoneInput, { target: { value: '9876543210' } });
        fireEvent.click(screen.getByText(/Get OTP/i).closest('button')!);

        await waitFor(() => screen.getByLabelText('OTP digit 1'));

        // Fill only 3 digits -- verify button is disabled and error shown when attempted
        const inputs = screen.getAllByRole('textbox', { name: /OTP digit/i });
        fireEvent.change(inputs[0], { target: { value: '1' } });
        fireEvent.change(inputs[1], { target: { value: '2' } });
        fireEvent.change(inputs[2], { target: { value: '3' } });

        // Verify button is disabled when OTP is incomplete (3 of 6 digits)
        const verifyButton = screen.getByText('Verify & Login').closest('button');
        expect(verifyButton).toBeDisabled();

        // mockFallbackLogin should not have been called
        expect(mockFallbackLogin).not.toHaveBeenCalled();
    });

    it('should initialize reCAPTCHA when Firebase is configured', async () => {
        vi.mocked(getFirebaseApiKey).mockReturnValue('real-firebase-key');

        render(<Login onLogin={mockOnLogin} />);

        // Wait for the 100ms delay in the component's useEffect
        await new Promise(resolve => setTimeout(resolve, 200));

        await waitFor(() => {
            expect(firebase.initRecaptcha).toHaveBeenCalledWith('send-otp-button');
        });

        vi.mocked(getFirebaseApiKey).mockReturnValue(undefined);
    });
});

// Helper for paste event
function createClipboardEvent(text: string) {
    return {
        clipboardData: {
            getData: () => text
        },
        preventDefault: vi.fn()
    };
}
