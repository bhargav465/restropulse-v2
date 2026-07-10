# RestroPulse Design Reference

Read this before touching any UI. Two parts: the **current base** (what's
live) and the **remaining design work**. The Electric Lavender palette and the
declutter rules are now the LIVE base — build on them, never reintroduce coral.

> **Status update (shipped):** the §2 palette + §3 declutter rules, the
> Dashboard landing bucket, and the Get-started onboarding checklist are all
> **live** on `feat/monorepo-import` (and split into review PRs — see
> `HANDOVER.md`). This file now documents them as the base, not as future work.

---

## 1. Current base (live today)

**Layout DNA** (from the owner's approved reference mock):
- Dark **aubergine** sidebar rail, fixed left, full height; wordmark
  "Restro**pulse**" with `primary` accent on "pulse"; nav items are one icon +
  bold label; active item = 3px `primary` left-edge bar + `primary`-at-10% bg.
- Light content area (`bg` canvas), white `surface` cards with 1px `border`
  lines (shadows only on hover); page header = 28px semibold title + muted
  subtitle; top-right chip with the restaurant name; DEMO badge.
- KPI stat cards are number-first (34px semibold `ink` on desktop, 24px below
  `sm` so long currency fits the 2-up mobile grid; 13px uppercase tracked
  `muted` label above, delta as 14px colored text — no pills, no emoji).
- Content column max-width 1100px, centered; 24px vertical rhythm.
- **Responsive (as of 2026-07-09):** the rail is static only at `md+`. Below
  `md` it collapses into an off-canvas drawer opened from a hamburger in a
  sticky aubergine top bar; a backdrop + Escape + close-icon dismiss it, and
  selecting any bucket closes it. Markup stays a single `<nav>` landmark in both
  modes (one accessible navigation). Content padding tightens to
  `px-4 sm:px-6 md:px-8` and the page title to `text-2xl sm:text-[28px]` on
  small screens. All in `ShellV2.tsx`; no new tokens.

**Live palette = ELECTRIC LAVENDER (§2).** The old coral/navy set is fully
retired; there is no coral anywhere in `apps/web/components/v2/`.

**Where design lives in code:**
- Tokens: `apps/web/components/v2/theme.ts` (source of truth) mirrored as
  Tailwind v4 utilities via the `@theme` block in `apps/web/index.css`.
- Shell + buckets: `apps/web/components/v2/` — `ShellV2.tsx`, `primitives.tsx`
  (StatCard, ActionCard, SubNav, StepsBanner, DeltaChip), bucket pages
  (`DashboardV2`, `ContentEngineV2`, `OrderingV2`, `IntelligenceV2`,
  `WebsiteDesignV2`), `GetStartedV2.tsx` + `onboarding.ts`.
- Storefront theme comes from data: `storefront_content.theme`
  (colors/logo — owner-editable via admin Site Content editor).
- Menu/gallery placeholder imagery: per-category placehold.co palettes in
  `packages/db/src/seeds/ordering-demo.ts` + each app's `lib/demo-fixtures.ts`.
- Hero video placeholder: `apps/storefront/public/media/hero-demo.mp4`.

**Owner's standing critique that shaped the base:** the old UI was cluttered —
too many emojis, pill buttons, competing colors. The §3 rules below are the
fix; keep applying them to every new surface.

---

## 2. Palette — ELECTRIC LAVENDER (the live token set)

All UI uses these tokens. They are defined once in
`apps/web/components/v2/theme.ts` and exposed as Tailwind classes (`bg-primary`,
`text-ink`, `border-line`, `bg-canvas`, `bg-sidebar`, `bg-banner`, …) via the
`@theme` block in `index.css`. **Never hard-code hex values in components.**

### Core tokens

| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `primary` (Electric Lavender) | `#B57EDC` | `*-primary` | THE accent: active nav, primary buttons, key numbers, links. ≤ ~5% of any screen. |
| `primary-strong` | `#9D4EDD` | `*-primary-strong` | Hover/pressed primary; filled-button text on lavender |
| `primary-soft` | `#EBDCFB` | `*-primary-soft` | Selected-item bg, chips, progress-track fills |
| `bg` | `#FAF8FF` | `bg-canvas` | App background (lavender-tinted off-white) |
| `surface` | `#FFFFFF` | `bg-surface` | Cards, panels |
| `ink` | `#241B35` | `text-ink` | Primary text (deep violet-black) |
| `muted` | `#6E6588` | `text-muted` | Secondary text, labels (warm gray-violet) |
| `border` | `#EAE4F2` | `border-line` | 1px card/dividers — prefer borders over shadows |
| `sidebar` | `#221833` | `bg-sidebar` | Dark rail (deep aubergine) |
| `sidebar-ink` | `#CFC4E6` | `text-sidebar-ink` | Sidebar inactive text |

### Support colors

| Token | Hex | Tailwind | Usage |
|---|---|---|---|
| `success` | `#2FB37F` | `*-success` | Positive deltas, confirmations, "Open" |
| `warning` | `#E9A23B` | `*-warning` | Pending review, draft-not-published, DEMO badge, at-risk |
| `danger` | `#E05B72` | `*-danger` | Destructive actions, declines, "Closed" |
| `info` / periwinkle | `#8B9CF7` | `*-info` | Secondary accent; chart series #2 |
| `orchid` | `#D98BF0` | `*-orchid` | Chart series #3, decorative gradients only |
| banner surface | `#2A1E3F` | `bg-banner` | Dark hero/steps banners (with `primary-soft` accents) |

Gradient (hero banners, primary CTA hover, profile avatar):
`GRADIENT` in theme.ts = `#9D4EDD → #B57EDC → #8B9CF7`, 135°.
Data-density ramp (heatmaps): `intensity(t)` in theme.ts, `primary-soft →
primary-strong`. Chart series order: `SERIES` = primary, info, orchid.

**Accessibility:** body text is always `ink` on `bg`/`surface` (≥ 12.5:1).
`primary` on white passes only for large text/graphics — for normal text on
lavender fills, use white on `primary-strong`. Never `muted` on `primary-soft`.

### Storefront note
The storefront's palette is **per-restaurant data**, not code. The DEMO
restaurant's theme recolor to lavender is **not yet done** (deferred — see §4).
Real restaurants keep their own colors. Menu-category placeholder palettes may
stay warm (food should look like food) — intentional.

---

## 3. Declutter rules (apply to every touched surface)

1. One emoji per sidebar bucket, max. None in KPI labels, sub-nav, buttons.
2. Sub-navigation = quiet underline tabs (`SubNav`), not pill buttons.
3. KPI cards: number first (34px semibold `ink`, 24px on mobile), 13px uppercase
   tracked `muted` label above, delta as 14px colored text — no pills, no emoji.
4. Max content width 1100px, centered. 24px vertical rhythm between sections.
5. One shadow level (subtle, on hover only); rest is 1px `border-line`.
6. Sidebar: no subtitle lines under nav items (title attr instead);
   active item = 3px `primary` left-edge bar + `primary`-at-10% bg.
7. Typographic scale (refreshed 2026-07-09, more generous for readability):
   page title 34/semibold (26 mobile), section heading 24/bold (20 mobile),
   body & row text 16, KPI value 34/semibold (24 mobile, so long ₹ values still
   fit the 2-up grid), uppercase labels 13/tracked, delta & meta 14. Nothing
   else — pick from this list, don't invent sizes.

---

## 4. Remaining design work (in priority order)

Items 1–3 from the original plan are **done** (palette+declutter, Dashboard,
Onboarding).

**Elegance refresh (2026-07-09):** `GetStartedV2` is now a soft-lavender
welcome hero — 👋 greeting + "Welcome, {restaurant}", a two-line display
heading, an inline lavender rocket illustration (`LaunchArt`, tokens only),
a big `X/N Completed` readout with a GRADIENT progress bar, and the checklist
on the right with the next incomplete step lifted into an elevated white card
(`ring-primary/25` + soft shadow); completed steps show a `success` check +
strikethrough. `DashboardV2` gained a "Your business at a glance ✨" section
intro, `rounded-3xl` panels, `primary-strong` accent labels (dot + uppercase),
divider rules in the Today panel, and a "Needs attention" list with a count
badge and lavender `Review` pills. Both stack cleanly on mobile. Data/logic
unchanged. What's left:

1. **Campaign ROI visuals**: per-campaign "sent → redeemed → revenue" row with
   a mini funnel bar (series colors: primary, info, orchid). Pairs with the
   Campaign ROI attribution backend (roadmap §7.2).
2. **Customers (guest 360)** list + detail drawer; "at-risk" badge in `warning`.
3. **Intelligence v1**: peak-hours heatmap (use `intensity()` ramp), repeat-rate
   and ROI-trend cards — replaces the current placeholder page.
4. **Template gallery** (Website Design bucket): template = content+theme
   preset, previewed with the restaurant's own menu (demo-fixture pattern).
5. **Storefront DEMO theme → lavender**: recolor only the demo restaurant's
   `theme` in seeds + fixtures so demos match the brand (real restaurants keep
   their own). Menu-category placeholders stay warm.
6. **Mobile apps** (with the sub-repo split, `references/infra.md` §2c): same
   tokens; dark rail becomes a bottom tab bar; platform conventions win.

## 5. Definition of done for any UI change
Tokens only (no raw hex) · both shells still pass tests (**web ≥ 550**) · demo
bundles rebuilt · screenshots in the PR (before/after) · contrast checked ·
`docs/ORCHESTRATOR.md` changelog line added.
