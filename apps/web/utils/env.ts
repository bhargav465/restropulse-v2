export const getGoogleMapsApiKey = (): string | undefined =>
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export const getFirebaseApiKey = (): string | undefined =>
    import.meta.env.VITE_FIREBASE_API_KEY;

export const getApiUrl = (): string =>
    import.meta.env.VITE_API_URL;

export const getAppUrl = (): string =>
    import.meta.env.VITE_APP_URL;
