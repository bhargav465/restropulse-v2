import React from 'react';
import type { IntelligenceReport } from '@restropulse/shared';
import { PILLAR_LABELS } from './sections/primitives';
import { byTheNumbers } from './sections/Overview';
import { whatChangedLine } from './sections/copy';

/**
 * Print-only "full report" for Download PDF. Rendered by IntelligenceDashboard
 * only while the browser is printing (beforeprint -> afterprint), so it never
 * competes with the interactive UI on screen or in tests.
 *
 * Deliberately static: built purely from the already-loaded report. No fetching, no disclosures, no tab state -- so the PDF is the same
 * whichever tab was open, and nothing is hidden behind a collapsed section.
 */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="print-section">
        <h2 className="print-h2">{title}</h2>
        {children}
    </section>
);

const Para: React.FC<{ label?: string; text?: string }> = ({ label, text }) =>
    text ? (
        <p className="print-p">
            {label ? <strong>{label}: </strong> : null}
            {text}
        </p>
    ) : null;

const List: React.FC<{ items?: string[] }> = ({ items }) =>
    items && items.length > 0 ? (
        <ul className="print-list">
            {items.map((it, i) => (
                <li key={i}>{it}</li>
            ))}
        </ul>
    ) : null;

function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Filename-friendly document title, used for the saved PDF's default name. */
export function printDocumentTitle(report: IntelligenceReport): string {
    return `RestroPulse - ${report.base.name} - Intelligence Report - ${formatDate(report.generatedAt)}`;
}

const PrintReport: React.FC<{ report: IntelligenceReport }> = ({ report }) => {
    const { narrative } = report;
    const where = report.base.zone || report.base.city;
    const changed = whatChangedLine(report);

    return (
        <div className="print-only print-report" data-testid="print-report">
            <div className="print-header">
                <p className="print-kicker">RestroPulse - Restaurant Intelligence Report</p>
                <h1 className="print-h1">{report.base.name}</h1>
                <p className="print-p">
                    {where ? `${where} - ` : ''}Report generated {formatDate(report.generatedAt)}
                </p>
                <p className="print-score">
                    RestroScore <strong>{report.restroScore}</strong>/100
                    <span className="print-muted">
                        {' '}
                        - Rank #{report.ranking.rank} of {report.ranking.total} nearby
                    </span>
                </p>
                {changed ? <p className="print-p">{changed}</p> : null}
            </div>

            <Section title="Score breakdown">
                <div className="print-grid">
                    {report.pillars.map((p) => (
                        <div key={p.key} className="print-card">
                            <p className="print-card-title">
                                {PILLAR_LABELS[p.key]} - {p.score}/100 (grade {p.grade})
                            </p>
                            <ul className="print-list">
                                {p.checks.map((c) => (
                                    <li key={c.id}>
                                        <strong>{c.pass ? 'OK' : 'Fix'}</strong> - {c.label}
                                        {c.note ? <span className="print-muted"> ({c.note})</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="By the numbers">
                <div className="print-grid">
                    {byTheNumbers(report).map((s) => (
                        <div key={s.label} className="print-card">
                            <p className="print-muted">{s.label}</p>
                            <p className="print-card-title">{s.value}</p>
                            {s.note ? <p className="print-muted">{s.note}</p> : null}
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Summary">
                <Para text={narrative.overview} />
                <p className="print-label">Key findings</p>
                <List items={narrative.keyFindings} />
                <Para label="Immediate threats" text={narrative.immediateThreats} />
                <Para label="Growth opportunities" text={narrative.growthOpportunities} />
                <Para label="Next 90 days" text={narrative.verdict} />
            </Section>

            <Section title="Action plan">
                <ol className="print-list print-actions">
                    {narrative.actionPlan.map((a) => (
                        <li key={a.priority} className="print-card">
                            <p className="print-card-title">
                                {a.priority}. {a.action}
                            </p>
                            <p className="print-p">{a.detail}</p>
                            <p className="print-muted">
                                {a.impact} impact - {a.timeframe}
                            </p>
                        </li>
                    ))}
                </ol>
            </Section>

            <Section title="Nearby leaderboard">
                <table className="print-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Restaurant</th>
                            <th>Rating</th>
                            <th>Reviews</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report.ranking.leaderboard.map((e) => (
                            <tr key={`${e.rank}-${e.name}`} className={e.isBase ? 'print-strong' : undefined}>
                                <td>{e.rank}</td>
                                <td>
                                    {e.name}
                                    {e.isBase ? ' (you)' : ''}
                                </td>
                                <td>{e.rating.toFixed(1)}</td>
                                <td>{e.reviews.toLocaleString('en-IN')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Biggest rivals">
                {report.topCompetitors.map((c) => (
                    <div key={c.placeId} className="print-card">
                        <p className="print-card-title">
                            {c.name} - {c.rating.toFixed(1)} ({c.totalRatings.toLocaleString('en-IN')} reviews) - {c.distanceKm.toFixed(1)} km
                        </p>
                        <p className="print-muted">
                            {c.cuisine}
                            {c.sentimentLabel ? ` - ${c.sentimentLabel} sentiment` : ''}
                        </p>
                        {c.whatTheyDoBetter && c.whatTheyDoBetter.length > 0 ? (
                            <>
                                <p className="print-label">Where they beat you</p>
                                <List items={c.whatTheyDoBetter} />
                            </>
                        ) : null}
                        {c.whereYouWin && c.whereYouWin.length > 0 ? (
                            <>
                                <p className="print-label">Where you win</p>
                                <List items={c.whereYouWin} />
                            </>
                        ) : null}
                        <Para label="Pricing" text={c.pricingInsight} />
                        <Para label="Marketing" text={c.marketingEdge} />
                    </div>
                ))}
            </Section>

            {report.cuisineBreakdown.length > 0 ? (
                <Section title="Cuisines nearby">
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th>Cuisine</th>
                                <th>Restaurants</th>
                                <th>Avg rating</th>
                                <th>Share of reviews</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.cuisineBreakdown.map((b) => (
                                <tr key={b.cuisine}>
                                    <td>{b.cuisine}</td>
                                    <td>{b.count}</td>
                                    <td>{b.avgRating.toFixed(1)}</td>
                                    <td>{Math.round(b.reviewShare * 100)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Section>
            ) : null}

            <Section title="Search and keywords">
                {report.searchRankings.length > 0 ? (
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th>Search</th>
                                <th>Top result</th>
                                <th>Your position</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.searchRankings.map((s) => (
                                <tr key={s.query}>
                                    <td>{s.query}</td>
                                    <td>{s.topResult}</td>
                                    <td>
                                        {s.yourPosition ?? 'Not ranked'}
                                        {s.inMapPack ? ' (top 3)' : ''}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : null}
                <Para label="Main keywords" text={report.keywords.primary.join(', ')} />
                <Para label="Long-tail" text={report.keywords.longTail.join(', ')} />
                <Para label="Trending" text={report.keywords.trending.join(', ')} />
                <Para label="Watch out for" text={report.keywords.negativeToMonitor.join(', ')} />
            </Section>


            <footer className="print-muted print-footer">
                Generated by RestroPulse. Ratings, review counts and photos are measured from Google; keywords, rival analysis and the action plan are
                AI-inferred; search positions are simulated estimates.
            </footer>
        </div>
    );
};

export default PrintReport;
