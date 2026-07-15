import React from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import PlacePicker from './PlacePicker';
import {
    realPlacePickerEngine,
    demoPlacePickerEngine,
    type PlacePickerSelection,
} from './place-picker-engine';
import { isDemoMode } from '../../../lib/demo';
import { getGoogleMapsBrowserKey } from '../../../utils/env';

/**
 * PlacePickerHost (Brief 10) — wires the PlacePicker to the right engine:
 *  - demo mode → the [SAMPLE] fixture engine, no Maps loader, zero backend.
 *  - real mode → wraps the SAME `@vis.gl/react-google-maps` loader used by
 *    `PlacesAutocompleteInput`, keyed with the referrer-restricted BROWSER key
 *    (`VITE_GOOGLE_MAPS_BROWSER_KEY`), and gates the picker until `places` loads.
 *
 * If no browser key is configured in real mode, it falls back to `onCancel`'s
 * manual-entry path (rendered by the caller) so the flow never dead-ends.
 */

interface PlacePickerHostProps {
    onConfirm: (selection: PlacePickerSelection) => void;
    onCancel?: () => void;
    /** Rendered when a Maps key is missing in real mode (manual-entry fallback). */
    fallback?: React.ReactNode;
}

const RealPicker: React.FC<Omit<PlacePickerHostProps, 'fallback'>> = ({ onConfirm, onCancel }) => {
    const places = useMapsLibrary('places');
    return <PlacePicker engine={realPlacePickerEngine} onConfirm={onConfirm} onCancel={onCancel} disabled={!places} />;
};

const PlacePickerHost: React.FC<PlacePickerHostProps> = ({ onConfirm, onCancel, fallback }) => {
    if (isDemoMode()) {
        return <PlacePicker engine={demoPlacePickerEngine} onConfirm={onConfirm} onCancel={onCancel} />;
    }

    const key = getGoogleMapsBrowserKey();
    if (!key) return <>{fallback ?? null}</>;

    return (
        <APIProvider apiKey={key}>
            <RealPicker onConfirm={onConfirm} onCancel={onCancel} />
        </APIProvider>
    );
};

export default PlacePickerHost;
