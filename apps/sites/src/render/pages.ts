/**
 * Server-rendered restaurant pages. The first paint (hero, offers, the whole
 * menu, hours, contact) is plain HTML so search engines and WhatsApp/Instagram
 * link previews see it; /assets/site.js adds the cart and checkout on top.
 */

import type { SitePage, StorefrontContent } from '@restropulse/shared';
import type { SiteConfig, SiteMenu, SiteMenuItem } from '../api-client.js';
import { esc, jsonForScript, paragraphs, rupees, safeColor, safeUrl } from './html.js';
import { heroImage, metaDescription, pageTitle, restaurantJsonLd, schemaDay } from './seo.js';

export interface PageContext {
    config: SiteConfig;
    menu: SiteMenu | null;
    /** Absolute URL of the site's home, no trailing slash: https://x.in or https://sites.../r/x */
    siteUrl: string;
    /** Path prefix for links on this host: '' or '/r/<slug>' */
    basePath: string;
    nonce: string;
    publicApiUrl: string;
}

interface LayoutOptions {
    title: string;
    description: string;
    canonical: string;
    image?: string;
    jsonLd?: Record<string, unknown>;
    body: string;
    noindex?: boolean;
    pageKind: 'home' | 'page' | 'track';
}

function themeStyle(content: StorefrontContent | null, nonce: string): string {
    const t = content?.theme ?? {};
    const vars = [
        ['--rp-primary', safeColor(t.primaryColor)],
        ['--rp-secondary', safeColor(t.secondaryColor)],
        ['--rp-accent', safeColor(t.accentColor)],
    ].filter(([, v]) => v);
    if (!vars.length) return '';
    return `<style nonce="${esc(nonce)}">:root{${vars.map(([k, v]) => `${k}:${v}`).join(';')}}</style>`;
}

function header(ctx: PageContext): string {
    const { restaurant, content } = ctx.config;
    const logo = safeUrl(content?.theme?.logoUrl);
    const pages = visiblePages(content);
    const home = ctx.basePath || '/';
    return `<header class="rp-header">
  <a class="rp-brand" href="${esc(home)}">${logo ? `<img src="${esc(logo)}" alt="" width="40" height="40">` : ''}<span>${esc(restaurant.name)}</span></a>
  <nav class="rp-nav" aria-label="Site">
    <a href="${esc(home)}#menu">Menu</a>
    ${pages.map((p) => `<a href="${esc(`${ctx.basePath}/p/${p.slug}`)}">${esc(p.title)}</a>`).join('\n    ')}
    <a href="${esc(home)}#contact">Contact</a>
  </nav>
  <button type="button" class="rp-cart-button" data-cart-open hidden aria-label="Open cart">Cart <span data-cart-count>0</span></button>
</header>`;
}

function footer(ctx: PageContext): string {
    return `<footer class="rp-footer"><p>&copy; ${new Date().getFullYear()} ${esc(ctx.config.restaurant.name)}</p><p class="rp-powered">Powered by RestroPulse</p></footer>`;
}

export function visiblePages(content: StorefrontContent | null): SitePage[] {
    return (content?.pages ?? []).filter((p) => p.visible && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(p.slug));
}

/** What the browser script needs; read from a JSON data block, never executed. */
function bootData(ctx: PageContext, pageKind: LayoutOptions['pageKind']) {
    return {
        apiUrl: ctx.publicApiUrl,
        slug: ctx.config.restaurant.slug,
        name: ctx.config.restaurant.name,
        basePath: ctx.basePath,
        page: pageKind,
        ordering: ctx.config.ordering,
    };
}

