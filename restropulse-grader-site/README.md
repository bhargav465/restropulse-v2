# RestroPulse Grader Site (public lead-gen) — DEFERRED

Status: **spec only, not built.** Brief 10 §3 references
`restropulse-grader-site/index.html` and "see its README for APIs/keys/deploy",
but that README and the reference `Royal-Biryani-House-rapport.pdf` were not
provided with this brief. To avoid inventing a full marketing site against an
unknown spec, this file documents the intended shape; the site itself is
deferred until its own spec lands. (See `docs/NEXT.md`.)

## What it should be

A single static, public, no-login page that is the **lead-gen twin** of the
Brief 10 monorepo feature set, calling Google directly from the browser:

1. **"Add my restaurant" picker** — identical UX to
   `apps/web/components/v2/intelligence/PlacePicker.tsx`: city autocomplete
   (`types:['(cities)']`) → restaurant autocomplete (`types:['establishment']`,
   enabled after city, biased to a 25 km circle) → preview card → confirm.
2. **Both competition buckets** — "Same cuisine & AOV" (directTop10) and
   "Overall" (overallTop10), computed in-browser from Places nearby results.
3. **Revenue-growth card** — editable guests/month `clamp(reviews×2, 400, 8000)`
   + avg spend ₹400 → conservative 9% uplift → extra guests/mo, ₹/mo, ₹/yr.
   All labelled a projection, never a promise; no delta pills.
4. **Deep-link CTA** — "Get the full report" links into RestroPulse signup,
   carrying the confirmed `placeId` so the first authenticated scan skips
   text-search disambiguation.

## Keep in sync with the monorepo

The bucket thresholds MUST mirror the server source of truth,
`apps/api/src/services/intelligence/buckets.ts`:
- AOV band map (Google price level 0–4 → Budget/Budget/Value/Premium/Luxury;
  missing = 2/Value).
- `directTop10` = within 5 km AND `cuisineMatch(cuisine, baseCuisine)` (same
  family — specific Indian cuisines match generic "Indian") AND
  `|priceLevel − basePriceLevel| ≤ 1`, threat desc, slice 10.
- `overallTop10` = within 5 km, threat desc, slice 10.
- Threat score formula must match `services/intelligence/scoring.ts`.

## Keys / deploy (when built)

- A **referrer-restricted browser key** (Maps JavaScript API + Places API),
  locked to the grader site's origin(s). NEVER the server key
  (`GOOGLE_MAPS_API_KEY`, which lives only on the API service). Same policy as
  `VITE_GOOGLE_MAPS_BROWSER_KEY` in `apps/web/.env.example`.
- No secrets in the repo; document the key as a build-time/env substitution.

## Why deferred (ASSUMPTION)

The monorepo features (A: picker, B: buckets + revenue card) are the shippable,
gate-covered deliverables. The standalone public site is a separate artifact
whose exact copy, layout, analytics, and deploy target depend on the missing
grader-site spec + reference PDF. Building it blind risks drift from that spec
and from `buckets.ts`. It is intentionally deferred; this README is the contract.
