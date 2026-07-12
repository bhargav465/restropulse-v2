# HANDOVER — Briefs 04 & 05 (Restaurant profile dashboard + Admin v2 look & feel / PWA)

_Last updated: 2026-07-11. Branch `feat/brief-04-05`, stacked on the demo trunk `feat/monorepo-import` (`3a7eef7`). **Local-only — not yet pushed.**_

Companion to `docs/HANDOVER-rest-intelligence.md` (the prior release). This covers the
two admin-shell briefs plus a content-engine infra fix that landed on the same branch.

---

## 1. TL;DR

- **Brief 04** — a "Restaurant Details" page in the v2 admin shell where an OWNER
  maintains their restaurant's profile (basics, address, legal, branding, hours),
  with logo/cover image uploads stored in **Mongo GridFS**.
- **Brief 05** — the v2 admin shell now **looks and feels like a real app** on phone
  and desktop, and is an **installable PWA**. UI-only, no new endpoints.
- **Bonus** — the pre-existing `content-engine` red (missing `media-catalog`) was fixed
  on this branch, so a future push can drop `--no-verify`.

Gates at completion: **web 602** (baseline was 591 → 584 → 550), **storefront 34**,
**api 916 (+1 skip)** — all green. `turbo build` + `type-check` fully green (content-engine included).

---

## 2. Commit stack (on `feat/brief-04-05`, over trunk `3a7eef7`)

| Commit | Title |
|---|---|
| `7f406f7` | test(web),docs: Brief 05 — look & feel + PWA tests, changelog |
| `94f387f` | feat(web): Brief 05 item 3 — installable PWA for the v2 admin shell |
| `b83c636` | feat(web): Brief 05 items 8/11 — dashboard quick actions + area chart |
| `7f882af` | feat(web): Brief 05 items 1/5/6/10 — bottom bar, hero, identity, icon nav |
| `5157e25` | feat(web): Brief 05 items 2/4/7/9 — app-feel primitives + motion |
| `5584166` | feat(web): Brief 05 item 5 — inline SVG icon set |
| `3b07e4b` | fix(content-engine): track media-catalog metadata (force-add past assets/ ignore) |
| `0dcbbbf` | docs: Brief 04 — changelog, api-reference, GridFS/GC NEXT seams |
| `913d0ce` | feat(web): Brief 04 — Restaurant Details page, hours reuse, onboarding wiring |
| `495394a` | feat(web): Brief 04 — restaurant profile client + demo twin + fixtures |
| `860c49e` | feat(api): Brief 04 — profile routes + GridFS asset upload/serve |
| `ab4e35a` | feat(db): Brief 04 — GridFS asset store + [SAMPLE] profile seeds |
| `7381ecc` | feat(shared): Brief 04 — restaurant profile types + whitelist |

---

## 3. Brief 04 — Restaurant profile dashboard

Brief file: `restropulse-actionables/briefs/04-restaurant-profile-dashboard.md`.
Depends on Brief 03 collections (already shipped).

### Layers
- **shared** (`7381ecc`): `RestaurantAddress`, additive optional `Restaurant` fields
  (legal/display name, cuisine tags, address, phone, email, GSTIN, FSSAI), single-source
  `RESTAURANT_PROFILE_FIELDS` + `RestaurantProfilePatch` whitelist.
- **db** (`ab4e35a`): `packages/db/src/assets.ts` — GridFS asset store (bucket `assets`,
  rides `MONGODB_URI`, zero new infra); `[SAMPLE]` profile values on the demo restaurant.
- **api** (`860c49e`): `GET/PATCH /api/restaurant/profile` (pincode + GSTIN format
  validation, partial updates); `POST /api/restaurant/assets` (multipart, OWNER, images only,
  ≤5 MB, ext+MIME validated); `GET /api/assets/:id` (cache headers). Behind an
  `AssetStore { put, openDownload }` seam for a future Azure Blob swap.
- **clients** (`495394a`): `restaurantAPI.getProfile()`, `.updateProfile(patch)`,
  `.uploadAsset(file, kind)` in `apps/web/api.ts` + compiler-typed demo twin (demo upload =
  `URL.createObjectURL`, no network) + fixtures.
- **UI** (`913d0ce`): `apps/web/components/v2/RestaurantDetailsV2.tsx` — sections Basics ·
  Address & Contact · Legal · Branding (logo/cover upload + preview) · Hours. Added a new
  `PROFILE` bucket to `ShellV2` nav; wired onboarding step-1 (`computeOnboardingProgress`).
  Hours editor extracted to a shared `HoursEditor.tsx` reused from the storefront-content
  editor (single source = `storefront_content` draft; "Saved to draft — publish to go live").

### Key assumptions
- **GridFS** for assets (zero new infra); Azure Blob swap + orphan-asset GC recorded in
  `docs/NEXT.md §11`. No new env vars.
- GSTIN/FSSAI are **format-validated only** (regex), not checksum-verified.
- Public-route sanitizer strips only `instagramCredentials` + `razorpayCustomerId`;
  `integrations`/`instagramConnection`/`accountManager` are **retained** (v1 reads them
  non-optionally — stripping would crash existing users).

---

## 4. Brief 05 — Admin v2 look & feel + installable PWA

Brief file: `restropulse-actionables/briefs/05-admin-v2-look-and-feel.md`.
Target demo: `restropulse-actionables/admin-v2-sample-demo.html`. **UI-only, no endpoints.**

