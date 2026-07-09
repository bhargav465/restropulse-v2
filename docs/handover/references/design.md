# RestroPulse Design Reference

Read this before touching any UI. Two parts: the **current base** (what's
live) and the **target state** (approved future changes, including the palette
change to **Electric Lavender**). When they conflict, build toward the target.

---

## 1. Current base (live today)

**Layout DNA** (from the owner's approved reference mock):
- Dark sidebar rail, fixed left, full height; wordmark "Restro**pulse**" with
  accent on "pulse"; nav items with icon + bold label; active item highlighted.
- Light content area; white rounded-2xl cards; page header = big bold title +
  muted subtitle; top-right chip with the restaurant name; DEMO badge.
- KPI stat cards (muted label, big number, green delta), dark "steps" banner
  with numbered circles, emoji action cards.

**Current (v1 of the v2 shell) colors — being replaced, do not extend:**
coral `#e8674a` primary, navy `#1b2230` sidebar, `#f1f3f7` background,
green pills for deltas, peach chips.

**Where design lives in code:**
- Shell + buckets: `apps/web/components/v2/` (`ShellV2.tsx`, bucket pages,
  `primitives.tsx` — StatCard, ActionCard, SubNav, StepsBanner).
- Tokens: `apps/web/components/v2/theme.ts` (to be created in the design pass).
- Storefront theme comes from data: `storefront_content.theme`
  (colors/logo — owner-editable via admin Site Content editor).
- Menu/gallery placeholder imagery: per-category placehold.co palettes in
  `packages/db/src/seeds/ordering-demo.ts` + each app's `lib/demo-fixtures.ts`.
- Hero video placeholder: `apps/storefront/public/media/hero-demo.mp4`
  (ffmpeg-generated, bundled — keep deployments free of external media hosts).

**Owner's standing critique of the current UI:** cluttered. Too many emojis,
too many pill buttons, too many competing colors.

---

## 2. Target palette — ELECTRIC LAVENDER (approved change)

The coral palette is retired. All new/updated UI uses these tokens. Define
them once in `apps/web/components/v2/theme.ts` (and as CSS variables if you
need them outside Tailwind classes); never hard-code hex values in components.

### Core tokens

| Token | Hex | Usage |
|---|---|---|
| `primary` (Electric Lavender) | `#B57EDC` | THE accent: active nav, primary buttons, key numbers, links. Use sparingly — it should mark at most ~5% of any screen. |
| `primary-strong` | `#9D4EDD` | Hover/pressed states of primary, filled button gradients end |
| `primary-soft` | `#EBDCFB` | Selected-item backgrounds, chips, progress track fills |
| `bg` | `#FAF8FF` | App background (lavender-tinted off-white) |
| `surface` | `#FFFFFF` | Cards, panels |
| `ink` | `#241B35` | Primary text (deep violet-black) |
| `muted` | `#6E6588` | Secondary text, labels (warm gray-violet) |
| `border` | `#EAE4F2` | 1px card/dividers — prefer borders over shadows |
| `sidebar` | `#221833` | Dark rail (deep aubergine) |
| `sidebar-ink` | `#CFC4E6` | Sidebar inactive text |

### Support colors

| Token | Hex | Usage |
|---|---|---|
| `success` | `#2FB37F` | Positive deltas, confirmations, "Open" state |
| `warning` | `#E9A23B` | Pending review, draft-not-published |
| `danger` | `#E05B72` | Destructive actions, declines, "Closed" |
| `info` / periwinkle | `#8B9CF7` | Secondary accent: informational banners, links inside dark surfaces, chart series #2 |
| `orchid` | `#D98BF0` | Chart series #3, decorative gradients only |

Gradient (hero banners, primary CTA hover): `#9D4EDD → #B57EDC → #8B9CF7`,
135°. Dark banner surfaces: `#2A1E3F` with `primary-soft` text accents.

**Accessibility rules:** body text is always `ink` on `bg`/`surface` (≥ 12.5:1).
`primary` on white passes only for large text/graphics — for normal-size text
on lavender fills, use white text on `primary-strong`. Never `muted` on
`primary-soft`. Check with any WCAG AA contrast tool before merging.

### Storefront note
The storefront's palette is **per-restaurant data**, not code. Update only the
DEMO restaurant's theme (seeds + fixtures) to the lavender set so demos match
the brand; real restaurants keep their own colors. Menu-category placeholder
palettes may stay warm (food should look like food) — that is intentional.

---

## 3. Declutter rules (apply with the recolor — same PR)

1. One emoji per sidebar bucket, max. None in KPI labels, sub-nav, buttons.
2. Sub-navigation = quiet underline tabs, not pill buttons.
3. KPI cards: number first (28px semibold `ink`), 12px uppercase tracked
   `muted` label above, delta as small colored text — no pills, no emoji.
4. Max content width 1100px, centered. 24px vertical rhythm between sections.
5. One shadow level (subtle, on hover only); rest is 1px `border`.
6. Sidebar: remove subtitle lines under nav items (title attr instead);
   active item = 3px `primary` left-edge bar + `primary-soft`-at-10% bg,
   not a full solid block.
7. Typographic scale: page title 28/semibold, section 16/semibold, body 14,
   labels 12 uppercase tracked. Nothing else.

---

## 4. Future design work (in priority order)

1. **Apply §2 + §3** to the v2 shell: create `theme.ts` (tokens),
   restyle ShellV2 + bucket pages + primitives. (A first attempt existed but
   was lost uncommitted — rebuild from this spec, lavender not coral.)
2. **Dashboard bucket** (default landing): 4 KPIs, "Today" panel, 7-day CSS
   sparkline, "Needs attention" list. All data from existing demo APIs.
3. **Onboarding page**: 5-step checklist (profile → Instagram → menu →
   storefront → first campaign) with progress chip in sidebar; completion
   computed from data; dismissal in localStorage.
4. **Campaign ROI visuals**: per-campaign "sent → redeemed → revenue" row
   with a mini funnel bar (series colors: primary, info, orchid).
5. **Customers (guest 360)** list + detail drawer; "at-risk" badge in `warning`.
6. **Intelligence v1**: peak-hours heatmap (lavender intensity ramp
   `#EBDCFB → #9D4EDD`), repeat-rate and ROI trend cards.
7. **Template gallery** (Website Design bucket): template = content+theme
   preset, previewed with the restaurant's own menu (demo-fixture pattern).
8. **Mobile apps** (with the sub-repo split, `references/infra.md`): same
   tokens; dark-rail becomes bottom tab bar; respect platform conventions.

## 5. Definition of done for any UI change
Tokens only (no raw hex) · both shells still pass tests (549+) · demo bundles
rebuilt · screenshots in the PR (before/after) · contrast checked · docs/
ORCHESTRATOR.md changelog line added.
