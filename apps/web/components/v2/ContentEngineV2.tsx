import React, { useEffect, useState } from 'react';
import { Restaurant, FeatureFlags, Post } from '@restropulse/shared';
import { postsAPI, restaurantAPI } from '../../api';
import ContentStudio from '../ContentStudio';
import Strategy from '../Strategy';
import Inputs from '../Inputs';
import { StatCard, ActionCard, SubNav, StepsBanner, SubNavTab, SamplePhoto } from './primitives';

type ContentTab = 'OVERVIEW' | 'STUDIO' | 'STRATEGY' | 'INPUTS';

interface ContentEngineV2Props {
    restaurantData: Restaurant;
    featureFlags?: FeatureFlags | null;
    metaConnected: boolean;
    instagramEnabled: boolean;
    facebookEnabled: boolean;
    onCreatePost?: () => void;
    onConnectInstagram: () => void;
    onRefreshRestaurant: () => void | Promise<void>;
    refreshKey: number;
}

const CONTENT_MIX_EMOJI: Record<string, string> = {
    IMAGE: '🖼️',
    REEL: '🎬',
    CAROUSEL: '🧩',
    STORY: '⏱️',
    VIDEO: '📹',
};

/** Post-status pill styling for the Recent posts gallery. */
const POST_STATUS: Record<string, { label: string; cls: string }> = {
    PENDING_APPROVAL: { label: 'Needs review', cls: 'bg-warning text-white' },
    CHANGES_REQUESTED: { label: 'Changes', cls: 'bg-danger text-white' },
    SCHEDULED: { label: 'Scheduled', cls: 'bg-info text-white' },
    PUBLISHED: { label: 'Published', cls: 'bg-success text-white' },
    POSTED: { label: 'Posted', cls: 'bg-success text-white' },
    GENERATING: { label: 'Generating', cls: 'bg-primary-soft text-primary-strong' },
    PENDING_MEDIA: { label: 'Rendering', cls: 'bg-primary-soft text-primary-strong' },
    DRAFT: { label: 'Draft', cls: 'bg-canvas text-muted border border-line' },
    FAILED: { label: 'Failed', cls: 'bg-danger text-white' },
};

