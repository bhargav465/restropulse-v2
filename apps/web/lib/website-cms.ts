/**
 * Website CMS feature flag (Phase 2).
 *
 * The Website screens (menu, offers, site content) only appear when the build
 * sets VITE_WEBSITE_CMS=true, so default builds stay behaviour-identical until
 * the CMS API is deployed alongside them.
 */
export function isWebsiteCmsEnabled(): boolean {
    return import.meta.env.VITE_WEBSITE_CMS === 'true';
}
