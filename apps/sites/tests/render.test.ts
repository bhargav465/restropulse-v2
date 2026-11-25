import { describe, it, expect } from 'vitest';
import { esc, jsonForScript, paragraphs, rupees, safeColor, safeUrl } from '../src/render/html.js';
import { metaDescription, openingHours, pageTitle, restaurantJsonLd, schemaDay } from '../src/render/seo.js';
import { renderHome, renderNotFound, renderSitePage, renderTracking, renderUnavailable, visiblePages, type PageContext } from '../src/render/pages.js';
import { robotsTxt, sitemapXml } from '../src/render/sitemap.js';
import { sampleConfig, sampleMenu } from './fixtures.js';

const ctx = (over: Partial<PageContext> = {}): PageContext => ({
    config: sampleConfig(),
    menu: sampleMenu(),
    siteUrl: 'https://bawarchi.in',
    basePath: '',
    nonce: 'n0nce',
    publicApiUrl: 'https://api.restropulse.in',
    ...over,
});

describe('html helpers', () => {
    it('escapes, and blocks unsafe urls and colours', () => {
        expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
        expect(esc(null)).toBe('');
        expect(safeUrl('https://a.in/x.jpg')).toBe('https://a.in/x.jpg');
        expect(safeUrl('javascript:alert(1)')).toBe('');
        expect(safeUrl('not a url')).toBe('');
        expect(safeUrl('  ')).toBe('');
        expect(safeUrl(42)).toBe('');
        expect(safeColor('#AbC')).toBe('#AbC');
        expect(safeColor('red')).toBeNull();
        expect(safeColor(undefined)).toBeNull();
    });

    it('keeps JSON inside a script tag', () => {
        const out = jsonForScript({ a: '</script><b>&', b: '\u2028\u2029' });
        expect(out).not.toMatch(/[<>&\u2028\u2029]/);
        expect(JSON.parse(out)).toEqual({ a: '</script><b>&', b: '\u2028\u2029' });
    });

    it('formats rupees and paragraphs', () => {
        expect(rupees(1200)).toBe('₹1,200');
        expect(rupees(90.5)).toBe('₹90.50');
        expect(paragraphs('a\n\n<b>\nc')).toBe('<p>a</p><p>&lt;b&gt;<br>c</p>');
        expect(paragraphs(undefined)).toBe('');
    });
});

