# ADR 0002: Custom domains for per-restaurant websites (edge + TLS)

## 1. Status

**Proposed** -- 2026-10-04. Needs owner decision before Lane B2/B3 (see `docs/LAUNCH_ARCHITECTURE.md`).

## 2. Context

Every restaurant gets its own public website (`apps/sites`), and the product decision is that a restaurant can bring its own domain (`bawarchirestaurant.com`) from day one, in addition to a default `<slug>.restropulse.in` address. That means:

- N arbitrary hostnames, added by merchants at any time without an engineer in the loop.
- A TLS certificate per hostname, issued and renewed automatically.
- Tenant resolution from the `Host` header at the origin.
- A DNS verification flow the merchant can complete from the admin UI.

The current web host is Azure Static Web Apps. SWA caps custom domains per app (2 on Free, 5 on Standard), so it cannot host N restaurant sites regardless of anything else. The API runs on Azure App Service with Key Vault references and slot-swap promotion; that is the pattern Lane B reuses for the sites host.

## 3. Options considered

| Option | Custom domain limit | TLS automation | Programmatic onboarding | Cost | Notes |
|---|---|---|---|---|---|
| A. Azure Static Web Apps | 2 / 5 per app | Managed | No (portal/CLI, capped) | Free/Std | Hard cap kills it |
| B. Azure App Service custom domains + App Service Managed Certificates | 500 hostnames / app | Managed cert per hostname, requires CNAME to the app and a TXT `asuid` verification | Yes via `az webapp config hostname add` + `az webapp config ssl create` (ARM) | Included in plan (Basic+) | Managed certs do not support apex/naked domains (need `www`), and issuance is slow (minutes) and occasionally flaky; our deploy identity would need `Contributor` on the web app from the API process, which widens blast radius |
| C. Azure Front Door Standard + managed TLS | 500 domains / profile (Std) | Managed, incl. apex via CNAME flattening at Azure DNS only | Yes (ARM), slower propagation | ~$35/month base + egress | More moving parts, routing rules, and still a per-domain validation TXT; overkill for a few hundred small sites |
| D. Cloudflare for SaaS (Custom Hostnames) in front of App Service | 100 free hostnames, then ~$0.10/hostname/month | Automatic via HTTP or TXT validation, apex supported | Yes, one API call per hostname; webhook/API for status | Pro plan or Enterprise not required; CF for SaaS is available on Free/Pro with per-hostname pricing | Merchant CNAMEs `www` to `sites.restropulse.in`; CF issues the cert and proxies to our App Service fallback origin. Also gives caching, WAF and rate limiting at the edge |

## 4. Decision (proposed)

**Option D: Cloudflare for SaaS, with `apps/sites` on Azure App Service as the fallback origin.**

- `restropulse.in` DNS moves to Cloudflare (or a dedicated zone such as `restropulse.site` if the owner prefers to keep the main domain where it is -- **owner decision**).
- Wildcard `*.restropulse.in` -> App Service for default/preview URLs.
- Custom hostnames are created through the Cloudflare API from `apps/api` (`POST /api/admin/site/domains`) and stored in `restaurant_domains` with the CF hostname id and SSL status; a polling job (dispatch-worker pattern) reconciles status until `active`.
- Origin trusts only Cloudflare IP ranges plus an `X-RestroPulse-Edge` shared-secret header (Key Vault) so the App Service is not reachable by Host spoofing.
- `apps/sites` resolves the tenant from `Host` -> `restaurant_domains`, falling back to `<slug>.restropulse.in` and `/r/:slug`.

## 5. Consequences

- Positive: unlimited practical hostnames, apex domains work, TLS is somebody else's problem, edge cache for menu/content JSON, DDoS/WAF for free.
- Negative: a second vendor (Cloudflare) with its own secrets, billing and status to monitor; DNS for the chosen zone must live at Cloudflare; CF for SaaS pricing beyond 100 hostnames is a per-restaurant cost (~Rs 8-9/month each) to roll into plan pricing.
- Neutral: if Azure-only is a hard requirement, Option B is the fallback -- same `restaurant_domains` model and admin flow, different provider adapter. The provider is isolated behind `packages/sites-edge/EdgeProvider` so switching later is contained.

## 6. Human-only prerequisites

Cloudflare account + API token with `SSL and Certificates:Edit` and `Zone:Read` scoped to the zone; the zone delegated to Cloudflare; Azure App Service `restropulse-sites` created with a staging slot; Key Vault secrets `{env}-cloudflare-api-token`, `{env}-edge-shared-secret`.
