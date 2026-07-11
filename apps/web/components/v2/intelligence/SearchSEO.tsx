import React from 'react';
import type { IntelligenceReport, PillarScore } from '@restropulse/shared';
import { CheckRow, KeywordChips } from './primitives';
import { ProvenanceChip } from './provenance';
import { resolveActionHref, resolveDeepLink, type DeepLinkTarget } from './deep-links';

/**
 * Search & SEO sub-tab (DESIGN §4.4) — Google profile + website pass/fail
 * checklists (failing rows get a Fix deep link), simulated local-search
 * rankings labeled "Computed (simulation)", and keyword clusters where each
 * chip seeds a Content Engine draft.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
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
                            action={!chk.pass && target ? { label: target.cta, href: target.href, onClick: () => onNavigate(target) } : undefined}
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

    return (
        <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
                <ChecklistCard title="Google profile" pillar={profile} onNavigate={onNavigate} />
                <ChecklistCard title="Website & SEO" pillar={website} onNavigate={onNavigate} />
            </div>

            {/* Simulated search rankings */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">Local search rankings</h3>
                    <span title="These positions are simulated from ratings, review volume and distance — not live Google rankings.">
                        <ProvenanceChip provenance="computed" source="simulation" />
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
                                {s.inMapPack ? 'In the map pack' : 'Outside the map pack'}
                            </p>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Keyword clusters */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="text-base font-semibold text-ink">Keyword clusters</h3>
                    <ProvenanceChip provenance="ai-inferred" />
                </div>
                <div className="space-y-5">
                    <KeywordChips title="Primary" keywords={keywords.primary} onDraft={draft} />
                    <KeywordChips title="Long-tail" keywords={keywords.longTail} onDraft={draft} />
                    <KeywordChips title="Trending" keywords={keywords.trending} onDraft={draft} />
                    <KeywordChips title="Competitor" keywords={keywords.competitor} onDraft={draft} />
                    <KeywordChips title="Negative — monitor" keywords={keywords.negativeToMonitor} tone="negative" />
                </div>
            </Card>
        </div>
    );
};

export default SearchSEO;
