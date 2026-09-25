import { useEffect, useRef } from 'react';

/**
 * Makes a modal / bottom-sheet dismissable with the browser Back button (and the
 * hardware Back button on mobile web).
 *
 * While `isOpen` is true, a single history entry tagged
 * `{ level: 'modal', id }` (with a `#id` hash) sits on top of the stack. Pressing
 * Back pops that entry and invokes `onClose`. Closing the sheet through the UI
 * should flip `isOpen` to false, which consumes the entry via `history.back()` so
 * both close paths stay symmetric and the URL hash is cleaned up.
 *
 * The `level: 'modal'` tag is the shared history contract that keeps App's
 * top-level popstate handler from treating a sheet dismissal as a view change
 * (see apps/web/App.tsx). This hook is the single source of truth for that
 * pattern -- prefer it over hand-rolled pushState/popstate/history.back code.
 *
 * @param id      Stable identifier for this modal (used as the hash + state id).
 * @param isOpen  Whether the modal is currently open.
 * @param onClose Called when the entry is popped (Back). Must set isOpen to false.
 */
export function useHistoryModal(id: string, isOpen: boolean, onClose: () => void): void {
    // Tracks whether *this* hook instance currently owns a pushed history entry.
    const pushedRef = useRef(false);
    // Keep the latest onClose without re-subscribing the popstate listener.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Sync the history entry to the open state.
    useEffect(() => {
        if (isOpen && !pushedRef.current) {
            pushedRef.current = true;
            window.history.pushState({ level: 'modal', id }, '', `#${id}`);
        } else if (!isOpen && pushedRef.current) {
            pushedRef.current = false;
            const state = window.history.state as { level?: string; id?: string } | null;
            // Only pop if our entry is still on top; otherwise a Back press already
            // consumed it (handled by the popstate listener below).
            if (state?.level === 'modal' && state.id === id) {
                window.history.back();
            }
        }
    }, [isOpen, id]);

    // Close the modal when the user navigates back off our entry.
    useEffect(() => {
        const onPop = () => {
            if (!pushedRef.current) return;
            const state = window.history.state as { level?: string; id?: string } | null;
            if (!(state?.level === 'modal' && state.id === id)) {
                pushedRef.current = false;
                onCloseRef.current();
            }
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [id]);
}