### What changed
- **New** `apps/web/components/v2/icons.tsx` — inline stroke SVG icon set (`currentColor`) +
  `BUCKET_ACCENT` (one accent tint per bucket), replacing emoji in the sidebar.
- **`ShellV2.tsx`** — mobile **bottom tab bar** below `md` (`env(safe-area-inset-bottom)`),
  time-aware **greeting hero** (the one permitted emoji 👋 + live store-status pill), sidebar
  **restaurant-identity tile** (logo/initial + name), icon-based nav. Secondary items
  (Restaurant Details, Get started) stay in the drawer.
- **`DashboardV2.tsx`** — **skeleton loading** + count-up numbers (no more `0`/`₹0` flash),
  **quick-actions row** (3 one-tap deep-links via the shell's existing `onNavigate`),
  **gradient area chart** (hand-rolled SVG, day labels, hover tooltip, highlight-today),
  empty state with a CTA.
- **`primitives.tsx`** — new `Skeleton`, `AnimatedNumber`, richer `StatCard` (icon chip,
  hover lift, 7-day micro-sparkline), `EmptyState`.
- **`index.css`** — v2 motion/skeleton keyframes, momentum scroll, `prefers-reduced-motion` guard.
- **PWA** — `vite-plugin-pwa@^1.3.0` in `vite.config.ts`, **gated on `VITE_ADMIN_SHELL=v2`**;
  `index.html` v2 theme-color/apple-touch injection; on-brand PNG icons in `apps/web/public/`
  (192/512/maskable/apple-touch/favicon).

### PWA behavior (verified against a real demo build under base `/restropulse-v2/admin-v2/`)
- Emits `manifest.webmanifest` (scope + start_url = `/restropulse-v2/admin-v2/`,
  `theme_color #221833`, `background_color #FAF8FF`, standalone, 192/512/maskable),
  `sw.js` + `registerSW.js` + workbox, manifest link injected with the base path.
- Service worker: **NetworkFirst for `/api/*`** (5 s timeout, 5 min TTL, GET-only so POST is
  never cached), precache app shell, `navigateFallback → index.html` (offline shell — no white screen).
- **Flag unset (default v1 build): emits NO manifest/SW**, keeps the old theme color and the
  SW-unregister path — byte-identical for existing users. Demo mode renders with zero backend.
- Raw hex appears ONLY in manifest/config (brief-permitted); components stay tokens-only.

### Key assumptions
- Store-status pill is **read-only** (a toggle would need a new endpoint = out of scope).
- Bottom bar carries the **5 primary buckets** (Home/Content/Ordering/Insights/Design);
  Restaurant Details + Get started stay in the drawer.
- Quick-actions use the shell's **state navigation** (no router exists in the codebase).
- Per-KPI sparklines derive from real order/reservation/post timestamps (`Post` has no
  `createdAt` → uses `scheduledFor ?? postedAt`).

---

## 5. content-engine fix (`3b07e4b`)

The long-standing red: `apps/content-engine/src/assets/media-catalog.ts` was real source
wrongly caught by the broad `assets/` rule in `apps/content-engine/.gitignore`. This commit
**force-adds the catalog metadata** past the ignore, so `turbo build` + `type-check` are now
fully green (content-engine included). **Consequence:** a future push of this branch can use a
normal `git push` — no `--no-verify` needed (the earlier release needed it only because of this).
Confirm the `.gitignore` still ignores the downloaded binaries (jpgs/videos), just not the `.ts`.

---

## 6. How to run / verify

```bash
# demo-only — full v2 shell + Restaurant Details + PWA, zero backend
cd apps/web && VITE_DEMO_MODE=true VITE_ADMIN_SHELL=v2 npx vite dev

# real PWA build (emits manifest + SW under the admin-v2 base)
cd apps/web && VITE_ADMIN_SHELL=v2 npx vite build --base=/restropulse-v2/admin-v2/

# gates (all green at handoff)
npx turbo build --filter=!@restropulse/db-cli
npx turbo type-check
npx turbo test --filter=@restropulse/web --filter=@restropulse/storefront --filter=@restropulse/api
```

---

## 7. Open items

1. **Not pushed.** `feat/brief-04-05` is local-only. To ship: fast-forward-merge into
   `feat/monorepo-import` and push → `deploy-demo-pages` publishes to gh-pages `/admin-v2/`.
   (The Bash safety classifier blocks the agent from pushing — owner runs it.)
2. **Manual PR gates the brief requires** (can't be produced headless): Lighthouse
   "installable" run against a served build; phone-width screenshots (bottom tabs,
   skeleton→data, hero at 380px); contrast check on new surfaces.
3. **Pre-existing (not from these briefs):** `@restropulse/web` has test-file tsc errors
   (`Post.createdAt` in `ContentEngineV2.tsx` + a test) that pre-date this work and are outside
   the type-check graph — worth a cleanup pass.
4. **Azure Blob asset swap + orphan-asset GC** — seams documented in `docs/NEXT.md §11`.

---

## 8. Status of the overall actionables (all 5 briefs + Intelligence)

| Brief | State |
|---|---|
| 01 upstream import | ✅ shipped (demo trunk) |
| 02 payment page | ✅ shipped |
| 03 mongodb touchpoints | ✅ shipped |
| Rest Intelligence (PR1–4) | ✅ shipped + deployed |
| 04 restaurant profile dashboard | ✅ built, committed on `feat/brief-04-05` (unpushed) |
| 05 admin v2 look & feel + PWA | ✅ built, committed on `feat/brief-04-05` (unpushed) |

All five briefs + the Intelligence module are now built. Briefs 04 & 05 await push/deploy.
