import type { SitePage } from '@restropulse/shared';
import { esc } from './html.js';

export function robotsTxt(siteUrl: string): string {
    return `User-agent: *\nAllow: /\nDisallow: /order/\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

export function sitemapXml(siteUrl: string, pages: SitePage[]): string {
    const urls = [`${siteUrl}/`, ...pages.map((p) => `${siteUrl}/p/${p.slug}`)];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
}
