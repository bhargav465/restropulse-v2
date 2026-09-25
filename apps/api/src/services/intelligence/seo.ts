/**
 * Website / SEO checks for the intelligence scan.
 *
 * Ported from the predecessor `fetchWebsiteSEO`: a single 5-second-timeout
 * homepage fetch, custom-domain detection against a third-party host list, and
 * H1 / meta-description parsing. Runs concurrently with the AI analysis stage.
 *
 * Deterministic, no secrets. A missing/unreachable/slow site degrades to the
 * "all fail" default (never throws — SEO signals must not fail the whole scan).
 */

const FETCH_TIMEOUT_MS = 5000;

const THIRD_PARTY_DOMAINS = [
    'zomato.com',
    'swiggy.com',
    'yelp.com',
    'facebook.com',
    'instagram.com',
    'tripadvisor.com',
    'justdial.com',
    'google.com',
    'linktr.ee',
];

/** Deterministic website signals consumed by scoring.ts and the report. */
export interface WebsiteSEO {
    websiteUrl: string | null;
    hasWebsite: boolean;
    customDomain: boolean;
    cleanUrl: boolean;
    hasH1: boolean;
    h1IncludesCity: boolean;
    h1IncludesBrand: boolean;
    hasMetaDescription: boolean;
    metaDescriptionOptimalLength: boolean;
    metaDescriptionIncludesCity: boolean;
    hostname: string | null;
    h1Text: string | null;
}

function emptyChecks(websiteUrl: string | null): WebsiteSEO {
    return {
        websiteUrl,
        hasWebsite: !!websiteUrl,
        customDomain: false,
        cleanUrl: false,
        hasH1: false,
        h1IncludesCity: false,
        h1IncludesBrand: false,
        hasMetaDescription: false,
        metaDescriptionOptimalLength: false,
        metaDescriptionIncludesCity: false,
        hostname: null,
        h1Text: null,
    };
}

export async function fetchWebsiteSEO(
    websiteUrl: string | null,
    restaurantName: string,
    city: string,
): Promise<WebsiteSEO> {
    if (!websiteUrl) return emptyChecks(null);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(websiteUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestroPulseBot/1.0)' },
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!res.ok) return emptyChecks(websiteUrl);

        const html = await res.text();
        const htmlLower = html.toLowerCase();
        const cityLower = city.toLowerCase();
        const nameLower = restaurantName.toLowerCase();

        let hostname = '';
        try {
            hostname = new URL(websiteUrl).hostname;
        } catch {
            /* keep empty */
        }
        const customDomain = !THIRD_PARTY_DOMAINS.some((d) => hostname.includes(d));
        const cleanUrl = !websiteUrl.includes('?') && !websiteUrl.includes('#') && websiteUrl.length < 80;

        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
        const h1Lower = h1Text.toLowerCase();

        const descMatch =
            html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const metaDesc = descMatch ? descMatch[1].trim() : '';

        return {
            websiteUrl,
            hasWebsite: true,
            customDomain,
            cleanUrl,
            hasH1: !!h1Text,
            h1IncludesCity: h1Lower.includes(cityLower),
            h1IncludesBrand: h1Lower.includes(nameLower) || htmlLower.includes(nameLower),
            hasMetaDescription: !!metaDesc,
            metaDescriptionOptimalLength: metaDesc.length >= 120 && metaDesc.length <= 160,
            metaDescriptionIncludesCity: metaDesc.toLowerCase().includes(cityLower),
            hostname: hostname || null,
            h1Text: h1Text || null,
        };
    } catch {
        return emptyChecks(websiteUrl);
    }
}