/** Prettify any unmapped status (e.g. "PENDING_MEDIA" -> "Pending media"). */
const prettyStatus = (s: string): string => {
    const w = s.replace(/_/g, ' ').toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Overview panel — performance KPIs restyled from the v1 Dashboard data sources. */
const ContentOverview: React.FC<{ restaurantData: Restaurant; onNavigate: (tab: ContentTab) => void; showInputs: boolean }> = ({ restaurantData, onNavigate, showInputs }) => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [postsPerWeek, setPostsPerWeek] = useState<Array<{ week: number; posts: number }>>([]);
    const [contentMix, setContentMix] = useState<Array<{ type: string; count: number }>>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const postsData = await postsAPI.getAll();
                if (!cancelled) setPosts(postsData);
            } catch { /* empty for new restaurants */ }
            try {
                const analytics = await restaurantAPI.getAnalytics(restaurantData.id);
                if (!cancelled) {
                    setPostsPerWeek(analytics.postsPerWeek || []);
                    setContentMix(analytics.contentMix || []);
                }
            } catch { /* analytics may be empty */ }
        })();
        return () => { cancelled = true; };
    }, [restaurantData.id]);

    const pendingCount = posts.filter(p => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED').length;
    const scheduledCount = posts.filter(p => p.status === 'SCHEDULED').length;
    const thisWeek = postsPerWeek[0]?.posts ?? 0;
    const lastWeek = postsPerWeek[1]?.posts ?? 0;
    const weekDiff = thisWeek - lastWeek;
    const totalPublished = contentMix.reduce((sum, item) => sum + item.count, 0);
    const maxMix = Math.max(1, ...contentMix.map(m => m.count));

    return (
        <div className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    emoji="📅"
                    label="Posts this week"
                    value={thisWeek}
                    delta={weekDiff === 0 ? 'steady vs last week' : `${weekDiff > 0 ? '▲' : '▼'} ${Math.abs(weekDiff)} vs last week`}
                    deltaTone={weekDiff > 0 ? 'up' : weekDiff < 0 ? 'down' : 'neutral'}
                />
                <StatCard emoji="✅" label="Published · 30 days" value={totalPublished} delta="▲ 6% this month" />
                <StatCard
                    emoji="⏳"
                    label="Pending review"
                    value={pendingCount}
                    delta={pendingCount > 0 ? 'needs your review' : 'all clear'}
                    deltaTone={pendingCount > 0 ? 'down' : 'up'}
                />
                <StatCard emoji="🗓️" label="Scheduled" value={scheduledCount} delta="on autopilot" deltaTone="neutral" />
            </div>

            {/* Recent posts gallery */}
            {posts.length > 0 && (
                <div className="bg-surface rounded-2xl p-6 border border-line">
                    <div className="flex items-center justify-between gap-4 mb-4">
                        <h3 className="text-lg font-bold text-ink">Recent posts</h3>
                        <button
                            type="button"
                            onClick={() => onNavigate('STUDIO')}
                            className="text-sm font-semibold text-primary-strong hover:underline"
                        >
                            Open Studio →
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {posts.slice(0, 8).map((p) => {
                            const s = POST_STATUS[p.status] ?? { label: prettyStatus(p.status), cls: 'bg-primary-soft text-primary-strong' };
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => onNavigate('STUDIO')}
                                    className="group text-left rounded-xl overflow-hidden border border-line bg-canvas hover:shadow-md hover:-translate-y-0.5 transition-all"
                                >
                                    <div className="relative">
                                        <SamplePhoto
                                            src={p.thumbnail}
                                            alt={(p.caption || 'Post').replace('[SAMPLE] ', '').slice(0, 60)}
                                            emoji="📸"
                                            className="aspect-square w-full"
                                        />
                                        <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] font-bold ${s.cls}`}>
                                            {s.label}
                                        </span>
                                        {p.type !== 'IMAGE' && (
                                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[11px] font-bold bg-black/55 text-white">
                                                {CONTENT_MIX_EMOJI[p.type] || '📌'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-ink px-3 py-2.5 leading-snug line-clamp-2">
                                        {(p.caption || '').replace('[SAMPLE] ', '')}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* How it works */}
            <StepsBanner
                emoji="🚀"
                title="Your content engine, on autopilot"
                subtitle="RestroPulse turns kitchen updates into a steady social presence — here's the loop."
                steps={[
                    { title: 'Share inputs', text: 'Offers, specials and photos from your kitchen.' },
                    { title: 'We draft posts', text: 'On-brand captions and creatives, matched to your strategy.' },
                    { title: 'You approve', text: 'One tap to approve or request changes.' },
                    { title: 'Auto-publish', text: 'Posts go live at your best times, every week.' },
                ]}
            />

            {/* Content mix */}
            {contentMix.length > 0 && (
                <div className="bg-surface rounded-2xl p-6 border border-line">
                    <h3 className="text-base font-semibold text-ink mb-4">Content mix · last 30 days</h3>
                    <div className="space-y-3">
                        {contentMix.map((m) => (
                            <div key={m.type} className="flex items-center gap-3">
                                <span className="w-28 text-xs font-semibold text-muted flex items-center gap-1.5">
                                    <span aria-hidden="true">{CONTENT_MIX_EMOJI[m.type] || '📌'}</span>
                                    {m.type.charAt(0) + m.type.slice(1).toLowerCase()}
                                </span>
                                <div className="flex-1 h-2.5 bg-primary-soft rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${(m.count / maxMix) * 100}%` }} />
                                </div>
                                <span className="w-8 text-right text-sm font-semibold text-ink tabular-nums">{m.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Jump into the tools */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <ActionCard
                    emoji="✍️"
                    title="Content Studio"
                    description="Review drafts, approve posts and browse everything that's been published."
                    onClick={() => onNavigate('STUDIO')}
                />
                <ActionCard
                    emoji="🧭"
                    title="Strategy"
                    description="Set your posting cadence, focus categories and campaign themes."
                    onClick={() => onNavigate('STRATEGY')}
                />
                {showInputs && (
                    <ActionCard
                        emoji="📣"
                        title="Inputs"
                        description="Tell us what's cooking — offers and chef specials feed the engine."
                        onClick={() => onNavigate('INPUTS')}
                    />
                )}
            </div>
        </div>
    );
};

/**
 * Content Engine bucket — Overview + the existing Content Studio, Strategy and
 * Inputs views mounted unchanged inside the v2 frame.
 */
const ContentEngineV2: React.FC<ContentEngineV2Props> = ({
    restaurantData,
    featureFlags,
    metaConnected,
    instagramEnabled,
    facebookEnabled,
    onCreatePost,
    onConnectInstagram,
    onRefreshRestaurant,
    refreshKey,
}) => {
    const [tab, setTab] = useState<ContentTab>('OVERVIEW');
    const showInputs = featureFlags?.updatesSection !== false;
    const instagramConnected = instagramEnabled && metaConnected;

    const tabs: Array<SubNavTab<ContentTab>> = [
        { id: 'OVERVIEW', label: 'Overview', emoji: '🏠' },
        { id: 'STUDIO', label: 'Content Studio', emoji: '✍️' },
        { id: 'STRATEGY', label: 'Strategy', emoji: '🧭' },
        ...(showInputs ? [{ id: 'INPUTS' as const, label: 'Inputs', emoji: '📣' }] : []),
    ];

    return (
        <div>
            <SubNav tabs={tabs} active={tab} onChange={setTab} label="Content Engine sections" />
            {tab === 'OVERVIEW' && <ContentOverview restaurantData={restaurantData} onNavigate={setTab} showInputs={showInputs} />}
            {tab === 'STUDIO' && (
                <div className="max-w-3xl">
                    <ContentStudio
                        onCreatePost={metaConnected ? onCreatePost : undefined}
                        refreshKey={refreshKey}
                        instagramConnected={metaConnected}
                        onConnectInstagram={onConnectInstagram}
                        postApprovalBufferMins={featureFlags?.postApprovalBufferMins}
                        instagramEnabled={instagramEnabled}
                        facebookEnabled={facebookEnabled}
                    />
                </div>
            )}
            {tab === 'STRATEGY' && (
                <div className="max-w-3xl">
                    <Strategy
                        restaurantData={restaurantData}
                        instagramConnected={instagramConnected}
                        onConnectInstagram={onConnectInstagram}
                        cycleApprovalBufferMins={featureFlags?.cycleApprovalBufferMins}
                        instagramEnabled={instagramEnabled}
                    />
                </div>
            )}
            {tab === 'INPUTS' && showInputs && (
                <div className="max-w-3xl">
                    <Inputs restaurantData={restaurantData} onRefresh={onRefreshRestaurant} />
                </div>
            )}
        </div>
    );
};

export default ContentEngineV2;