function layout(ctx: PageContext, o: LayoutOptions): string {
    const image = o.image || heroImage(ctx.config.content);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta property="og:type" content="restaurant.restaurant">
<meta property="og:site_name" content="${esc(ctx.config.restaurant.name)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.canonical)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<link rel="stylesheet" href="/assets/site.css">
${themeStyle(ctx.config.content, ctx.nonce)}
${o.jsonLd ? `<script type="application/ld+json" nonce="${esc(ctx.nonce)}">${jsonForScript(o.jsonLd)}</script>` : ''}
</head>
<body class="rp-page-${o.pageKind}">
${header(ctx)}
<main id="main">
${o.body}
</main>
${footer(ctx)}
<script type="application/json" id="rp-boot">${jsonForScript(bootData(ctx, o.pageKind))}</script>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

function itemPrice(item: SiteMenuItem): string {
    if (item.variants?.length) {
        const min = Math.min(...item.variants.map((v) => v.price));
        return item.variants.length > 1 ? `from ${rupees(min)}` : rupees(min);
    }
    return rupees(item.price);
}

function menuItem(item: SiteMenuItem, canOrder: boolean): string {
    const image = safeUrl(item.images?.[0]);
    const soldOut = item.availability === 'out_of_stock';
    const variants = item.variants?.length
        ? `<label class="rp-field">Size <select data-variant>${item.variants
            .map((v) => `<option value="${esc(v.id)}" data-price="${v.price}">${esc(v.name)} (${rupees(v.price)})</option>`)
            .join('')}</select></label>`
        : '';
    const addons = item.addons?.length
        ? `<fieldset class="rp-addons"><legend>Add-ons</legend>${item.addons
            .map((a) => `<label><input type="checkbox" data-addon value="${esc(a.id)}" data-price="${a.price}"> ${esc(a.name)} (+${rupees(a.price)})</label>`)
            .join('')}</fieldset>`
        : '';
    return `<li class="rp-item${soldOut ? ' rp-soldout' : ''}" data-item-id="${esc(item.id)}" data-name="${esc(item.name)}" data-price="${item.price}">
  ${image ? `<img class="rp-item-img" src="${esc(image)}" alt="${esc(item.name)}" loading="lazy" width="96" height="96">` : ''}
  <div class="rp-item-body">
    <h3><span class="rp-diet ${item.isVeg ? 'rp-veg' : 'rp-nonveg'}" title="${item.isVeg ? 'Vegetarian' : 'Non-vegetarian'}" aria-label="${item.isVeg ? 'Vegetarian' : 'Non-vegetarian'}"></span>${esc(item.name)}${item.isBestSeller ? ' <span class="rp-tag">Bestseller</span>' : ''}</h3>
    ${item.description ? `<p class="rp-item-desc">${esc(item.description)}</p>` : ''}
    <p class="rp-price">${itemPrice(item)}</p>
    ${canOrder && !soldOut ? `<div class="rp-item-options" hidden>${variants}${addons}</div>` : ''}
    ${soldOut ? '<p class="rp-soldout-label">Sold out</p>' : canOrder ? '<button type="button" class="rp-add" data-add hidden>Add</button>' : ''}
  </div>
</li>`;
}

function menuSection(ctx: PageContext, canOrder: boolean): string {
    const menu = ctx.menu;
    const items = (menu?.items ?? []).filter((i) => i.availability !== 'hidden');
    if (!menu || !items.length) return '';
    const sections = [...menu.categories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((cat) => {
            const list = items.filter((i) => i.categoryId === cat.id).sort((a, b) => a.sortOrder - b.sortOrder);
            if (!list.length) return '';
            return `<section class="rp-category" aria-labelledby="cat-${esc(cat.id)}">
  <h3 class="rp-category-title" id="cat-${esc(cat.id)}">${esc(cat.name)}</h3>
  ${cat.description ? `<p class="rp-muted">${esc(cat.description)}</p>` : ''}
  <ul class="rp-items">${list.map((i) => menuItem(i, canOrder)).join('\n')}</ul>
</section>`;
        })
        .join('\n');
    return `<section id="menu" class="rp-section"><h2>Menu</h2>${sections}</section>`;
}

function offersSection(ctx: PageContext): string {
    const offers = ctx.menu?.offers ?? [];
    if (!offers.length) return '';
    return `<section class="rp-section rp-offers" aria-label="Offers"><h2>Offers</h2><ul>${offers
        .map((o) => {
            const banner = safeUrl(o.bannerImage);
            return `<li class="rp-offer">${banner ? `<img src="${esc(banner)}" alt="" loading="lazy">` : ''}<strong>${esc(o.title)}</strong><span>${esc(o.summary)}</span>${o.code ? `<span class="rp-code">Use code <b>${esc(o.code)}</b></span>` : ''}${o.description ? `<p class="rp-muted">${esc(o.description)}</p>` : ''}</li>`;
        })
        .join('')}</ul></section>`;
}

function hoursSection(content: StorefrontContent | null): string {
    const hours = content?.hours ?? [];
    if (!hours.length) return '';
    return `<section class="rp-section" aria-labelledby="hours-title"><h2 id="hours-title">Opening hours</h2><table class="rp-hours"><tbody>${hours
        .map((h) => `<tr><th scope="row">${esc(schemaDay(h.day) ?? h.day)}</th><td>${h.closed ? 'Closed' : `${esc(h.open)} to ${esc(h.close)}`}</td></tr>`)
        .join('')}</tbody></table></section>`;
}

function contactSection(ctx: PageContext): string {
    const { restaurant, content } = ctx.config;
    const address = content?.contact?.address || restaurant.address;
    const phone = content?.contact?.phone || restaurant.phone;
    const email = content?.contact?.email;
    const social = Object.entries(content?.socialLinks ?? {})
        .map(([k, v]) => [k, safeUrl(v)] as const)
        .filter(([, v]) => v);
    if (!address && !phone && !email && !social.length) return '';
    const tel = phone ? phone.replace(/[^\d+]/g, '') : '';
    return `<section id="contact" class="rp-section"><h2>Find us</h2>
  ${address ? `<p>${esc(address)}</p>` : ''}
  ${phone ? `<p><a href="tel:${esc(tel)}">${esc(phone)}</a></p>` : ''}
  ${email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? `<p><a href="mailto:${esc(email)}">${esc(email)}</a></p>` : ''}
  ${social.length ? `<p class="rp-social">${social.map(([k, v]) => `<a href="${esc(v)}" rel="noopener" target="_blank">${esc(k[0].toUpperCase() + k.slice(1))}</a>`).join(' ')}</p>` : ''}
</section>`;
}

function gallerySection(content: StorefrontContent | null): string {
    const images = (content?.gallery ?? []).map((g) => ({ url: safeUrl(g.url), caption: g.caption })).filter((g) => g.url).slice(0, 12);
    if (!images.length) return '';
    return `<section class="rp-section"><h2>Gallery</h2><ul class="rp-gallery">${images
        .map((g) => `<li><img src="${esc(g.url)}" alt="${esc(g.caption ?? '')}" loading="lazy">${g.caption ? `<span>${esc(g.caption)}</span>` : ''}</li>`)
        .join('')}</ul></section>`;
}

/** The checkout markup; hidden until site.js runs, so the page works as a menu without JS. */
function checkoutDialog(ctx: PageContext): string {
    const o = ctx.config.ordering;
    const types = ([['delivery', 'Delivery', o.orderTypes.delivery], ['pickup', 'Pickup', o.orderTypes.pickup], ['dine_in', 'Dine-in', o.orderTypes.dineIn]] as const)
        .filter(([, , on]) => on);
    const pays = ([['online', 'Pay online', o.payment.online], ['cash', 'Cash', o.payment.cash]] as const).filter(([, , on]) => on);
    return `<dialog class="rp-cart" id="rp-cart" aria-labelledby="rp-cart-title">
  <form method="dialog" class="rp-cart-close"><button aria-label="Close cart">Close</button></form>
  <h2 id="rp-cart-title">Your order</h2>
  <ul class="rp-cart-lines" data-cart-lines></ul>
  <p class="rp-muted" data-cart-empty>Your cart is empty.</p>
  <form class="rp-checkout" data-checkout novalidate>
    <fieldset><legend>How do you want it?</legend>${types
        .map(([v, label], i) => `<label><input type="radio" name="orderType" value="${v}"${i === 0 ? ' checked' : ''}> ${label}</label>`)
        .join('')}</fieldset>
    <div data-when="delivery">
      <label class="rp-field">Address <input name="line1" autocomplete="address-line1" maxlength="200"></label>
      <label class="rp-field">Landmark <input name="landmark" maxlength="120"></label>
      <label class="rp-field">Pincode <input name="pincode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="postal-code"></label>
    </div>
    <div data-when="dine_in"><label class="rp-field">Table <input name="table" maxlength="16"></label></div>
    <label class="rp-field">Name <input name="customerName" required maxlength="80" autocomplete="name"></label>
    <label class="rp-field">Mobile number <input name="customerPhone" required inputmode="tel" maxlength="16" autocomplete="tel"></label>
    <label class="rp-field">Offer code <input name="offerCode" maxlength="32" autocapitalize="characters"></label>
    <label class="rp-field">Notes for the kitchen <textarea name="notes" maxlength="300" rows="2"></textarea></label>
    <fieldset><legend>Payment</legend>${pays
        .map(([v, label], i) => `<label><input type="radio" name="paymentMethod" value="${v}"${i === 0 ? ' checked' : ''}> ${label}</label>`)
        .join('')}</fieldset>
    <dl class="rp-totals" data-totals></dl>
    <p class="rp-error" role="alert" data-error></p>
    <button type="submit" class="rp-primary" data-place-order>Place order</button>
  </form>
</dialog>`;
}

export function renderHome(ctx: PageContext): string {
    const { config } = ctx;
    const content = config.content;
    const o = config.ordering;
    const canOrder = o.storeOpen
        && (o.orderTypes.delivery || o.orderTypes.pickup || o.orderTypes.dineIn)
        && (o.payment.online || o.payment.cash);
    const hero = heroImage(content);
    const announcement = content?.announcement?.enabled && content.announcement.text
        ? `<p class="rp-announcement" role="status">${esc(content.announcement.text)}</p>`
        : '';
    const body = `${announcement}
<section class="rp-hero">
  ${hero ? `<img class="rp-hero-img" src="${esc(hero)}" alt="" fetchpriority="high">` : ''}
  <div class="rp-hero-text">
    <h1>${esc(config.restaurant.name)}</h1>
    ${content?.tagline ? `<p class="rp-tagline">${esc(content.tagline)}</p>` : config.restaurant.cuisine ? `<p class="rp-tagline">${esc(config.restaurant.cuisine)}</p>` : ''}
    ${canOrder ? '<a class="rp-primary" href="#menu">Order online</a>' : '<p class="rp-closed">Not taking online orders right now.</p>'}
  </div>
</section>
${offersSection(ctx)}
${menuSection(ctx, canOrder)}
${content?.about ? `<section class="rp-section" aria-labelledby="about-title"><h2 id="about-title">About us</h2>${paragraphs(content.about)}</section>` : ''}
${gallerySection(content)}
${hoursSection(content)}
${contactSection(ctx)}
${canOrder ? checkoutDialog(ctx) : ''}`;
    return layout(ctx, {
        title: pageTitle(config),
        description: metaDescription(config),
        canonical: `${ctx.siteUrl}/`,
        jsonLd: restaurantJsonLd(config, ctx.menu, `${ctx.siteUrl}/`),
        body,
        pageKind: 'home',
    });
}

export function renderSitePage(ctx: PageContext, page: SitePage): string {
    const summary = page.body.replace(/\s+/g, ' ').trim();
    return layout(ctx, {
        title: pageTitle(ctx.config, page.title),
        description: summary.length > 160 ? `${summary.slice(0, 157).trimEnd()}...` : summary || metaDescription(ctx.config),
        canonical: `${ctx.siteUrl}/p/${page.slug}`,
        body: `<article class="rp-section rp-article"><h1>${esc(page.title)}</h1>${paragraphs(page.body)}</article>`,
        pageKind: 'page',
    });
}

export function renderTracking(ctx: PageContext, orderId: string): string {
    return layout(ctx, {
        title: pageTitle(ctx.config, 'Your order'),
        description: `Track your order from ${ctx.config.restaurant.name}.`,
        canonical: `${ctx.siteUrl}/`,
        noindex: true,
        body: `<section class="rp-section rp-track" data-track data-order-id="${esc(orderId)}" aria-live="polite">
  <h1>Your order</h1>
  <p class="rp-muted" data-track-status>Loading your order...</p>
  <ol class="rp-timeline" data-track-timeline></ol>
  <dl class="rp-totals" data-track-totals></dl>
  <p class="rp-error" role="alert" data-error></p>
  <button type="button" class="rp-primary" data-pay-again hidden>Pay now</button>
  <p><a href="${esc(ctx.basePath || '/')}">Back to the menu</a></p>
</section>`,
        pageKind: 'track',
    });
}

const plainPage = (title: string, message: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/site.css"></head>
<body><main class="rp-section rp-plain"><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;

export const renderNotFound = () => plainPage('Page not found', "We couldn't find that page.");
export const renderUnavailable = () => plainPage('Back soon', "This site can't load right now. Please try again in a minute.");
