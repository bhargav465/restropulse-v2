import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConfirmDialog from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
    const defaultProps = {
        title: 'Confirm Delete',
        message: 'Are you sure you want to delete this item?',
        confirmLabel: 'Delete',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render title, message, and buttons', () => {
        render(<ConfirmDialog {...defaultProps} />);
        expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
        expect(screen.getByText('Are you sure you want to delete this item?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should call onConfirm when confirm button is clicked', () => {
        render(<ConfirmDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
    });

    it('should call onCancel when cancel button is clicked', () => {
        render(<ConfirmDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(defaultProps.onCancel).toHaveBeenCalledOnce();
    });

    it('should call onCancel when backdrop is clicked', () => {
        render(<ConfirmDialog {...defaultProps} />);
        const backdrop = document.querySelector('.absolute.inset-0') as HTMLElement;
        fireEvent.click(backdrop);
        expect(defaultProps.onCancel).toHaveBeenCalledOnce();
    });

    it('should call onCancel when Escape key is pressed', () => {
        render(<ConfirmDialog {...defaultProps} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(defaultProps.onCancel).toHaveBeenCalledOnce();
    });

    it('should NOT call onCancel for other key presses', () => {
        render(<ConfirmDialog {...defaultProps} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(defaultProps.onCancel).not.toHaveBeenCalled();
    });
});
