import type { IntelligenceReport, ReportDeltas } from '@restropulse/shared';

/**
 * Owner-facing vocabulary for Restaurant Intelligence — one place for the words
 * a restaurant owner sees, so the product speaks their language and not ours.
 *
 * Rule of thumb: an owner in Hyderabad with fifteen minutes should never have
 * to decode a term. "Threat", "AOV band", "provenance", "snapshot", "velocity",
 * "momentum" all failed that test; the replacements below are what they mean.
 * Internal names (types, API fields, metric keys) are unchanged — only the
 * strings on screen.
 */

/** Human city for the scan banner. `sourceCity` is an id like `city-hyderabad`. */
export function humanCity(raw: string | undefined | null): string {
    if (!raw) return '';
    const s = raw.trim();
    if (!s) return '';
    const deslugged = s.replace(/^city-/i, '').replace(/[-_]+/g, ' ').trim();
    if (!deslugged) return '';
    // Leave already-human strings alone (they contain uppercase or spaces).
    if (/[A-Z]/.test(s) || /\s/.test(s)) return s;
    return deslugged.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * "What changed since your last scan" — the sentence at the top of the report.
 * Built from the deltas the worker fills in against the previous report; on the
 * very first report there is nothing to compare, so we say so.
 */
export function whatChangedLine(report: IntelligenceReport): string | null {
    const d: ReportDeltas | undefined = report.deltas;
    if (!d) return null;
    const parts: string[] = [];

    if (d.restroScoreDelta > 0) parts.push(`your score is up ${d.restroScoreDelta} points`);
    else if (d.restroScoreDelta < 0) parts.push(`your score is down ${Math.abs(d.restroScoreDelta)} points`);
    else parts.push('your score held steady');

    if (d.ratingDelta > 0) parts.push(`your rating rose to ${report.base.rating.toFixed(1)}`);
    else if (d.ratingDelta < 0) parts.push(`your rating slipped to ${report.base.rating.toFixed(1)}`);

    if (d.reviewsDelta > 0) parts.push(`you gained ${d.reviewsDelta.toLocaleString('en-IN')} review${d.reviewsDelta === 1 ? '' : 's'}`);

    if (d.newCompetitors.length === 1) parts.push(`${d.newCompetitors[0]} opened nearby`);
    else if (d.newCompetitors.length > 1) parts.push(`${d.newCompetitors.length} new restaurants opened nearby`);

    const surge = d.competitorAlerts.find((a) => a.type === 'competitor_surge');
    if (surge?.competitorName) parts.push(`${surge.competitorName} is gaining reviews fast`);

    if (parts.length === 0) return null;
    const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `Since your last scan, ${sentence}.`;
}
