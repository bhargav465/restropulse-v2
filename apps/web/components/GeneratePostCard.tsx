import React, { useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Post } from '@restropulse/shared';
import { postsAPI, GeneratePostTone } from '../api';

/**
 * "✨ Create a new post" generator card — rendered at the top of Content
 * Studio (shared by the v1 and v2 shells). The owner types a short brief,
 * optionally picks a tone, and gets a ready-to-review post back via
 * postsAPI.generatePost (demo mode simulates the generation locally;
 * the real server contract is documented in docs/NEXT.md §8).
 */

const TONES: Array<{ id: GeneratePostTone; label: string }> = [
    { id: 'fun', label: 'Fun' },
    { id: 'elegant', label: 'Elegant' },
    { id: 'spicy', label: 'Spicy 🌶️' },
];

interface GeneratePostCardProps {
    /** Called with the freshly generated post so the parent can add it to its list. */
    onGenerated: (post: Post) => void;
    onError?: (message: string) => void;
}

const GeneratePostCard: React.FC<GeneratePostCardProps> = ({ onGenerated, onError }) => {
    const [brief, setBrief] = useState('');
    const [tone, setTone] = useState<GeneratePostTone>('fun');
    const [generating, setGenerating] = useState(false);

    const canGenerate = brief.trim().length > 0 && !generating;

    const handleGenerate = async () => {
        if (!canGenerate) return;
        setGenerating(true);
        try {
            const post = await postsAPI.generatePost({ brief: brief.trim(), tone });
            setBrief('');
            onGenerated(post);
        } catch (err) {
            onError?.(err instanceof Error ? err.message : 'Failed to generate the post. Please try again.');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <section
            aria-labelledby="generate-post-heading"
            className="bg-white rounded-3xl border border-orange-100 shadow-sm p-5 mb-6 bg-gradient-to-br from-orange-50/60 to-white"
        >
            <h2 id="generate-post-heading" className="flex items-center gap-2 font-bold text-slate-800 text-sm mb-1">
                <Sparkles size={16} className="text-orange-500" aria-hidden="true" />
                ✨ Create a new post
            </h2>
            <p className="text-xs text-slate-500 mb-3">
                Tell us what's happening and we'll draft the caption and creative for your review.
            </p>

            <label htmlFor="generate-post-brief" className="sr-only">What's happening?</label>
            <textarea
                id="generate-post-brief"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                disabled={generating}
                placeholder="Tell us what's happening — e.g. 'Weekend special: our new tandoori platter at 20% off'"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-orange-500/40 focus:bg-white outline-none transition-all resize-none disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <label htmlFor="generate-post-tone" className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                        Tone
                    </label>
                    <select
                        id="generate-post-tone"
                        value={tone}
                        onChange={(e) => setTone(e.target.value as GeneratePostTone)}
                        disabled={generating}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-60"
                    >
                        {TONES.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                    </select>
                </div>

                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                        canGenerate
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20 hover:bg-orange-700 active:scale-[0.98]'
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                >
                    {generating ? (
                        <><RefreshCw size={15} className="animate-spin" aria-hidden="true" /> Generating…</>
                    ) : (
                        <><Sparkles size={15} aria-hidden="true" /> Generate</>
                    )}
                </button>
            </div>
        </section>
    );
};

export default GeneratePostCard;
