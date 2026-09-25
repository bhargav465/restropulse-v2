import React, { useState } from 'react';
import type { IntelligenceReport, PillarScore } from '@restropulse/shared';
import { CheckRow, KeywordChips } from './primitives';
import { ProvenanceChip } from './provenance';
import { resolveActionHref, resolveDeepLink, SHOW_ACTION_CTAS, type DeepLinkTarget } from './deep-links';

/**
 * Search & SEO sub-tab (DESIGN §4.4) — Google profile + website pass/fail
 * checklists (failing rows get a Fix deep link), simulated local-search
 * rankings labeled "Computed (simulation)", and keyword clusters where each
 * chip seeds a Content Engine draft.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-4 sm:p-6 border border-line ${className}`}>{children}</div>
);

const ChecklistCard: React.FC<{ title: string; pillar?: PillarScore; onNavigate: (t: DeepLinkTarget) => void }> = ({ title, pillar, onNavigate }) => {
    if (!pillar) return null;
    return (
        <Card>
            <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-base font-semibold text-ink">{title}</h3>
                <ProvenanceChip provenance={pillar.provenance} source={pillar.provenance === 'measured' ? 'Google' : undefined} />
            </div>
            <div>
                {pillar.checks.map((chk) => {
                    const target = resolveActionHref(chk.actionHref);
                    return (
                        <CheckRow
                            key={chk.id}
                            label={chk.label}
                            pass={chk.pass}
                            note={chk.note}
                            action={SHOW_ACTION_CTAS && !chk.pass && target ? { label: target.cta, href: target.href, onClick: () => onNavigate(target) } : undefined}
                        />
                    );
                })}
            </div>
        </Card>
    );
};

const SearchSEO: React.FC<{ report: IntelligenceReport; onNavigate: (t: DeepLinkTarget) => void }> = ({ report, onNavigate }) => {
    const profile = report.pillars.find((p) => p.key === 'profile');
    const website = report.pillars.find((p) => p.key === 'website');
    const { keywords } = report;

    const draft = (keyword: string) => onNavigate(resolveDeepLink({ bucket: 'content', params: { keyword } }));

    // Rankings + keyword clusters are dense secondary detail. On mobile they sit
    // behind a "Show details" toggle; on sm+ they are always shown (the wrapper
    // drops the `hidden` once expanded, and `sm:block` keeps desktop unchanged).
    const [showDetail, setShowDetail] = useState(false);

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
                <ChecklistCard title="Google profile" pillar={profile} onNavigate={onNavigate} />
                <ChecklistCard title="Website & SEO" pillar={website} onNavigate={onNavigate} />
            </div>

            {/* Mobile-only toggle for the secondary detail below. */}
            <button
                type="button"
                onClick={() => setShowDetail((s) => !s)}
                className="sm:hidden w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-primary-strong"
                aria-expanded={showDetail}
            >
                {showDetail ? 'Hide search positions & keywords' : 'Show search positions & keywords'}
            </button>

            <div className={showDetail ? 'space-y-6' : 'space-y-6 hidden sm:block'}>
            {/* Simulated search rankings */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                        <h3 className="text-base font-semibold text-ink">Where you show up when people search</h3>
                        <p className="text-xs text-muted mt-0.5">Our estimate from ratings, review counts and distance — not live Google results.</p>
                    </div>
                    <span title="These positions are estimated from ratings, review volume and distance — not live Google rankings.">
                        <ProvenanceChip provenance="computed" source="estimate" />
                    </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    {report.searchRankings.map((s) => (
                        <div key={s.query} className="rounded-xl border border-line p-4">
                            <p className="text-sm font-medium text-ink leading-snug">{s.query}</p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                <span className="text-muted truncate">#1 {s.topResult}</span>
                                <span className={`font-semibold shrink-0 ${s.inMapPack ? 'text-success' : 'text-warning'}`}>
                                    {s.yourPosition ? `You: #${s.yourPosition}` : 'Unranked'}
                                </span>
                            </div>
                            <p className={`text-[11px] mt-1 font-semibold ${s.inMapPack ? 'text-success' : 'text-muted'}`}>
                                {s.inMapPack ? 'In the top 3 on the map' : 'Not in the top 3 on the map'}
                            </p>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Keyword clusters */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="text-base font-semibold text-ink">Words people search for</h3>
                    <ProvenanceChip provenance="ai-inferred" />
                </div>
                <div className="space-y-5">
                    <KeywordChips title="Most searched" keywords={keywords.primary} onDraft={draft} />
                    <KeywordChips title="Specific searches" keywords={keywords.longTail} onDraft={draft} />
                    <KeywordChips title="Trending now" keywords={keywords.trending} onDraft={draft} />
                    <KeywordChips title="Searches for your rivals" keywords={keywords.competitor} onDraft={draft} />
                    <KeywordChips title="Complaints to watch" keywords={keywords.negativeToMonitor} tone="negative" />
                </div>
            </Card>
            </div>
        </div>
    );
};

export default SearchSEO;
