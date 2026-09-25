import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHistoryModal } from '../hooks/useHistoryModal';

describe('useHistoryModal', () => {
    beforeEach(() => {
        // Reset history state + hash between tests.
        window.history.replaceState(null, '', '/');
    });

    it('pushes a level:modal history entry (with hash) when opened', () => {
        renderHook(() => useHistoryModal('feedback', true, () => {}));
        expect(window.history.state).toEqual({ level: 'modal', id: 'feedback' });
        expect(window.location.hash).toBe('#feedback');
    });

    it('does not touch history when it starts closed', () => {
        renderHook(() => useHistoryModal('feedback', false, () => {}));
        expect(window.history.state).toBeNull();
        expect(window.location.hash).toBe('');
    });

    it('calls onClose when Back navigates off the modal entry', () => {
        const onClose = vi.fn();
        renderHook(() => useHistoryModal('feedback', true, onClose));

        // Simulate the browser popping our entry back to the underlying view.
        act(() => {
            window.history.replaceState({ level: 'view', view: 'STUDIO' }, '', '?view=studio');
            window.dispatchEvent(
                new PopStateEvent('popstate', { state: { level: 'view', view: 'STUDIO' } }),
            );
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose while our own modal entry is still on top', () => {
        const onClose = vi.fn();
        renderHook(() => useHistoryModal('feedback', true, onClose));

        act(() => {
            window.dispatchEvent(
                new PopStateEvent('popstate', { state: { level: 'modal', id: 'feedback' } }),
            );
        });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores pops for a different modal id', () => {
        const onClose = vi.fn();
        renderHook(() => useHistoryModal('feedback', true, onClose));

        act(() => {
            // A pop that lands on some OTHER modal entry should still close us,
            // since we are no longer on top.
            window.history.replaceState({ level: 'modal', id: 'other' }, '', '#other');
            window.dispatchEvent(
                new PopStateEvent('popstate', { state: { level: 'modal', id: 'other' } }),
            );
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
