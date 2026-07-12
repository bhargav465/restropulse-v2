import React, { useState } from 'react';
import type { IntelligenceReport, ActionPlanItem } from '@restropulse/shared';
import { resolveDeepLink, type DeepLinkTarget } from './deep-links';

/**
 * Overview sub-tab (DESIGN §4.1) — the money screen. Narrative + key findings,
 * the prioritized action plan with "Act on this →" deep links, immediate
 * threats vs growth opportunities, and the collapsible 90-day verdict.
 */

const IMPACT_CLASS: Record<ActionPlanItem['impact'], string> = {
    High: 'text-primary-strong',
    Medium: 'text-info',
    Low: 'text-muted',
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

const ActionPlanCard: React.FC<{ item: ActionPlanItem; onNavigate: (t: DeepLinkTarget) => void }> = ({ item, onNavigate }) => {
    const target = resolveDeepLink(item.deepLink);
    return (
        <div className="rounded-xl border border-line p-4 flex flex-col gap-2 bg-surface">
            <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary-strong text-white text-xs font-bold flex items-center justify-center">
                    {item.priority}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{item.action}</p>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{item.detail}</p>
                </div>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap pl-9">
                <div className="flex items-center gap-3 text-xs">
                    <span className={`font-semibold ${IMPACT_CLASS[item.impact]}`}>{item.impact} impact</span>
                    <span className="text-muted">{item.timeframe}</span>
                </div>
                <button
                    type="button"
                    onClick={() => onNavigate(target)}
                    title={target.href}
                    className="text-xs font-semibold text-primary-strong hover:underline whitespace-nowrap"
                >
                    {target.cta} →
                </button>
            </div>
        </div>
    );
};

const Overview: React.FC<{ report: IntelligenceReport; onNavigate: (t: DeepLinkTarget) => void }> = ({ report, onNavigate }) => {
    const { narrative } = report;
    const [verdictOpen, setVerdictOpen] = useState(false);

    return (
        <div className="space-y-6">
            {/* Narrative + key findings — one card, no bullets-of-bullets */}
            <Card>
                <h3 className="text-base font-semibold text-ink">The headline</h3>
                <p className="text-sm text-muted mt-2 leading-relaxed">{narrative.overview}</p>
                <div className="mt-4 border-t border-line pt-4">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Key findings</p>
                    <ul className="space-y-2">
                        {narrative.keyFindings.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
                                <span className="leading-relaxed">{f}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </Card>

            {/* Action plan — the loop Owner cannot close */}
            <Card>
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <h3 className="text-base font-semibold text-ink">Your action plan</h3>
                    <span className="text-xs text-muted">Prioritized · act inside RestroPulse</span>
                </div>
                <div className="grid gap-3">
                    {narrative.actionPlan.map((item) => (
                        <ActionPlanCard key={item.priority} item={item} onNavigate={onNavigate} />
                    ))}
                </div>
            </Card>

            {/* Threats vs opportunities */}
            <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-surface rounded-2xl p-6 border border-line border-l-[3px] border-l-danger">
                    <h3 className="text-sm font-semibold text-ink">Immediate threats</h3>
                    <p className="text-sm text-muted mt-2 leading-relaxed">{narrative.immediateThreats}</p>
                </div>
                <div className="bg-surface rounded-2xl p-6 border border-line border-l-[3px] border-l-success">
                    <h3 className="text-sm font-semibold text-ink">Growth opportunities</h3>
                    <p className="text-sm text-muted mt-2 leading-relaxed">{narrative.growthOpportunities}</p>
                </div>
            </div>

            {/* 90-day verdict — collapsible prose */}
            <Card>
                <button
                    type="button"
                    onClick={() => setVerdictOpen((v) => !v)}
                    aria-expanded={verdictOpen}
                    className="w-full flex items-center justify-between gap-3 text-left"
                >
                    <h3 className="text-base font-semibold text-ink">90-day verdict</h3>
                    <span className={`text-muted transition-transform ${verdictOpen ? 'rotate-180' : ''}`} aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </span>
                </button>
                {verdictOpen && <p className="text-sm text-muted mt-3 leading-relaxed">{narrative.verdict}</p>}
            </Card>
        </div>
    );
};

export default Overview;
