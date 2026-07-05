import React, { useState, useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
    Bangalore: { lat: 12.97, lng: 77.59 },
    Mumbai: { lat: 19.08, lng: 72.88 },
    Delhi: { lat: 28.61, lng: 77.21 },
    Chennai: { lat: 13.08, lng: 80.27 },
    Hyderabad: { lat: 17.39, lng: 78.49 },
    Pune: { lat: 18.52, lng: 73.86 },
    Kolkata: { lat: 22.57, lng: 88.36 },
};

interface Suggestion {
    placeId: string;
    description: string;
}

export interface PlacesAutocompleteInputProps {
    onSelect: (result: { address: string; lat: number; lng: number; city?: string }) => void;
    city?: string;
    cityNames?: string[];
    initialValue?: string;
    theme?: 'dark' | 'light';
    placeholder?: string;
}

export const PlacesAutocompleteInput: React.FC<PlacesAutocompleteInputProps> = ({
    onSelect,
    city,
    cityNames = [],
    initialValue,
    theme = 'dark',
    placeholder = 'Start typing your restaurant address...'
}) => {
    const places = useMapsLibrary('places');
    const [input, setInput] = useState(initialValue || '');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [confirmed, setConfirmed] = useState(!!initialValue);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (initialValue) {
            setInput(initialValue);
            setConfirmed(true);
        }
    }, [initialValue]);

    useEffect(() => {
        if (!places || !input.trim() || confirmed) {
            setSuggestions([]);
            return;
        }

        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(async () => {
            try {
                const request: Record<string, unknown> = {
                    input: input.trim(),
                    includedRegionCodes: ['in'],
                };

                if (city && CITY_COORDINATES[city]) {
                    const coords = CITY_COORDINATES[city];
                    request.locationBias = {
                        center: { lat: coords.lat, lng: coords.lng },
                        radius: 50000,
                    };
                }

                const { suggestions: results } =
                    await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request as unknown as google.maps.places.AutocompleteRequest);

                setSuggestions(
                    results
                        .filter((s) => s.placePrediction)
                        .map((s) => ({
                            placeId: s.placePrediction!.placeId,
                            description: s.placePrediction!.text.toString(),
                        })),
                );
            } catch {
                setSuggestions([]);
            }
        }, 300);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [input, places, confirmed, city]);

    const handleSelect = async (suggestion: Suggestion) => {
        setConfirmed(true);
        setSuggestions([]);

        try {
            const place = new google.maps.places.Place({ id: suggestion.placeId });
            await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });

            const resolvedAddress = place.formattedAddress || suggestion.description;
            setInput(resolvedAddress);

            const loc = place.location;
            if (!loc) {
                onSelect({ address: resolvedAddress, lat: 0, lng: 0 });
                return;
            }

            const placeLat = loc.lat();
            const placeLng = loc.lng();

            const cityComponent = place.addressComponents?.find((c) => c.types.includes('locality'));
            const cityText = cityComponent?.longText;
            const matchedCity = cityText
                ? cityNames.find((c) => c.toLowerCase() === cityText.toLowerCase())
                : undefined;

            onSelect({ address: resolvedAddress, lat: placeLat, lng: placeLng, city: matchedCity });
        } catch {
            setInput(suggestion.description);
            onSelect({ address: suggestion.description, lat: 0, lng: 0 });
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setConfirmed(false);
        setInput(e.target.value);
    };

    const isDark = theme === 'dark';

    const inputClasses = isDark
        ? `w-full bg-slate-800 text-white px-4 py-3.5 rounded-xl border focus:outline-none focus:ring-1 placeholder:text-slate-500 disabled:opacity-50 ${confirmed
            ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500'
            : 'border-slate-700 focus:border-orange-500 focus:ring-orange-500'
        }`
        : `w-full bg-slate-50 text-slate-900 px-4 py-3.5 rounded-xl border focus:outline-none focus:ring-1 placeholder:text-slate-400 disabled:opacity-50 ${confirmed
            ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500'
            : 'border-slate-200 focus:border-orange-500 focus:ring-orange-500'
        }`;

    const dropdownClasses = isDark
        ? 'absolute z-20 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto'
        : 'absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto';

    const itemClasses = isDark
        ? 'w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition-colors first:rounded-t-xl last:rounded-b-xl'
        : 'w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors first:rounded-t-xl last:rounded-b-xl';

    return (
        <div className="relative">
            <input
                type="text"
                value={input}
                onChange={handleInputChange}
                disabled={!places}
                placeholder={placeholder}
                className={inputClasses}
            />
            {suggestions.length > 0 && (
                <ul
                    className={dropdownClasses}
                    data-testid="suggestions-list"
                >
                    {suggestions.map(({ placeId, description }) => (
                        <li key={placeId}>
                            <button
                                type="button"
                                className={itemClasses}
                                onClick={() => handleSelect({ placeId, description })}
                            >
                                {description}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