describe('seo', () => {
    it('maps days and opening hours, skipping closed and bad rows', () => {
        expect(schemaDay('TUESDAY')).toBe('Tuesday');
        expect(schemaDay('x')).toBeNull();
        expect(schemaDay(undefined as unknown as string)).toBeNull();
        const h = openingHours(sampleConfig().content!.hours);
        expect(h).toEqual([
            { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '11:00', closes: '23:00' },
            { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Tuesday', opens: '09:30', closes: '22:00' },
        ]);
        expect(openingHours(undefined)).toEqual([]);
        expect(openingHours([{ day: 'Monday', open: '25:00', close: '23:00' }])).toEqual([]);
    });

    it('describes the restaurant from seo, tagline, about or a fallback', () => {
        expect(metaDescription(sampleConfig())).toBe('Hyderabadi biryani since 1978');
        const long = sampleConfig({ content: { heroImages: [], about: 'x '.repeat(200) } });
        expect(metaDescription(long).length).toBeLessThanOrEqual(160);
        expect(metaDescription(long).endsWith('...')).toBe(true);
        expect(metaDescription(sampleConfig({ content: null }))).toBe('Bawarchi [SAMPLE], Biryani. Order online for delivery or pickup.');
        const noCuisine = sampleConfig({ content: null });
        noCuisine.restaurant.cuisine = '';
        expect(metaDescription(noCuisine)).toBe('Bawarchi [SAMPLE]. Order online for delivery or pickup.');
        expect(metaDescription(sampleConfig({ content: { heroImages: [], seo: { description: 'Custom' } } }))).toBe('Custom');
        expect(pageTitle(sampleConfig())).toBe('Bawarchi | Best biryani in Hyderabad');
        expect(pageTitle(sampleConfig(), 'Catering')).toBe('Catering | Bawarchi [SAMPLE]');
        expect(pageTitle(sampleConfig({ content: null }))).toBe('Bawarchi [SAMPLE]');
    });

    it('builds Restaurant + Menu JSON-LD from visible items', () => {
        const ld = restaurantJsonLd(sampleConfig(), sampleMenu(), 'https://bawarchi.in/');
        expect(ld).toMatchObject({
            '@type': 'Restaurant',
            name: 'Bawarchi [SAMPLE]',
            servesCuisine: 'Biryani',
            telephone: '+91 98765 43210',
            image: 'https://cdn.example.com/hero.jpg',
            sameAs: ['https://instagram.com/bawarchi'],
            address: { streetAddress: 'Road 1, Hyderabad' },
            potentialAction: { '@type': 'OrderAction', target: 'https://bawarchi.in/' },
        });
        const sections = (ld.hasMenu as { hasMenuSection: Array<{ name: string; hasMenuItem: Array<{ name: string; offers: { price: string } }> }> }).hasMenuSection;
        expect(sections.map((s) => s.name)).toEqual(['Drinks', 'Biryani']);
        expect(sections[1].hasMenuItem[0].offers.price).toBe('220.00');
        expect(JSON.stringify(ld)).not.toContain('Hidden');
    });

    it('leaves out what it does not have', () => {
        const bare = sampleConfig({ content: null });
        bare.restaurant = { id: 'r1', name: 'X', cuisine: '', slug: 'xxx' };
        bare.ordering.storeOpen = false;
        const ld = restaurantJsonLd(bare, null, 'https://x/');
        expect(Object.keys(ld).sort()).toEqual(['@context', '@type', 'name', 'url']);
        expect(restaurantJsonLd(bare, { categories: [], items: [], offers: [] }, 'u').hasMenu).toBeUndefined();
    });
});

describe('home page', () => {
    const html = renderHome(ctx());

    it('has a tenant-specific head', () => {
        expect(html).toContain('<title>Bawarchi | Best biryani in Hyderabad</title>');
        expect(html).toContain('<link rel="canonical" href="https://bawarchi.in/">');
        expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/hero.jpg">');
        expect(html).toContain('<script type="application/ld+json" nonce="n0nce">');
        expect(html).toContain('<style nonce="n0nce">:root{--rp-primary:#aa3300}</style>');
        expect(html).not.toContain('</style><script>');
    });

    it('renders the menu escaped, in category order, without hidden items', () => {
        expect(html).toContain('Chicken Dum Biryani &lt;b&gt;');
        expect(html).not.toContain('Chicken Dum Biryani <b>');
        expect(html.indexOf('>Biryani</h3>')).toBeLessThan(html.indexOf('>Drinks</h3>'));
        expect(html).not.toContain('>Empty</h3>');
        expect(html).not.toContain('Hidden');
        expect(html).toContain('from ₹220');
        expect(html).toContain('<option value="v1" data-price="220">Half (₹220)</option>');
        expect(html).toContain('data-addon value="a1" data-price="30"');
        expect(html).toContain('Sold out');
        expect(html).toContain('Bestseller');
        expect(html).toContain('₹90.50');
    });

    it('shows offers, about, gallery, hours, contact and the checkout', () => {
        expect(html).toContain('Use code <b>LUNCH15</b>');
        expect(html).toContain('<p>Second paragraph<br>with a break.</p>');
        expect(html).toContain('alt="Dum"');
        expect(html).not.toContain('ftp://nope');
        expect(html).toContain('<td>Closed</td>');
        expect(html).toContain('href="tel:+919876543210"');
        expect(html).toContain('href="mailto:hello@bawarchi.in"');
        expect(html).not.toContain('javascript:alert');
        expect(html).toContain('role="status">Open on Diwali');
        expect(html).toContain('value="delivery" checked');
        expect(html).not.toContain('value="dine_in"');
        expect(html).toContain('href="/p/catering"');
        expect(html).not.toContain('/p/secret');
    });

    it('the checkout shows how to pay in cash instead of payment choices', () => {
        expect(html).not.toContain('name="paymentMethod"');
        expect(html).not.toContain('Pay online');
        expect(html).not.toContain('<legend>Payment</legend>');
        expect(html).toContain('data-cash-note');
        // One line per enabled order type, shown by site.js for the chosen type.
        expect(html).toContain('<p data-when="delivery"><strong>Payment:</strong> Pay cash on delivery.</p>');
        expect(html).toContain('<p data-when="pickup"><strong>Payment:</strong> Pay at the counter when you pick up.</p>');
        expect(html).not.toContain('Pay at your table.');
        const dineIn = sampleConfig();
        dineIn.ordering.orderTypes = { delivery: false, pickup: false, dineIn: true };
        const out = renderHome(ctx({ config: dineIn }));
        expect(out).toContain('<p data-when="dine_in"><strong>Payment:</strong> Pay at your table.</p>');
        expect(out).not.toContain('Pay cash on delivery.');
        expect(out).not.toContain('name="paymentMethod"');
    });

        it('puts boot data in a JSON block for the script', () => {
        const m = /<script type="application\/json" id="rp-boot">(.*?)<\/script>/.exec(html);
        expect(JSON.parse(m![1])).toMatchObject({ apiUrl: 'https://api.restropulse.in', slug: 'bawarchi', basePath: '', page: 'home' });
    });

    it('a closed store shows the menu without ordering', () => {
        const closed = sampleConfig();
        closed.ordering.storeOpen = false;
        const out = renderHome(ctx({ config: closed }));
        expect(out).toContain('Not taking online orders right now.');
        expect(out).not.toContain('data-add');
        expect(out).not.toContain('id="rp-cart"');
        expect(out).toContain('Chicken Dum Biryani');
    });

    it('works with almost no content', () => {
        const bare = sampleConfig({ content: null });
        bare.restaurant = { id: 'r1', name: 'Plain', cuisine: 'Cafe', slug: 'plain' };
        const out = renderHome(ctx({ config: bare, menu: null, basePath: '/r/plain', siteUrl: 'https://s.in/r/plain' }));
        expect(out).toContain('<p class="rp-tagline">Cafe</p>');
        expect(out).toContain('<meta name="twitter:card" content="summary">');
        expect(out).not.toContain('id="menu"');
        expect(out).not.toContain('id="contact"');
        expect(out).toContain('href="/r/plain#menu"');
        const noCuisine = { ...bare, restaurant: { ...bare.restaurant, cuisine: '' } };
        expect(renderHome(ctx({ config: noCuisine, menu: null }))).not.toContain('rp-tagline');
    });

    it('a contact block with only a bad email is left out', () => {
        const c = sampleConfig({ content: { heroImages: [], contact: { email: 'not-an-email' } } });
        c.restaurant = { id: 'r1', name: 'X', cuisine: '', slug: 'xxx' };
        const out = renderHome(ctx({ config: c }));
        expect(out).toContain('id="contact"');
        expect(out).not.toContain('mailto:');
    });
});

describe('other pages', () => {
    it('renders a site page with its own title and canonical', () => {
        const page = { slug: 'catering', title: 'Catering', body: 'We cater weddings.', visible: true };
        const out = renderSitePage(ctx(), page);
        expect(out).toContain('<title>Catering | Bawarchi [SAMPLE]</title>');
        expect(out).toContain('href="https://bawarchi.in/p/catering"');
        expect(out).toContain('<meta name="description" content="We cater weddings.">');
        const long = renderSitePage(ctx(), { ...page, body: 'y '.repeat(200) });
        expect(long).toMatch(/content="(y ){50,}y\.\.\."/);
        expect(renderSitePage(ctx(), { ...page, body: '' })).toContain('content="Hyderabadi biryani since 1978"');
    });

    it('the tracking page is noindex and carries the order id', () => {
        const out = renderTracking(ctx(), 'ord1');
        expect(out).toContain('<meta name="robots" content="noindex">');
        expect(out).toContain('data-order-id="ord1"');
        expect(out).toContain('"page":"track"');
        expect(out).toContain('data-track-rider hidden');
        expect(out).toContain('data-track-pay hidden');
        expect(out).not.toContain('data-pay-again');
        expect(out).not.toContain('Pay now');
    });

    it('plain pages', () => {
        expect(renderNotFound()).toContain('Page not found');
        expect(renderUnavailable()).toContain('Back soon');
    });

    it('only valid, visible pages are linked', () => {
        expect(visiblePages(null)).toEqual([]);
        expect(visiblePages({ heroImages: [], pages: [{ slug: 'Bad Slug', title: 'x', body: '', visible: true }] })).toEqual([]);
    });

    it('robots and sitemap', () => {
        expect(robotsTxt('https://bawarchi.in')).toBe('User-agent: *\nAllow: /\nDisallow: /order/\nSitemap: https://bawarchi.in/sitemap.xml\n');
        const xml = sitemapXml('https://bawarchi.in', [{ slug: 'catering', title: 'C', body: '', visible: true }]);
        expect(xml).toContain('<loc>https://bawarchi.in/</loc>');
        expect(xml).toContain('<loc>https://bawarchi.in/p/catering</loc>');
    });
});
