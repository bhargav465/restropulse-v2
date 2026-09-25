import React, { useEffect, useRef, useState } from 'react';
import { ScoreDial } from './intelligence/sections/primitives';
import { getApiUrl } from './../utils/env';
import { track } from './intelligence/sections/track';

/**
 * Public restaurant grader — the lead-generation page (?view=grader).
 * No login. Flow: name + city → staged scan animation → score + teaser report
 * with the competition sections blurred → unlock with a promo code, which is
 * where the lead (phone, name) is captured.
 *
 * The scan is Places-only server-side (no Claude) so an anonymous visit costs
 * paise, not rupees; the full Intelligence product is the upsell.
 */

interface GraderCandidate { placeId: string; name: string; address: string; rating: number; totalRatings: number; photoName?: string; lat?: number; lng?: number }
interface GraderProblem { label: string; note: string; pillar: string; grade: string }
interface GraderRankRow { name: string; rating: number; reviews: number; position: number; isYou: boolean; beatsYou: string[] }
interface GraderPillarCheck { id: string; label: string; pass: boolean; note: string }
interface GraderPillar { key: string; score: number; grade: string; checks: GraderPillarCheck[] }
interface GraderSearchRow { query: string; topResult: string; yourPosition: number | null }
interface GraderResult {
    scanId: string; name: string; address: string; city: string;
    score: number; gradeLabel: string; rating: number; reviews: number; photos: number;
    photoName?: string | null;
    location?: { lat: number; lng: number } | null;
    problems: GraderProblem[];
    pillars: GraderPillar[];
    rank: number; totalNearby: number; areaAvgRating: number; reviewPercentile: number;
    closestRival: { name: string; distanceKm: number; rating: number } | null;
    likelyNew: Array<{ name: string; reviews: number; rating: number; distanceKm: number }>;
    rankedBelow: number; leaderboard: GraderRankRow[];
    searches: GraderSearchRow[]; estMonthlyLossInr: number; unlocked: boolean;
}

const STAGES = [
    'Finding your restaurant on Google',
    'Scanning nearby competitors',
    'Reading your Google business profile',
    'Checking photos and reviews',
    'Testing your website',
    'Scoring your online presence',
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PILLAR_LABELS: Record<string, string> = {
    profile: 'Google Business Profile',
    reviews: 'Reviews & replies',
    photos: 'Photos',
    website: 'Website & SEO',
    competition: 'Competition',
    momentum: 'Momentum',
};
const GRADE_COLOR: Record<string, string> = { A: '#16a34a', B: '#65a30d', C: '#d97706', D: '#ea580c', F: '#dc2626' };
const photoUrl = (ref: string) => `${getApiUrl()}/grader/photo?ref=${encodeURIComponent(ref)}`;
const mapUrl = (lat: number, lng: number) => `${getApiUrl()}/grader/staticmap?lat=${lat}&lng=${lng}`;
/**
 * Keyless map: OpenStreetMap tiles composed directly (no iframe, no API key),
 * with a pin at the restaurant — the location renders even while the Google
 * key has no Static Maps access.
 */
const TileMap: React.FC<{ lat: number; lng: number; zoom?: number }> = ({ lat, lng, zoom = 16 }) => {
    const worldPx = 256 * Math.pow(2, zoom);
    const px = ((lng + 180) / 360) * worldPx;
    const latRad = (lat * Math.PI) / 180;
    const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldPx;
    const TX = 6;
    const TY = 4;
    const originX = Math.floor(px / 256) - Math.floor(TX / 2);
    const originY = Math.floor(py / 256) - Math.floor(TY / 2);
    const offsetX = px - originX * 256;
    const offsetY = py - originY * 256;
    return (
        <div className="relative w-full h-full overflow-hidden bg-canvas">
            <div className="absolute" style={{ width: TX * 256, height: TY * 256, left: `calc(50% - ${offsetX}px)`, top: `calc(50% - ${offsetY}px)` }}>
                {Array.from({ length: TX * TY }, (_, i) => {
                    const tx = i % TX;
                    const ty = Math.floor(i / TX);
                    return (
                        <img key={i} alt="" loading="eager"
                            src={`https://tile.openstreetmap.org/${zoom}/${originX + tx}/${originY + ty}.png`}
                            className="absolute" style={{ left: tx * 256, top: ty * 256, width: 256, height: 256 }} />
                    );
                })}
            </div>
            <span className="absolute text-4xl drop-shadow" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -92%)' }} aria-hidden="true">📍</span>
            <span className="absolute bottom-1 right-2 text-[9px] text-muted px-1 rounded" style={{ background: 'rgba(255,255,255,0.75)' }}>© OpenStreetMap</span>
        </div>
    );
};

/**
 * The scanning theatre — an owner.com-style mock browser window showing the
 * restaurant's Google listing being examined: stars fill to the real rating,
 * the review count counts up, photo tiles shimmer (or show the real photo/map
 * when the key allows), a scan beam sweeps, and a progress bar tracks stages.
 */
