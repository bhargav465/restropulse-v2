import React, { useState } from 'react';
import { intelligenceAPI } from '../../../../api';

/**
 * ZomatoManualModal (Brief 09 §2) — Zomato has no public API, so merchants paste
 * their current Zomato numbers. Posts to /zomato-manual; on success the Zomato
 * series appears live (demo mutates the in-memory fixture). Tokens only.
 */
export const ZomatoManualModal: React.FC<{
    onClose: () => void;
    onSaved: () => void;
}> = ({ onClose, onSaved }) => {
    const [rating, setRating] = useState('');
    const [reviewCount, setReviewCount] = useState('');
    const [photoCount, setPhotoCount] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            await intelligenceAPI.postZomatoManual({
                rating: Number(rating),
                reviewCount: Number(reviewCount),
                photoCount: Number(photoCount),
            });
            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save your Zomato numbers.');
        } finally {
            setSaving(false);
        }
    };

    const field = 'w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40" role="dialog" aria-modal="true" aria-label="Add your Zomato numbers">
            <form onSubmit={submit} className="bg-surface rounded-2xl border border-line p-6 w-full max-w-sm space-y-4">
                <div>
                    <h3 className="text-base font-semibold text-ink">Add your Zomato numbers</h3>
                    <p className="text-xs text-muted mt-1">Zomato has no public API — paste your current numbers to track them alongside Google.</p>
                </div>
                <label className="block text-xs font-semibold text-muted">
                    Rating (0–5)
                    <input className={field + ' mt-1'} inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} required aria-label="Zomato rating" />
                </label>
                <label className="block text-xs font-semibold text-muted">
                    Review count
                    <input className={field + ' mt-1'} inputMode="numeric" value={reviewCount} onChange={(e) => setReviewCount(e.target.value)} required aria-label="Zomato review count" />
                </label>
                <label className="block text-xs font-semibold text-muted">
                    Photo count
                    <input className={field + ' mt-1'} inputMode="numeric" value={photoCount} onChange={(e) => setPhotoCount(e.target.value)} required aria-label="Zomato photo count" />
                </label>
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex items-center justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line text-muted hover:bg-canvas">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-strong text-white hover:opacity-90 disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save numbers'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ZomatoManualModal;
