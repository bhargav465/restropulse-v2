import React from 'react';
import type { CompetitorProfile } from '@restropulse/shared';
import { TOKENS, SERIES } from '../theme';

/**
 * ThreatRadar — hand-rolled SVG polar plot (DESIGN §4.2). The predecessor's
 * `ThreatRadar.tsx` is not present in this repo, so this is a token-native
 * re-implementation per the brief: concentric rings + spokes in `border-line`,
 * the base restaurant as a `primaryStrong` star at the centre, and each
 * competitor as a `SERIES`-colored blip. Higher threat sits closer to the
 * centre (more dangerous = closer to you); bearing comes from the competitor's
 * lat/lng relative to the base. Blip size scales with threat.
 */

const AXIS = TOKENS.border;

export const ThreatRadar: React.FC<{
    base: { lat: number; lng: number; name: string };
    competitors: CompetitorProfile[];
    size?: number;
}> = ({ base, competitors, size = 300 }) => {
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 24;
    const rings = [0.33, 0.66, 1];

    const blips = competitors.slice(0, 8).map((c, i) => {
        const dLat = c.lat - base.lat;
        const dLng = c.lng - base.lng;
        // Bearing; fall back to an even fan when a competitor shares the base point.
        const bearing = dLat === 0 && dLng === 0 ? (i / Math.max(1, competitors.length)) * 2 * Math.PI : Math.atan2(dLng, dLat);
        const threat = Math.max(0, Math.min(100, c.threatScore));
        const radius = (1 - threat / 100) * maxR * 0.9 + maxR * 0.08; // high threat → near centre
        return {
            key: c.placeId,
            name: c.name,
            x: cx + radius * Math.sin(bearing),
            y: cy - radius * Math.cos(bearing),
            color: SERIES[i % SERIES.length],
            blipR: 4 + (threat / 100) * 6,
            threat,
        };
    });

    return (
        <svg width="100%" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Competitor threat radar" className="max-w-[340px]">
            {/* Rings */}
            {rings.map((f) => (
                <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke={AXIS} strokeWidth={1} />
            ))}
            {/* Spokes (N, E, S, W) */}
            {[0, 90, 180, 270].map((deg) => {
                const a = (deg * Math.PI) / 180;
                return (
                    <line
                        key={deg}
                        x1={cx}
                        y1={cy}
                        x2={cx + maxR * Math.sin(a)}
                        y2={cy - maxR * Math.cos(a)}
                        stroke={AXIS}
                        strokeWidth={1}
                    />
                );
            })}
            {/* Competitor blips */}
            {blips.map((b) => (
                <g key={b.key}>
                    <circle cx={b.x} cy={b.y} r={b.blipR} fill={b.color} fillOpacity={0.85}>
                        <title>{`${b.name} · threat ${b.threat}`}</title>
                    </circle>
                </g>
            ))}
            {/* Base restaurant star at centre */}
            <g>
                <circle cx={cx} cy={cy} r={7} fill={TOKENS.primaryStrong} />
                <circle cx={cx} cy={cy} r={12} fill="none" stroke={TOKENS.primaryStrong} strokeWidth={1.5} strokeOpacity={0.5} />
                <title>{base.name} (you)</title>
            </g>
        </svg>
    );
};
