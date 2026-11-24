/**
 * SEO for a restaurant page: meta description and schema.org JSON-LD
 * (Restaurant + Menu + OpeningHoursSpecification), per docs/LAUNCH_ARCHITECTURE B3.
 */

import type { StorefrontContent, StorefrontHoursEntry } from '@restropulse/shared';
import type { SiteConfig, SiteMenu } from '../api-client.js';
import { safeUrl } from './html.js';

const DAYS: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** "monday", "Mon", "MONDAY" -> "Monday"; unknown -> null. */
export function schemaDay(day: string): string | null {
    return DAYS[String(day ?? '').trim().slice(0, 3).toLowerCase()] ?? null;
}

const hhmm = (v: string) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v ?? '').trim()) ? String(v).trim().padStart(5, '0') : null);

export function openingHours(hours: StorefrontHoursEntry[] | undefined) {
    return (hours ?? []).flatMap((h) => {
        const day = schemaDay(h.day);
        const opens = hhmm(h.open);
        const closes = hhmm(h.close);
        if (!day || h.closed || !opens || !closes) return [];
        return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${day}`, opens, closes }];
    });
}

export function metaDescription(config: SiteConfig): string {
    const c = config.content;
    const text = c?.seo?.description || c?.tagline || c?.about
        || `${config.restaurant.name}${config.restaurant.cuisine ? `, ${config.restaurant.cuisine}` : ''}. Order online for delivery or pickup.`;
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 160 ? `${flat.slice(0, 157).trimEnd()}...` : flat;
}

export function pageTitle(config: SiteConfig, sub?: string): string {
    const base = config.content?.seo?.title || config.restaurant.name;
    return sub ? `${sub} | ${config.restaurant.name}` : base;
}

export function heroImage(content: StorefrontContent | null): string {
    return (content?.heroImages ?? []).map(safeUrl).find(Boolean) ?? '';
}

export function restaurantJsonLd(config: SiteConfig, menu: SiteMenu | null, url: string): Record<string, unknown> {
    const { restaurant, content } = config;
    const address = content?.contact?.address || restaurant.address;
    const phone = content?.contact?.phone || restaurant.phone;
    const image = heroImage(content);
    const hours = openingHours(content?.hours);
    const sameAs = Object.values(content?.socialLinks ?? {}).map(safeUrl).filter(Boolean);
    const visible = (menu?.items ?? []).filter((i) => i.availability !== 'hidden');

    const ld: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        name: restaurant.name,
        url,
        ...(restaurant.cuisine ? { servesCuisine: restaurant.cuisine } : {}),
        ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'IN' } } : {}),
        ...(phone ? { telephone: phone } : {}),
        ...(image ? { image } : {}),
        ...(hours.length ? { openingHoursSpecification: hours } : {}),
        ...(sameAs.length ? { sameAs } : {}),
        ...(config.ordering.storeOpen ? { acceptsReservations: false, potentialAction: { '@type': 'OrderAction', target: url } } : {}),
    };
    if (menu && visible.length) {
        ld.hasMenu = {
            '@type': 'Menu',
            hasMenuSection: menu.categories
                .map((cat) => ({
                    '@type': 'MenuSection',
                    name: cat.name,
                    hasMenuItem: visible
                        .filter((i) => i.categoryId === cat.id)
                        .map((i) => ({
                            '@type': 'MenuItem',
                            name: i.name,
                            ...(i.description ? { description: i.description } : {}),
                            offers: { '@type': 'Offer', price: (i.variants?.[0]?.price ?? i.price).toFixed(2), priceCurrency: 'INR' },
                            ...(i.isVeg ? { suitableForDiet: 'https://schema.org/VegetarianDiet' } : {}),
                        })),
                }))
                .filter((s) => s.hasMenuItem.length),
        };
    }
    return ld;
}