const ScanTheatre: React.FC<{
    name: string; address: string; rating: number; reviews: number;
    photoName?: string | null; lat?: number | null; lng?: number | null;
    stageIdx: number; total: number;
}> = ({ name, address, rating, reviews, photoName, lat, lng, stageIdx, total }) => {
    const [starPct, setStarPct] = useState(0);
    const [count, setCount] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setStarPct(Math.max(0, Math.min(100, (rating / 5) * 100))), 300);
        return () => clearTimeout(t);
    }, [rating]);
    useEffect(() => {
        if (reviews <= 0) return;
        const started = Date.now();
        const iv = setInterval(() => {
            const f = Math.min(1, (Date.now() - started) / 2000);
            setCount(Math.round(reviews * f));
            if (f >= 1) clearInterval(iv);
        }, 60);
        return () => clearInterval(iv);
    }, [reviews]);
    const pct = Math.min(96, Math.round(((stageIdx + 0.5) / total) * 100));
    const shimmer: React.CSSProperties = {
        background: 'linear-gradient(90deg, rgba(124,58,237,0.08) 25%, rgba(124,58,237,0.2) 50%, rgba(124,58,237,0.08) 75%)',
        backgroundSize: '400px 100%',
        animation: 'grader-shimmer 1.4s linear infinite',
    };
    return (
        <div className="mt-5 bg-surface rounded-2xl border border-line overflow-hidden shadow-xl" data-testid="scan-card">
            <style>{[
                '@keyframes grader-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }',
                '@keyframes grader-sweep2 { 0% { top: -15%; } 100% { top: 105%; } }',
                '@keyframes grader-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }',
                '@keyframes grader-ping2 { 0% { transform: scale(0.5); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }',
            ].join('\n')}</style>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-canvas">
                <span className="flex gap-1.5" aria-hidden="true">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f87171' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#fbbf24' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#34d399' }} />
                </span>
                <span className="flex-1 truncate rounded-full bg-surface border border-line px-3 py-1 text-[11px] text-muted">
                    google.com/search?q={encodeURIComponent(name)}
                </span>
            </div>
            <div className="relative p-4 overflow-hidden">
                <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
                        style={{ background: 'rgba(124,58,237,0.85)' }} aria-hidden="true">
                        {(name.trim().charAt(0) || '?').toUpperCase()}
                    </span>
                    <span className="min-w-0">
                        <span className="block font-semibold text-ink truncate">{name}</span>
                        <span className="block text-[11px] text-muted truncate">📍 {address}</span>
                    </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-base">
                    <span className="relative inline-block leading-none" aria-hidden="true">
                        <span style={{ color: 'rgba(124,58,237,0.2)' }}>★★★★★</span>
                        <span className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap"
                            style={{ width: `${starPct}%`, color: '#f59e0b', transition: 'width 1.8s ease-out' }}>★★★★★</span>
                    </span>
                    {rating > 0 && <span className="text-sm text-ink font-semibold tabular-nums">{rating.toFixed(1)}</span>}
                    <span className="text-sm text-muted tabular-nums">
                        {reviews > 0 ? `${count.toLocaleString('en-IN')} reviews` : 'reading reviews…'}
                    </span>
                </div>
                <div className="mt-3 rounded-lg overflow-hidden border border-line shadow-inner relative bg-canvas" style={{ height: 'min(56vh, 620px)', minHeight: '20rem' }}>
                    {/* Scene 1-2: locate on the map, then rivals pulse around you */}
                    <div className="absolute inset-0" style={{ opacity: stageIdx <= 1 ? 1 : 0, transition: 'opacity 0.7s ease', pointerEvents: 'none' }}>
                        {lat != null && lng != null
                            ? <TileMap lat={lat} lng={lng} zoom={16} />
                            : <ScanHero name={name} photoName={photoName} heightClass="h-full" />}
                        {stageIdx >= 1 && [[16, 26], [72, 20], [38, 68], [82, 58], [22, 52], [58, 38], [68, 76]].map(([x, y], i) => (
                            <span key={i} className="absolute w-3 h-3 rounded-full"
                                style={{ left: `${x}%`, top: `${y}%`, background: 'rgba(220,38,38,0.9)', boxShadow: '0 0 0 3px rgba(220,38,38,0.2)', animation: `grader-ping2 1.6s ease-out ${i * 0.22}s infinite` }}
                                aria-hidden="true" />
                        ))}
                        <span className="absolute top-2 left-2 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface border border-line text-ink shadow-sm">
                            {stageIdx >= 1 ? '🏪 Scanning restaurants within 7 km' : '📍 Locating your restaurant'}
                        </span>
                    </div>
                    {/* Scene 3: Google Business Profile fields being checked */}
                    <div className="absolute inset-0 p-6 bg-surface" style={{ opacity: stageIdx === 2 ? 1 : 0, transition: 'opacity 0.7s ease', pointerEvents: 'none' }}>
                        <p className="text-sm font-bold text-ink mb-2">Google Business Profile</p>
                        {['Business hours', 'Phone number', 'Website link', 'Description', 'Owner replies to reviews', 'Business status'].map((f, i) => (
                            <div key={f} className="flex items-center justify-between py-2.5 border-b border-line last:border-b-0 text-sm">
                                <span className="text-ink">{f}</span>
                                <span className="w-4 h-4 rounded-full border-2 border-primary animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} aria-hidden="true" />
                            </div>
                        ))}
                    </div>
                    {/* Scene 4: photos + reviews under the scanner */}
                    <div className="absolute inset-0 p-6 bg-surface" style={{ opacity: stageIdx === 3 ? 1 : 0, transition: 'opacity 0.7s ease', pointerEvents: 'none' }}>
                        <p className="text-sm font-bold text-ink mb-3">Photos & reviews</p>
                        <div className="grid grid-cols-3 gap-2">
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                                <span key={i} className="h-16 rounded-lg block" style={{ ...shimmer, animationDelay: `${i * 0.15}s` }} aria-hidden="true" />
                            ))}
                        </div>
                        <div className="mt-4 space-y-3">
                            {[0, 1].map((i) => (
                                <div key={i} className="flex items-start gap-3">
                                    <span className="w-8 h-8 rounded-full shrink-0" style={{ ...shimmer, animationDelay: `${i * 0.3}s` }} aria-hidden="true" />
                                    <div className="flex-1 space-y-1.5">
                                        <span className="text-xs" style={{ color: '#f59e0b' }} aria-hidden="true">★★★★★</span>
                                        <span className="block h-2.5 rounded w-full" style={{ ...shimmer, animationDelay: `${0.2 + i * 0.3}s` }} />
                                        <span className="block h-2.5 rounded w-2/3" style={{ ...shimmer, animationDelay: `${0.4 + i * 0.3}s` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    {/* Scene 5: website being tested */}
                    <div className="absolute inset-0 p-6 bg-surface" style={{ opacity: stageIdx === 4 ? 1 : 0, transition: 'opacity 0.7s ease', pointerEvents: 'none' }}>
                        <p className="text-sm font-bold text-ink mb-3">Your website</p>
                        <div className="rounded-lg border border-line overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-canvas">
                                <span className="flex gap-1" aria-hidden="true">
                                    <span className="w-2 h-2 rounded-full" style={{ background: '#f87171' }} />
                                    <span className="w-2 h-2 rounded-full" style={{ background: '#fbbf24' }} />
                                    <span className="w-2 h-2 rounded-full" style={{ background: '#34d399' }} />
                                </span>
                                <span className="flex-1 h-4 rounded-full" style={shimmer} />
                            </div>
                            <div className="p-4 space-y-3">
                                <span className="block h-6 rounded w-2/3" style={shimmer} />
                                <span className="block h-24 rounded" style={{ ...shimmer, animationDelay: '0.2s' }} />
                                <div className="grid grid-cols-3 gap-2">
                                    <span className="h-8 rounded" style={{ ...shimmer, animationDelay: '0.3s' }} />
                                    <span className="h-8 rounded" style={{ ...shimmer, animationDelay: '0.45s' }} />
                                    <span className="h-8 rounded" style={{ ...shimmer, animationDelay: '0.6s' }} />
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-muted mt-3">Checking SEO title, description, headline and ordering links…</p>
                    </div>
                    {/* Scene 6: compiling the score */}
                    <div className="absolute inset-0 bg-surface flex flex-col items-center justify-center gap-4" style={{ opacity: stageIdx >= 5 ? 1 : 0, transition: 'opacity 0.7s ease', pointerEvents: 'none' }}>
                        <div className="w-36 h-36 rounded-full flex items-center justify-center" style={{ background: `conic-gradient(#7C3AED ${pct}%, rgba(124,58,237,0.12) 0)` }}>
                            <div className="w-28 h-28 rounded-full bg-surface flex items-center justify-center text-3xl font-bold text-ink tabular-nums">{pct}%</div>
                        </div>
                        <p className="text-sm text-muted">Scoring {name} against the restaurants around you…</p>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {[
                        address ? `📍 ${address.split(',')[0]}` : null,
                        rating > 0 ? `⭐ ${rating.toFixed(1)} on Google` : null,
                        reviews > 0 ? `💬 ${reviews.toLocaleString('en-IN')} reviews` : null,
                        '🏪 Checking nearby rivals',
                        '🌐 Testing the website',
                    ]
                        .filter((f): f is string => !!f)
                        .map((f, i) => (
                            <span key={f}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-line bg-canvas text-ink"
                                style={{ opacity: stageIdx > i ? 1 : 0.15, transform: stageIdx > i ? 'translateY(0)' : 'translateY(4px)', transition: 'all 0.5s ease' }}>
                                {f}
                            </span>
                        ))}
                </div>
                <div className="absolute left-0 right-0 h-14 pointer-events-none"
                    style={{ animation: 'grader-sweep2 2s linear infinite', background: 'linear-gradient(180deg, transparent, rgba(124,58,237,0.22), transparent)' }}
                    aria-hidden="true" />
            </div>
            <div className="px-4 pb-4">
                <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span style={{ animation: 'grader-blink 1.2s ease-in-out infinite' }}>{STAGES[Math.min(stageIdx, STAGES.length - 1)]}…</span>
                    <span className="tabular-nums font-semibold text-ink">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div className="h-full rounded-full bg-primary-strong" style={{ width: `${pct}%`, transition: 'width 0.8s ease' }} />
                </div>
            </div>
        </div>
    );
};

/**
 * The scan screen's hero: listing photo when Google gives us one, otherwise a
 * live map with a pin on the restaurant, otherwise designed placeholder art —
 * never a plain text card. The animated sweep sells "we are examining you".
 */
const ScanHero: React.FC<{ name: string; photoName?: string | null; lat?: number | null; lng?: number | null; sweep?: boolean; heightClass?: string }> = ({ name, photoName, lat, lng, sweep, heightClass = 'h-44' }) => {
    const [photoFailed, setPhotoFailed] = useState(false);
    const [mapFailed, setMapFailed] = useState(false);
    const src = photoName && !photoFailed
        ? photoUrl(photoName)
        : lat != null && lng != null && !mapFailed
            ? mapUrl(lat, lng)
            : null;
    const hasCoords = lat != null && lng != null;
    return (
        <div className={`relative ${heightClass} bg-canvas overflow-hidden`}>
            {src ? (
                <img src={src} alt={name} className="w-full h-full object-cover"
                    onError={() => { if (photoName && !photoFailed) setPhotoFailed(true); else setMapFailed(true); }} />
            ) : hasCoords ? (
                <TileMap lat={lat as number} lng={lng as number} />
            ) : (
                <div className="w-full h-full relative flex items-center justify-center overflow-hidden"
                    style={{
                        background:
                            'linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(135deg, rgba(124,58,237,0.14), rgba(124,58,237,0.02))',
                        backgroundSize: '24px 24px, 24px 24px, 100% 100%',
                    }}>
                    <style>{'@keyframes grader-ping { 0% { transform: scale(0.4); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }'}</style>
                    <span className="absolute rounded-full" style={{ width: '90px', height: '90px', border: '2px solid rgba(124,58,237,0.45)', animation: 'grader-ping 1.6s ease-out infinite' }} aria-hidden="true" />
                    <span className="absolute rounded-full" style={{ width: '90px', height: '90px', border: '2px solid rgba(124,58,237,0.3)', animation: 'grader-ping 1.6s ease-out 0.8s infinite' }} aria-hidden="true" />
                    <span className="relative text-4xl" aria-hidden="true">📍</span>
                    <span className="absolute bottom-2 left-0 right-0 text-center text-[11px] font-semibold" style={{ color: 'rgba(124,58,237,0.7)' }}>
                        Locating {name.trim() || 'your restaurant'} on Google…
                    </span>
                </div>
            )}
            {sweep && (
                <>
                    <style>{'@keyframes grader-sweep { 0% { top: -20%; } 100% { top: 110%; } }'}</style>
                    <div className="absolute left-0 right-0 h-12 pointer-events-none"
                        style={{ animation: 'grader-sweep 1.8s linear infinite', background: 'linear-gradient(180deg, transparent, rgba(124,58,237,0.28), transparent)' }}
                        aria-hidden="true" />
                </>
            )}
        </div>
    );
};

async function get<T>(path: string): Promise<{ ok: boolean; data?: T }> {
    try {
        const res = await fetch(`${getApiUrl()}${path}`);
        const json = (await res.json()) as { success: boolean; data?: T };
        return { ok: json.success, data: json.data };
    } catch {
        return { ok: false };
    }
}

async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
        const res = await fetch(`${getApiUrl()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = (await res.json()) as { success: boolean; data?: T; error?: string };
        return { ok: json.success, data: json.data, error: json.error };
    } catch {
        return { ok: false, error: 'Could not reach the scanner — check your connection and try again.' };
    }
}

const Blurrable: React.FC<{ locked: boolean; children: React.ReactNode }> = ({ locked, children }) => (
    <div className="relative">
        <div className={locked ? 'blur-sm select-none pointer-events-none' : ''} aria-hidden={locked}>{children}</div>
        {locked && <div className="absolute inset-0" data-testid="blur-lock" />}
    </div>
);

const Grader: React.FC = () => {
    const [step, setStep] = useState<'form' | 'scanning' | 'report'>('form');
    const [name, setName] = useState('');
    const [city, setCity] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<GraderCandidate[]>([]);
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [picked, setPicked] = useState<GraderCandidate | null>(null);
    const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suggestSeq = useRef(0);
    const [stageIdx, setStageIdx] = useState(0);
    const [result, setResult] = useState<GraderResult | null>(null);
    const [unlockOpen, setUnlockOpen] = useState(false);
    const [promo, setPromo] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [contactName, setContactName] = useState('');
    const [unlockBusy, setUnlockBusy] = useState(false);
    const [unlockError, setUnlockError] = useState<string | null>(null);
    const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => {
        if (stageTimer.current) clearInterval(stageTimer.current);
        if (suggestTimer.current) clearTimeout(suggestTimer.current);
    }, []);

    // Autocomplete: debounce the name, ask the public suggest endpoint, and let
    // the owner pick their exact listing (name + address) instead of guessing.
    const onNameChange = (v: string) => {
        setName(v);
        if (picked && v !== picked.name) setPicked(null);
        if (suggestTimer.current) clearTimeout(suggestTimer.current);
        const q = v.trim();
        if (q.length < 3) { setSuggestions([]); setSuggestOpen(false); return; }
        suggestTimer.current = setTimeout(() => {
            const seq = ++suggestSeq.current;
            void get<GraderCandidate[]>(
                `/grader/suggest?name=${encodeURIComponent(q)}${city.trim() ? `&city=${encodeURIComponent(city.trim())}` : ''}`,
            ).then((res) => {
                if (seq !== suggestSeq.current) return; // a newer keystroke owns the dropdown
                const list = res.ok && res.data ? res.data : [];
                setSuggestions(list);
                setSuggestOpen(list.length > 0);
            });
        }, 350);
    };

    const pick = (c: GraderCandidate) => {
        setPicked(c);
        setName(c.name);
        setSuggestions([]);
        setSuggestOpen(false);
        if (!city.trim() && c.address) {
            const parts = c.address.split(',').map((x) => x.trim()).filter(Boolean);
            if (parts.length > 0) setCity(parts[parts.length - 1]);
        }
    };

    const scan = async () => {
        if (!name.trim() || !city.trim()) { setError('Enter your restaurant name and city.'); return; }
        setError(null);
        setStep('scanning');
        setStageIdx(0);
        track.tabOpened({ bucket: 'GRADER', tab: 'SCAN' });
        // The staged checklist is theatre timed to the real request — it advances
        // while the scan runs and snaps to done when the response lands. Cached
        // scans return in under a second, so hold the scanning screen a few
        // seconds anyway: the owner should see their restaurant being examined.
        const started = Date.now();
        stageTimer.current = setInterval(() => setStageIdx((i) => Math.min(i + 1, STAGES.length - 1)), 1800);
        const res = await post<GraderResult>('/grader/scan', {
            name: name.trim(),
            city: city.trim(),
            placeId: picked?.placeId,
        });
        if (!res.ok || !res.data) {
            if (stageTimer.current) clearInterval(stageTimer.current);
            setStep('form');
            setError(res.error ?? 'The scan failed — try again.');
            return;
        }
        const hold = Math.max(600, 12000 - (Date.now() - started));
        setTimeout(() => {
            if (stageTimer.current) clearInterval(stageTimer.current);
            setStageIdx(STAGES.length);
            setResult(res.data ?? null);
            setTimeout(() => setStep('report'), 600);
        }, hold);
    };

    const unlock = async () => {
        if (!result) return;
        setUnlockBusy(true);
        setUnlockError(null);
        const res = await post<GraderResult>('/grader/unlock', {
            scanId: result.scanId,
            promoCode: promo,
            phone: phone || undefined,
            email: email || undefined,
            name: contactName || undefined,
        });
        setUnlockBusy(false);
        if (!res.ok || !res.data) { setUnlockError(res.error ?? 'Could not unlock.'); return; }
        track.tabOpened({ bucket: 'GRADER', tab: 'UNLOCKED' });
        setResult(res.data);
        setUnlockOpen(false);
    };

    return (
        <div className="min-h-screen bg-canvas" data-theme="orchid-admin">
            <header className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between border-b border-line bg-surface gap-3">
                <p className="font-bold text-ink text-sm sm:text-lg truncate">Restro<span className="text-primary-strong">Pulse</span> <span className="font-normal text-muted text-xs sm:text-sm ml-1">Grader</span></p>
                <a href="/" className="text-xs sm:text-sm font-semibold text-primary-strong hover:underline whitespace-nowrap">Get RestroPulse →</a>
            </header>

            <main className="max-w-5xl mx-auto px-4 py-10">
                {step === 'form' && (
                    <div className="max-w-xl mx-auto text-center px-4 sm:px-0">
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink leading-tight">How does your restaurant look on Google?</h1>
                        <p className="text-xs sm:text-sm text-muted mt-3 leading-relaxed">
                            Free scan: your rating, reviews, photos and website, scored against the restaurants around you — in under a minute.
                        </p>
                        <form
                            className="mt-8 grid gap-3 text-left"
                            onSubmit={(e) => { e.preventDefault(); void scan(); }}
                        >
                            <label className="text-xs font-semibold text-muted relative block">
                                Restaurant name
                                <input value={name} onChange={(e) => onNameChange(e.target.value)}
                                    onFocus={() => { if (suggestions.length > 0) setSuggestOpen(true); }}
                                    onBlur={() => setSuggestOpen(false)}
                                    placeholder="Start typing and pick yours from the list"
                                    autoComplete="off" role="combobox" aria-expanded={suggestOpen} aria-autocomplete="list"
                                    className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink" />
                                {suggestOpen && suggestions.length > 0 && (
                                    <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-line rounded-xl shadow-lg overflow-hidden overflow-y-auto max-h-80 z-20"
                                        role="listbox" data-testid="grader-suggestions">
                                        {suggestions.map((c) => (
                                            <button key={c.placeId} type="button" role="option" aria-selected={picked?.placeId === c.placeId}
                                                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                                                className="w-full text-left px-4 py-2.5 hover:bg-canvas border-b border-line last:border-b-0">
                                                <span className="block text-sm font-medium text-ink truncate">{c.name}</span>
                                                <span className="block text-xs text-muted mt-0.5 truncate">
                                                    {c.address}{c.rating > 0 ? ` · ★ ${c.rating.toFixed(1)} (${c.totalRatings.toLocaleString('en-IN')})` : ''}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {picked && (
                                    <span className="block mt-1 text-[11px] font-normal text-success" data-testid="picked-confirmation">
                                        ✓ {picked.name} · {picked.address}
                                    </span>
                                )}
                            </label>
                            <label className="text-xs font-semibold text-muted">
                                City or area
                                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Hyderabad"
                                    className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink" />
                            </label>
                            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                            <button type="submit" className="mt-2 rounded-xl bg-primary-strong text-white px-6 py-3.5 text-base font-semibold hover:opacity-90">
                                Scan my restaurant — free
                            </button>
                            <p className="text-[11px] text-muted text-center">No signup. Data comes from your public Google listing.</p>
                        </form>
                    </div>
                )}

                {step === 'scanning' && (
                    <div className="max-w-6xl mx-auto rounded-2xl sm:rounded-3xl px-4 py-6 sm:py-8 lg:px-12"
                        style={{ background: 'radial-gradient(90% 70% at 50% 0%, rgba(124,58,237,0.10), transparent)' }}
                        data-testid="grader-scanning">
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink text-center">Scanning {picked?.name ?? name}…</h2>
                        <p className="text-xs sm:text-sm text-muted text-center mt-2">Reading your public Google listing and the restaurants around you.</p>
                        {/* Compact horizontal stepper — the card below carries the detail */}
                        <div className="mt-5 flex items-center justify-center gap-2" aria-hidden="true">
                            {STAGES.map((s, i) => (
                                <span key={s} title={s} className="h-1.5 rounded-full transition-all duration-500"
                                    style={{ width: i === stageIdx ? '2.5rem' : '1.25rem', background: i <= stageIdx ? '#7C3AED' : 'rgba(124,58,237,0.18)' }} />
                            ))}
                        </div>
                        <div className="max-w-4xl mx-auto">
                            <ScanTheatre
                                name={picked?.name ?? name}
                                address={picked?.address || city}
                                rating={picked?.rating ?? 0}
                                reviews={picked?.totalRatings ?? 0}
                                photoName={picked?.photoName}
                                lat={picked?.lat}
                                lng={picked?.lng}
                                stageIdx={stageIdx}
                                total={STAGES.length}
                            />
                            <p className="text-xs text-muted text-center mt-3">Usually under a minute.</p>
                        </div>
                    </div>
                )}

                {step === 'report' && result && (
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 sm:gap-6 items-start px-4 sm:px-0">
                        {/* Score rail */}
                        <div className="bg-surface rounded-2xl border border-line p-4 sm:p-6 flex flex-col items-center gap-3 lg:sticky lg:top-6">
                            {(result.photoName || result.location) && (
                                <div className="w-full rounded-xl overflow-hidden -mt-1" style={{ height: '8rem' }}>
                                    <ScanHero name={result.name} photoName={result.photoName}
                                        lat={result.location?.lat} lng={result.location?.lng} />
                                </div>
                            )}
                            <ScoreDial score={result.score} grade={result.score >= 85 ? 'A' : result.score >= 70 ? 'B' : result.score >= 55 ? 'C' : result.score >= 40 ? 'D' : 'F'} label="Online score" />
                            <p className="text-sm text-muted">Online health: <span className="font-semibold text-ink">{result.gradeLabel}</span></p>
                            <div className="w-full border-t border-line pt-3 text-sm text-ink">
                                <p className="font-semibold truncate">{result.name}</p>
                                {result.address && <p className="text-xs text-muted mt-0.5 truncate">{result.address}</p>}
                                <p className="text-xs text-muted mt-0.5">★ {result.rating.toFixed(1)} · {result.reviews.toLocaleString('en-IN')} reviews · {result.photos.toLocaleString('en-IN')} photos</p>
                            </div>
                            {!result.unlocked && (
                                <button type="button" onClick={() => setUnlockOpen(true)}
                                    className="w-full rounded-xl bg-primary-strong text-white px-4 py-3 text-sm font-semibold hover:opacity-90" data-testid="unlock-cta">
                                    Unlock the full report
                                </button>
                            )}
                        </div>

                        <div className="space-y-4 sm:space-y-6">
                            {/* Loss headline */}
                            <div className="bg-surface rounded-2xl border border-line p-4 sm:p-6">
                                <h2 className="text-base sm:text-lg md:text-xl font-bold text-ink leading-snug">
                                    {result.problems.length > 0
                                        ? <>You could be missing <span className="text-danger">~{inr(result.estMonthlyLossInr)}/month</span> — we found {result.problems.length}{result.unlocked ? '' : '+'} problems</>
                                        : 'Your online presence looks strong'}
                                </h2>
                                <ul className="mt-4 space-y-2">
                                    {result.problems.map((p, i) => (
                                        <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                                            <span className="mt-1 text-danger" aria-hidden="true">▲</span>
                                            <span><span className="font-medium">{p.label}</span> <span className="text-muted">— {p.note}</span></span>
                                        </li>
                                    ))}
                                </ul>
                                {!result.unlocked && <p className="text-xs text-muted mt-3">Unlock to see every problem and how to fix each one.</p>}
                            </div>

                            {/* By the numbers — same tiles idea as the RestroPulse dashboard */}
                            <div className="bg-surface rounded-2xl border border-line p-4 sm:p-6">
                                <h3 className="text-sm sm:text-base font-semibold text-ink mb-4">By the numbers</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3" data-testid="grader-numbers">
                                    <div className="rounded-xl bg-canvas p-3 sm:p-4">
                                        <p className="text-lg sm:text-xl md:text-2xl font-bold text-ink tabular-nums">★ {result.rating.toFixed(1)}</p>
                                        <p className="text-[10px] sm:text-xs text-muted mt-1">
                                            Area average is ★ {result.areaAvgRating.toFixed(1)} — you're {result.rating >= result.areaAvgRating ? 'at or above it' : 'below it'}
                                        </p>
                                    </div>
                                    <div className="rounded-xl bg-canvas p-3 sm:p-4">
                                        <p className="text-lg sm:text-xl md:text-2xl font-bold text-ink tabular-nums">{result.reviews.toLocaleString('en-IN')}</p>
                                        <p className="text-[10px] sm:text-xs text-muted mt-1">Reviews — more than {result.reviewPercentile}% of nearby rivals</p>
                                    </div>
                                    <div className="rounded-xl bg-canvas p-3 sm:p-4">
                                        <p className="text-lg sm:text-xl md:text-2xl font-bold text-ink tabular-nums">#{result.rank} of {result.totalNearby}</p>
                                        <p className="text-[10px] sm:text-xs text-muted mt-1">Your standing among restaurants nearby</p>
                                    </div>
                                    <div className="rounded-xl bg-canvas p-3 sm:p-4">
                                        {result.closestRival ? (
                                            <>
                                                <p className="text-lg sm:text-xl md:text-2xl font-bold text-ink tabular-nums">{result.closestRival.distanceKm.toFixed(1)} km</p>
                                                <p className="text-[10px] sm:text-xs text-muted mt-1">To {result.closestRival.name} (★ {result.closestRival.rating.toFixed(1)}) — your closest rival</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-lg sm:text-xl md:text-2xl font-bold text-ink tabular-nums">{result.photos.toLocaleString('en-IN')}</p>
                                                <p className="text-[10px] sm:text-xs text-muted mt-1">Photos on your Google profile</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Score breakdown — the product's pillar scorecard */}
                            <div className="bg-surface rounded-2xl border border-line p-6">
                                <h3 className="text-base font-semibold text-ink mb-1">Where your score comes from</h3>
                                <p className="text-xs text-muted mb-4">Each area is graded the same way the full RestroPulse dashboard grades it.</p>
                                <div className="space-y-4" data-testid="grader-pillars">
                                    {(result.pillars ?? []).map((pl) => {
                                        const failed = pl.checks.filter((c) => !c.pass);
                                        return (
                                            <div key={pl.key}>
                                                <div className="flex items-center gap-3">
                                                    <span className="w-44 shrink-0 text-sm text-ink truncate">{PILLAR_LABELS[pl.key] ?? pl.key}</span>
                                                    <div className="flex-1 h-2 rounded-full bg-canvas overflow-hidden">
                                                        <div className="h-full rounded-full" style={{ width: `${Math.max(4, pl.score)}%`, background: GRADE_COLOR[pl.grade] ?? '#7C3AED' }} />
                                                    </div>
                                                    <span className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: GRADE_COLOR[pl.grade] ?? '#7C3AED' }}>{pl.grade}</span>
                                                </div>
                                                {result.unlocked && failed.length > 0 && (
                                                    <ul className="mt-2 ml-2 space-y-1">
                                                        {failed.map((c) => (
                                                            <li key={c.id} className="text-xs text-muted flex items-start gap-1.5">
                                                                <span className="text-danger mt-0.5" aria-hidden="true">▲</span>
                                                                <span><span className="font-medium text-ink">{c.label}</span> — {c.note}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {!result.unlocked && <p className="text-xs text-muted mt-4">Unlock to see every check behind each grade — and exactly what to fix first.</p>}
                            </div>

                            {/* Competition — blurred until unlock */}
                            <div className="bg-surface rounded-2xl border border-line p-6">
                                <h3 className="text-base font-semibold text-ink mb-3">You're ranking below {result.rankedBelow} competitor{result.rankedBelow === 1 ? '' : 's'}</h3>
                                <Blurrable locked={!result.unlocked}>
                                    <div data-testid="grader-leaderboard">
                                        {result.leaderboard.map((r) => (
                                            <div key={r.position} className={`py-2.5 border-b border-line last:border-b-0 ${r.isYou ? 'font-semibold text-primary-strong' : 'text-ink'}`}>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-sm truncate">{r.position}. {r.name}{r.isYou ? ' (you)' : ''}</span>
                                                    <span className="text-sm tabular-nums text-muted">★ {r.rating.toFixed(1)} · {r.reviews.toLocaleString('en-IN')}</span>
                                                </div>
                                                {(r.beatsYou ?? []).length > 0 && (
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        {(r.beatsYou ?? []).map((b) => (
                                                            <span key={b} className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-canvas border border-line text-muted">{b}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </Blurrable>
                            </div>

                            {/* Searches — first row visible, rest blurred */}
                            <div className="bg-surface rounded-2xl border border-line p-6">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                    <h3 className="text-base font-semibold text-ink">Where you show up when people search</h3>
                                    <span className="text-[11px] text-muted">Our estimate, not live Google</span>
                                </div>
                                <div className="space-y-2.5">
                                    {result.searches.map((s, i) => (
                                        <Blurrable key={s.query} locked={!result.unlocked && i > 0}>
                                            <div className="flex items-center justify-between gap-3 text-sm">
                                                <span className="text-ink">{s.query}</span>
                                                <span className="text-muted whitespace-nowrap">
                                                    #1: {s.topResult} · you: {s.yourPosition ? `#${s.yourPosition}` : 'outside top 10'}
                                                </span>
                                            </div>
                                        </Blurrable>
                                    ))}
                                </div>
                            </div>

                            {/* New openings near you — the freshest competitive intel */}
                            <div className="bg-surface rounded-2xl border border-line p-6">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                    <h3 className="text-base font-semibold text-ink">New restaurants near you</h3>
                                    <span className="text-[11px] text-muted">Low review counts usually mean a recent opening — our estimate</span>
                                </div>
                                {result.unlocked ? (
                                    (result.likelyNew ?? []).length > 0 ? (
                                        <div data-testid="grader-new-openings">
                                            {(result.likelyNew ?? []).map((n) => (
                                                <div key={n.name} className="flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-b-0">
                                                    <span className="text-sm text-ink truncate">{n.name}</span>
                                                    <span className="text-sm tabular-nums text-muted whitespace-nowrap">
                                                        {n.distanceKm.toFixed(1)} km · ★ {n.rating.toFixed(1)} · only {n.reviews.toLocaleString('en-IN')} review{n.reviews === 1 ? '' : 's'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted">No obviously new listings within 5 km right now — we'll keep watching in the full product.</p>
                                    )
                                ) : (
                                    <Blurrable locked>
                                        <div>
                                            {['A new listing 1.2 km away', 'A new listing 2.8 km away', 'A new listing 3.4 km away'].map((t) => (
                                                <div key={t} className="flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-b-0">
                                                    <span className="text-sm text-ink">{t}</span>
                                                    <span className="text-sm text-muted">★ •.• · •• reviews</span>
                                                </div>
                                            ))}
                                        </div>
                                    </Blurrable>
                                )}
                            </div>

                            <p className="text-xs text-muted">
                                Want this every week — plus guest sentiment, rival tracking and a plan to fix each problem? <a href="/" className="font-semibold text-primary-strong hover:underline">That's RestroPulse.</a>
                            </p>
                        </div>
                    </div>
                )}
            </main>

            {/* Unlock modal — the lead capture */}
            {unlockOpen && result && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Unlock your free report">
                    <div className="bg-surface rounded-2xl border border-line p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <h3 className="text-base sm:text-lg font-bold text-ink">Unlock your free report</h3>
                        <p className="text-xs sm:text-sm text-muted mt-1">See every problem, the full competitor ranking, and all searches.</p>
                        <div className="mt-4 grid gap-3">
                            <label className="text-xs font-semibold text-muted">
                                Promo code
                                <input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="From your RestroPulse contact"
                                    className="mt-1 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base text-ink uppercase" data-testid="promo-input" />
                            </label>
                            <label className="text-xs font-semibold text-muted">
                                Your name <span className="font-normal">(optional)</span>
                                <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                                    className="mt-1 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base text-ink" />
                            </label>
                            <label className="text-xs font-semibold text-muted">
                                Phone
                                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+91…"
                                    className="mt-1 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base text-ink" data-testid="lead-phone" />
                            </label>
                            <label className="text-xs font-semibold text-muted">
                                Email
                                <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="you@restaurant.com"
                                    className="mt-1 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base text-ink" data-testid="lead-email" />
                            </label>
                            <p className="text-[11px] text-muted -mt-1">Phone or email required — we'll send your full report there.</p>
                            <p className="text-[11px] text-muted">By unlocking, RestroPulse may contact you about this report.</p>
                            {unlockError && <p className="text-sm text-danger" role="alert">{unlockError}</p>}
                            <div className="flex items-center gap-3">
                                <button type="button" disabled={unlockBusy || !promo.trim() || (!phone.trim() && !email.trim())} onClick={() => void unlock()}
                                    className="flex-1 rounded-xl bg-primary-strong text-white px-4 py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                                    {unlockBusy ? 'Unlocking…' : 'Unlock'}
                                </button>
                                <button type="button" onClick={() => setUnlockOpen(false)} className="text-sm font-semibold text-muted hover:text-ink">Not now</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Grader;
