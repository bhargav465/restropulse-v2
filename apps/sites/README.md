# @restropulse/sites

Every restaurant's public website, from one Express host (Phase 2 M3,
docs/LAUNCH_ARCHITECTURE.md B2/B3).

- `/r/<slug>/` on this host always works (preview and QA).
- `<slug>.<SITES_ROOT_DOMAIN>` serves that restaurant at `/`.
- Any other Host is an owner's own domain, looked up with
  `GET /api/sites/resolve?host=` (only domains the owner verified in the
  dashboard's Website tab).

Pages are rendered on the server (title, description, Open Graph, canonical,
JSON-LD Restaurant + Menu + opening hours, `/sitemap.xml`, `/robots.txt`), so
search engines and WhatsApp/Instagram previews see the menu. `public/site.js`
adds the cart, checkout (guest checkout, Razorpay or cash) and order tracking
on top, against the public `/api/storefront/:slug` routes. Restaurant data is
cached for `SITES_CACHE_TTL_MS` (60s), so a publish shows up within a minute.

```bash
npm run dev --workspace=@restropulse/sites   # :3004, reads the API on :3001
# then open http://localhost:3004/r/<your-slug>/
```

Not done here (needs owner decisions or accounts): the Azure App Service for
this host, the `*.restropulse.in` wildcard DNS, and the Cloudflare for SaaS
adapter that issues certificates for owners' own domains (ADR 0002). Until
that adapter exists, a verified domain is marked `sslStatus: manual` and the
hostname is added at the edge by hand.
