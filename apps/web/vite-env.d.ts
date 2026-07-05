/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_FIREBASE_API_KEY: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN: string;
    readonly VITE_FIREBASE_PROJECT_ID: string;
    readonly VITE_FIREBASE_STORAGE_BUCKET: string;
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
    readonly VITE_FIREBASE_APP_ID: string;
    /** 'true' = static demo preview (fixtures-backed API, dummy login). */
    readonly VITE_DEMO_MODE?: string;
    /** 'v2' = render the alternative bucketed-sidebar admin shell (deployed at /admin-v2/). */
    readonly VITE_ADMIN_SHELL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
