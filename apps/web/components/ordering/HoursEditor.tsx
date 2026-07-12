import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { StorefrontHoursEntry } from '@restropulse/shared';

/**
 * Controlled opening-hours editor (Brief 04). Extracted verbatim from
 * SiteContentEditor's "Opening hours" block so the two share a single source of
 * truth: both the v1 storefront-content editor AND the v2 Restaurant Details
 * "Hours" tab render this component. Hours live only in `storefront_content`
 * (never on the restaurant profile), so this stays a pure value/onChange widget
 * and the caller owns draft loading/saving/publishing.
 *
 * The classes below intentionally mirror SiteContentEditor's originals so its
 * rendering is byte-identical after the extraction.
 */

const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30';
const removeBtnCls = 'w-9 h-9 shrink-0 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100';
const addBtnCls = 'text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1';

const DEFAULT_HOURS_ENTRY: StorefrontHoursEntry = { day: 'Monday', open: '11:00', close: '23:00' };

interface HoursEditorProps {
    value: StorefrontHoursEntry[];
    onChange: (hours: StorefrontHoursEntry[]) => void;
}

const HoursEditor: React.FC<HoursEditorProps> = ({ value, onChange }) => {
    const hours = value ?? [];
    return (
        <>
            {hours.map((entry, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <input className={inputCls} aria-label={`Hours ${i + 1} day`} placeholder="Day" value={entry.day} onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, day: e.target.value } : h)))} />
                    <input className={`${inputCls} w-24 shrink-0`} aria-label={`Hours ${i + 1} open`} type="time" value={entry.open} onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, open: e.target.value } : h)))} />
                    <input className={`${inputCls} w-24 shrink-0`} aria-label={`Hours ${i + 1} close`} type="time" value={entry.close} onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, close: e.target.value } : h)))} />
                    <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                        <input type="checkbox" checked={entry.closed === true} onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, closed: e.target.checked } : h)))} className="w-3.5 h-3.5 accent-orange-600" />
                        Closed
                    </label>
                    <button type="button" className={removeBtnCls} aria-label={`Remove hours row ${i + 1}`} onClick={() => onChange(hours.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
            ))}
            <button type="button" className={addBtnCls} onClick={() => onChange([...hours, { ...DEFAULT_HOURS_ENTRY }])}><Plus size={14} /> Add day</button>
        </>
    );
};

export default HoursEditor;
