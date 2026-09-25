// @ts-nocheck -- Template file: copy into an app directory before use
/**
 * Component Test Template -- Frontend React Components
 *
 * This template demonstrates the standard pattern for testing React
 * components using Vitest and React Testing Library. It covers rendering,
 * user interaction, and async state changes.
 *
 * Usage:
 *   1. Copy this file to apps/web/tests/YourComponent.test.tsx
 *   2. Replace placeholders with actual component imports
 *   3. Run: npx vitest run tests/YourComponent.test.tsx
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
// import YourComponent from '../components/YourComponent';

// -- STEP 1: Mock API calls or external dependencies -------------------------

// vi.mock('../api', () => ({
//   fetchData: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }] }),
//   saveData: vi.fn().mockResolvedValue({ success: true }),
// }));

// -- STEP 2: Mock global browser APIs if needed ------------------------------

// const mockLocalStorage: Record<string, string> = {};
// vi.stubGlobal('localStorage', {
//   getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
//   setItem: vi.fn((key: string, val: string) => { mockLocalStorage[key] = val; }),
//   removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
// });

// -- STEP 3: Write component test suite --------------------------------------

describe('YourComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 3a. Rendering tests
  describe('Rendering', () => {
    it('should render with default props', () => {
      // render(<YourComponent />);
      // expect(screen.getByText('Expected Heading')).toBeInTheDocument();
      expect(true).toBe(true); // Placeholder
    });

    it('should render loading state', () => {
      // render(<YourComponent loading={true} />);
      // expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(true).toBe(true); // Placeholder
    });

    it('should render empty state when no data', () => {
      // render(<YourComponent data={[]} />);
      // expect(screen.getByText('No items found')).toBeInTheDocument();
      expect(true).toBe(true); // Placeholder
    });

    it('should render error state', () => {
      // render(<YourComponent error="Something went wrong" />);
      // expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(true).toBe(true); // Placeholder
    });
  });

  // 3b. User interaction tests
  describe('Interactions', () => {
    it('should call handler on button click', async () => {
      // const onAction = vi.fn();
      // render(<YourComponent onAction={onAction} />);
      //
      // fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      // await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
      expect(true).toBe(true); // Placeholder
    });

    it('should update input value on type', () => {
      // render(<YourComponent />);
      // const input = screen.getByPlaceholderText('Enter name');
      //
      // fireEvent.change(input, { target: { value: 'New Value' } });
      // expect(input).toHaveValue('New Value');
      expect(true).toBe(true); // Placeholder
    });

    it('should toggle visibility on click', () => {
      // render(<YourComponent />);
      //
      // expect(screen.queryByText('Hidden Content')).not.toBeInTheDocument();
      // fireEvent.click(screen.getByText('Show More'));
      // expect(screen.getByText('Hidden Content')).toBeInTheDocument();
      expect(true).toBe(true); // Placeholder
    });
  });

  // 3c. Async / API integration tests
  describe('Async Operations', () => {
    it('should fetch and display data on mount', async () => {
      // render(<YourComponent />);
      //
      // await waitFor(() => {
      //   expect(screen.getByText('Test')).toBeInTheDocument();
      // });
      expect(true).toBe(true); // Placeholder
    });

    it('should show error on API failure', async () => {
      // const { fetchData } = await import('../api');
      // (fetchData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      //
      // render(<YourComponent />);
      //
      // await waitFor(() => {
      //   expect(screen.getByText(/error/i)).toBeInTheDocument();
      // });
      expect(true).toBe(true); // Placeholder
    });
  });
});
