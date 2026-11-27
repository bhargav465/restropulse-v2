import React, { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';

/**
 * DEMO ONLY: stands in for the Google Places address search when the demo
 * build has no Maps key, so a new sign-up still sees restaurant suggestions
 * to pick from as they type. Every suggestion is [SAMPLE] data built locally;
 * nothing is looked up or sent anywhere.
 */

const SAMPLE_AREAS: Record<string, string[]> = {
    kochi: ['MG Road', 'Panampilly Nagar', 'Kakkanad', 'Fort Kochi', 'Edappally'],
    bengaluru: ['Indiranagar', 'Koramangala', 'HSR Layout', 'Jayanagar', 'Whitefield'],
    bangalore: ['Indiranagar', 'Koramangala', 'HSR Layout', 'Jayanagar', 'Whitefield'],
    mumbai: ['Bandra West', 'Andheri East', 'Lower Parel', 'Powai', 'Colaba'],
    'new delhi': ['Connaught Place', 'Hauz Khas', 'Saket', 'Rajouri Garden', 'Karol Bagh'],
    delhi: ['Connaught Place', 'Hauz Khas', 'Saket', 'Rajouri Garden', 'Karol Bagh'],
    hyderabad: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Madhapur', 'Kondapur'],
    chennai: ['T Nagar', 'Adyar', 'Anna Nagar', 'Velachery', 'Nungambakkam'],
    pune: ['Koregaon Park', 'Baner', 'Kothrud', 'Viman Nagar', 'Aundh'],
};
const DEFAULT_AREAS = ['Main Road', 'Market Street', 'Station Road', 'Old Town', 'Ring Road'];

const SAMPLE_COORDS: Record<string, { lat: number; lng: number }> = {
    kochi: { lat: 9.97, lng: 76.28 },
    bengaluru: { lat: 12.97, lng: 77.59 },
    bangalore: { lat: 12.97, lng: 77.59 },
    mumbai: { lat: 19.08, lng: 72.88 },
    'new delhi': { lat: 28.61, lng: 77.21 },
    delhi: { lat: 28.61, lng: 77.21 },
    hyderabad: { lat: 17.39, lng: 78.49 },
    chennai: { lat: 13.08, lng: 80.27 },
    pune: { lat: 18.52, lng: 73.86 },
};

export interface DemoAddressInputProps {
    value: string;
    onChange: (value: string) => void;
    onSelect: (result: { address: string; lat: number; lng: number; city?: string }) => void;
    city?: string;
    restaurantName?: string;
}

export function buildDemoAddressSuggestions(input: string, city?: string, restaurantName?: string): string[] {
    const q = input.trim().toLowerCase();
    if (q.length < 2) return [];
    const cityName = (city ?? '').trim();
    const areas = SAMPLE_AREAS[cityName.toLowerCase()] ?? DEFAULT_AREAS;
    const name = (restaurantName ?? '').trim() || input.trim();
    const all = areas.map((area, i) => [name, `${12 + i * 7}, ${area}`, cityName].filter(Boolean).join(', '));
    const matching = all.filter((s) => s.toLowerCase().includes(q));
    // Typing a street or number that matches no sample area still shows the
    // typed text first, so there is always something to pick.
    return (matching.length > 0 ? matching : [[input.trim(), cityName].filter(Boolean).join(', '), ...all]).slice(0, 5);
}

export const DemoAddressInput: React.FC<DemoAddressInputProps> = ({ value, onChange, onSelect, city, restaurantName }) => {
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState(false);
    const suggestions = useMemo(() => buildDemoAddressSuggestions(value, city, restaurantName), [value, city, restaurantName]);

    const pick = (address: string) => {
        const c = SAMPLE_COORDS[(city ?? '').toLowerCase()];
        onSelect({ address, lat: c?.lat ?? 0, lng: c?.lng ?? 0, city: city || undefined });
        setPicked(true);
        setOpen(false);
    };

    return (
        <div className="relative">
            <input
                type="text"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setPicked(false);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder="Start typing your restaurant or its address"
                aria-label="Restaurant address"
                role="combobox"
                aria-expanded={open && suggestions.length > 0}
                aria-autocomplete="list"
                className={`w-full bg-white text-slate-900 px-4 py-3.5 rounded-xl border focus:outline-none focus:ring-1 placeholder:text-slate-400 text-base ${
                    picked ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500' : 'border-slate-200 focus:border-orange-500 focus:ring-orange-500'
                }`}
            />
            {open && !picked && suggestions.length > 0 && (
                <ul
                    role="listbox"
                    aria-label="Sample address suggestions"
                    data-testid="demo-suggestions-list"
                    className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto"
                >
                    {suggestions.map((s) => (
                        <li key={s} role="option" aria-selected={false}>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(s)}
                                className="w-full flex items-start gap-2 text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
                            >
                                <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                                <span>{s}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {picked ? (
                <p className="flex items-center gap-1.5 text-green-600 text-xs mt-2 font-medium">
                    <MapPin size={13} className="shrink-0" />
                    Sample location picked. Nothing is looked up or sent outside this browser.
                </p>
            ) : (
                <p className="text-slate-500 text-xs mt-2">
                    Demo preview: type a few letters and pick a sample address from the list.
                </p>
            )}
        </div>
    );
};
