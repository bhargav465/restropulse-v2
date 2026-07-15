export const getGoogleMapsApiKey = (): string | undefined =>
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

/**
 * Referrer-restricted BROWSER key for the Google place picker (Brief 10). This is
 * a public, HTTP-referrer-locked key — NEVER the server key (GOOGLE_MAPS_API_KEY
 * on the API). Falls back to the existing browser Maps key for continuity.
 */
export const getGoogleMapsBrowserKey = (): string | undefined =>
    import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export const getFirebaseApiKey = (): string | undefined =>
    import.meta.env.VITE_FIREBASE_API_KEY;

export const getApiUrl = (): string =>
    import.meta.env.VITE_API_URL;

export const getAppUrl = (): string =>
    import.meta.env.VITE_APP_URL;
