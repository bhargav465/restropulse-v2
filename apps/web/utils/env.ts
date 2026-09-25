import { getClientConfig } from './client-config';

function tryGetClientConfig() {
    try {
        return getClientConfig();
    } catch {
        return null;
    }
}

export const getGoogleMapsApiKey = (): string | undefined =>
    tryGetClientConfig()?.googleMapsApiKey;

// Alias used by the ported Restaurant Intelligence PlacePicker (v2 naming).
export const getGoogleMapsBrowserKey = getGoogleMapsApiKey;

export const getFirebaseApiKey = (): string | undefined =>
    tryGetClientConfig()?.firebase.apiKey;

export const getApiUrl = (): string =>
    getClientConfig().apiUrl;

export const getAppUrl = (): string =>
    getClientConfig().appUrl;
