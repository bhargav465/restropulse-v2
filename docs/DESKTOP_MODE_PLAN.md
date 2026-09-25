# Desktop-Responsive Mode — Implementation Plan (apps/web)

Status: PLANNING ONLY. No source changed by this doc.

## Goal

Add adaptive desktop-responsive support to `apps/web`: keep the existing mobile
layout at small widths; add a **desktop sidebar shell** at wider widths. One
responsive codebase, existing page components reused as-is. Modeled on the
reference shell, but keeping **our** sections (Dashboard, Content Studio,
Inputs, Strategy, Profile) — no tabbed "Content Engine" grouping.

## Decisions locked (from brief)

- Adaptive responsive, not a separate desktop app or rewrite.
- Keep our current `ViewState` sections; present them in a desktop sidebar.
- Theme via `document.documentElement.dataset.theme` (`legacy` | `orchid-admin`)
  using the existing `--rp-*` CSS vars (`--rp-sidebar`, `--rp-sidebar-ink`, …).
- Out of scope: Online Ordering, Restaurant Intelligence, Website Design,
  "Get Started" (reference-only product areas — ignore).

---

## 1. Gap Analysis — what is mobile-locked today

| Location | Current state | Why it blocks desktop |
|----------|---------------|-----------------------|
| `index.css` `html, body { overflow: hidden; height: 100% }` | Hard viewport lock; only `#root` scrolls | Assumes a single phone-height scroll column; no room for a fixed side rail + independently scrolling main pane |
| `index.css` `body { padding: env(safe-area-inset-*) }` | Safe-area insets applied globally on `body` | Desktop has no notch/home-bar; insets waste edge space and are meaningless at wide widths |
| `components/Layout.tsx` | Flex **column**: sticky header (`h-16`) + `<main>` + `fixed bottom-0` bottom nav (4 items) | Column-only chrome; bottom tab bar is the *only* nav. No side rail, no wide-screen structure |
| `Layout.tsx` `<main class="pb-20">` | Bottom padding reserves space for the fixed bottom nav | On desktop the bottom nav is gone; padding is dead space |
| In-scope pages (`Dashboard`, `ContentStudio`, `Inputs`, `Strategy`) | Outer wrapper `className="p-4 space-y-*"`, **no `max-width`** | Content stretches edge-to-edge on wide monitors — long line lengths, oversized cards, sparse calendar |
| `Dashboard.tsx` | Single-column stacked stat cards / lists | Looks empty and stretched on desktop; wants a multi-column grid + capped width |
| `ContentStudio.tsx` | Phone-width calendar/post cards | Calendar and post gallery read as a narrow phone column centered/stretched on desktop |
| Nav color styling | `Layout` uses hardcoded `text-orange-600` / `bg-white` / `text-slate-400`; theming happens via `index.css` legacy-utility remaps | The reference sidebar relies on semantic tokens (`bg-sidebar`, `text-sidebar-ink`) that **do not exist** in our Tailwind config — see §6 |

`ProfileSheet.tsx` is **already responsive** (`fixed inset-0`, `items-end
sm:items-center`, `max-w-md`, `rounded-t-3xl sm:rounded-3xl`) — bottom-sheet on
mobile, centered dialog on desktop. It is an App-level overlay, not routed, and
needs **no** layout change. "Profile" becomes a sidebar nav item that calls the
existing `onProfileOpen`.

---

## 2. Target Desktop Layout (distilled from the reference shell)

The reference shell uses a two-region flex-row (`flex h-screen`): a `w-64`
(`256px`) aubergine `<aside>` rail + a `flex-1 overflow-y-auto` `<main>`, with a
centered `max-w-[1100px]` content column and `px-4 sm:px-6 md:px-8` responsive
gutters. Below `md` it collapses the rail into an off-canvas drawer + a mobile
top bar + a bottom tab bar.

**Our adaptation (simpler — reuse the existing mobile shell verbatim):**

```
lg+  (>=1024px)                  below lg  (<1024px) — UNCHANGED from today
+----------+-------------------+  +-----------------------------+
| Sidebar  |  Sticky top bar   |  |  Sticky header (h-16)       |
| (aside)  +-------------------+  +-----------------------------+
| w-64     |  <main> scrolls   |  |  <main> scrolls (pb-20)     |
| nav      |  max-w-[1100px]   |  |                             |
| items    |  centered column  |  |                             |
| profile  |                   |  +-----------------------------+
+----------+-------------------+  |  Fixed bottom nav (4 items) |
                                  +-----------------------------+
```

- **Breakpoint (recommended): `lg` (1024px).** Sidebar shows at `lg:` and up;
  the current mobile header + bottom nav show below `lg` (`lg:hidden`).
  Rationale: ContentStudio's calendar and Dashboard grids want real width;
  tablet-portrait (768–1023px) is better served by the roomy mobile column than
  a cramped rail+content split. (the reference used `md`; `md` is the fallback option if we
  later want the sidebar on tablets — it is a one-token change.)
- **No off-canvas drawer.** Because we keep the existing bottom nav intact below
  `lg`, we do **not** need the reference's hamburger drawer/backdrop/Escape machinery. This
  removes a whole slice of complexity and keeps mobile byte-identical.
- **Sidebar structure** (`<aside class="hidden lg:flex w-64 shrink-0 flex-col">`):
  wordmark/brand → restaurant identity tile (logo or gradient initial) → `<nav>`
  of section items (Dashboard, Content Studio, Inputs*, Strategy) → Profile /
  avatar button pinned near the bottom. *Inputs respects
  `featureFlags.updatesSection` exactly like the bottom nav does today.
- **Desktop top bar** (inside `<main>`, `hidden lg:flex`): thin bar carrying the
  page title, the `Create post` action (STUDIO only, same gating as today), the
  notifications bell + badge, and the profile avatar. Mirrors the mobile
  header's right-side actions so no action is lost on desktop.
- **Main content region**: `<main class="flex-1 overflow-y-auto">` with an inner
  `mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8` wrapper so pages are centered and
  width-capped on desktop while unchanged on mobile.
- Stack: Tailwind v4 (`@import "tailwindcss"` + `@theme`) and `lucide-react`
  icons (already used by `Layout`: `Home, PenTool, Lightbulb, Megaphone, Plus, Bell`).

---

## 3. Component Changes

**Settled approach: extend `Layout.tsx` (single responsive shell) + extract a
presentational `Sidebar.tsx` subcomponent.** Chosen over "new top-level shell"
because it keeps `App.tsx` wiring **identical** (`<Layout>{renderView()}</Layout>`
stays), localizes all desktop chrome, and reuses the existing `NavItem`
semantics + `aria-current`.

- **`Layout.tsx`** becomes the responsive shell:
  - Keep today's markup, but wrap the header + bottom nav in `lg:hidden`.
  - Add `<Sidebar … class="hidden lg:flex" />` as the first flex child; change
    the root from `flex-col` to a responsive `flex-col lg:flex-row`.
  - Add a desktop-only top bar (`hidden lg:flex`) inside the content region for
    title + actions (Create post / bell / avatar), reusing the existing handlers
    (`onCreatePost`, `onProfileOpen`, `pendingCount`).
  - Wrap `{children}` in the centered `max-w-[1100px]` container; make `pb-20`
    (bottom-nav clearance) `lg:pb-8` so desktop drops the reserved gap.
- **`Sidebar.tsx`** (new, presentational): receives the same props Layout
  already has (`currentView`, `setView`, `restaurantName`, `userInitials`,
  `pendingCount`, `onCreatePost`, `onProfileOpen`, `featureFlags`). Renders the
  brand, identity tile, a single `<nav aria-label="Main navigation">` of section
  buttons (reusing `NavItem` semantics: `aria-current={isActive ? 'page' :
  undefined}`, `lucide-react` icon, active/idle styling), and a Profile button.
  Each `ViewState` maps to one nav item:

  | ViewState | Label | Icon (lucide) |
  |-----------|-------|---------------|
  | `DASHBOARD` | Dashboard | `Home` |
  | `STUDIO` | Content Studio | `PenTool` |
  | `INPUTS` | Updates | `Megaphone` (gated by `featureFlags.updatesSection`, "Soon" when off — same rule as bottom nav) |
  | `STRATEGY` | Strategy | `Lightbulb` |
  | (action) | Profile | avatar → `onProfileOpen` |

- **`App.tsx`**: no structural change. The single `<Layout>` branch already
  passes every prop Sidebar needs. (Do **not** replicate the reference's `VITE_ADMIN_SHELL`
  fork — this is one responsive shell, always on.)

---

## 4. CSS Changes (`index.css`)

- **Relax the viewport lock for desktop only.** Keep the mobile no-bounce lock;
  release it at `lg` so the desktop shell can own its own scroll:
  ```css
  @media (min-width: 1024px) {
    html, body { overflow: auto; }         /* let the shell manage scroll */
  }
  ```
  (Alternatively keep `html,body` locked and let `<main class="overflow-y-auto">`
  scroll — pick one; the media-query relax is simplest and least regression-prone.)
- **Scope safe-area insets to mobile.** Move the `body { padding: env(safe-area-inset-*) }`
  under a `@media (max-width: 1023px)` block (or zero the insets at `lg+`) so
  desktop edges aren't padded by phantom notches.
- **Main-content**: centering/width cap done in markup
  (`mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8`), not new CSS.
- **Sidebar theming — vars only (see §6).** Sidebar background/ink read strictly
  from `--rp-sidebar` / `--rp-sidebar-ink`; no per-theme selectors in markup.
- Reuse existing `.no-scrollbar` for the sidebar's own overflow if it scrolls.

---

## 5. Per-Page Responsiveness

The shell supplies the centered `max-w-[1100px]` container, which fixes most
"stretched" cases for free. Page-local tweaks (additive `lg:` classes only,
mobile markup untouched):

- **`Dashboard.tsx`** — the stat cards / summary list are single-column
  (`space-y-*`). Add `lg:grid lg:grid-cols-2` (or `xl:grid-cols-3`) so KPI/stat
  cards form a grid on desktop instead of a tall stack. Keep the mobile stack.
- **`ContentStudio.tsx`** — the calendar + post gallery is phone-width. On
  desktop, let it breathe within the capped column; where posts render as a
  vertical list, add `lg:grid lg:grid-cols-2` for the post gallery so the
  calendar/gallery fills the wider column rather than a lonely center strip.
- **`Inputs.tsx`, `Strategy.tsx`** — mostly forms/sections; the shell's
  max-width cap is sufficient. Optional: `lg:grid-cols-2` for card rows. Low
  priority.
- **`ProfileSheet.tsx`** — already responsive; no change.

No page's *mobile* classes change — only additive `lg:`/`xl:` utilities.

---

## 6. Theme Integration (critical nuance)

The reference shell styles the rail with **semantic Tailwind color utilities**
(`bg-sidebar`, `text-sidebar-ink`, `bg-canvas`, `text-ink`, `text-muted`,
`border-line`, `bg-primary`). Those utilities exist in the reference only because the reference's
`index.css` declares them in a `@theme { --color-sidebar: … }` block. **Our
`apps/web/index.css` has no such `@theme` block** — it defines `--rp-*` CSS vars
and remaps legacy `slate/orange` utilities for `orchid-admin`. So a naive copy
of the reference's class names would render an **unstyled/transparent** sidebar.

Resolution — bridge our vars into Tailwind utilities (recommended):

```css
@theme {
  --color-sidebar: var(--rp-sidebar);
  --color-sidebar-ink: var(--rp-sidebar-ink);
  /* optionally: --color-canvas, --color-surface, --color-ink, --color-muted,
     --color-line, --color-primary → var(--rp-*) for shared reuse */
}
```

Then `bg-sidebar` / `text-sidebar-ink` resolve to `var(--rp-sidebar)` /
`var(--rp-sidebar-ink)`, which the `data-theme` switch already recolors for
`legacy` (`#ffffff` / `#64748b`) and `orchid-admin` (`#221833` / `#cfc4e6`).
**One markup, both themes, zero per-theme forks.**

- Fallback if we avoid `@theme`: use arbitrary values directly —
  `bg-[var(--rp-sidebar)]`, `text-[var(--rp-sidebar-ink)]`. Works identically;
  slightly noisier markup.
- Active-item accent should use `--rp-primary` (via `bg-primary`/`text-primary`
  or `var(--rp-primary)`), not a hardcoded orange, so it tracks both themes.
- **Contrast check**: `legacy` sidebar is white (`--rp-sidebar #ffffff`) — a
  light rail; ensure the active/idle ink and a right border read against white.
  `orchid-admin` is dark aubergine — ensure ink/hover states read against dark.
  Verify both in §7.

---

## 7. Risk & Impact

- **`tests/Layout.test.tsx` will break** (highest risk). It asserts:
  - `screen.getByRole('navigation')` — singular; adding the sidebar `<nav>`
    makes this match **two** navs → `getByRole` throws. Must scope by
    `aria-label` (bottom nav vs "Main navigation").
  - `getByText('Home' | 'Studio' | 'Strategy' | 'Updates')` — these labels now
    appear in **both** sidebar and bottom nav (jsdom renders both regardless of
    the `lg:hidden` media query, since it doesn't evaluate viewport). Ambiguous
    matches will throw. Tests must use `getAllByText` or scope within the
    relevant nav landmark.
  - Plan to update `Layout.test.tsx` alongside the change and add a
    `Sidebar.test.tsx` (renders section items, `aria-current` on active, click →
    `setView`, Profile → `onProfileOpen`, Updates gating).
- **CSS scroll regression**: relaxing `html,body{overflow:hidden}` risks the iOS
  rubber-band/no-bounce behavior on mobile. Mitigate by gating the relax behind
  `@media (min-width:1024px)` only; leave mobile lock intact.
- **Theme/utility gap** (§6): forgetting the `@theme` bridge → transparent
  sidebar. Explicitly a phase-1 task with a both-themes visual check.
- **Accessibility**: two nav landmarks (bottom nav + sidebar) must each carry a
  distinct `aria-label` ("Primary" / "Main navigation"); active item uses
  `aria-current="page"`; icons `aria-hidden`. One `<main>` region.
- **No backend/API changes.** Confirmed: this is layout/CSS only. No new
  endpoints, env vars, `ViewState`s, or shared types. `App.tsx` data flow,
  routing, and handlers are untouched.

---

## 8. Phased Task Breakdown (each independently shippable)

| # | Phase | Scope | Effort |
|---|-------|-------|--------|
| 1 | **Theme bridge + CSS relax** | Add `@theme` var bridge (`--color-sidebar`/`-ink`, §6); gate `html,body` overflow relax + safe-area insets to `lg`. No visible mobile change. Verify both themes' vars resolve. | S |
| 2 | **Sidebar component** | Build `Sidebar.tsx` (brand, identity tile, section `<nav>` reusing NavItem semantics + `aria-current`, Updates gating, Profile). Themed via vars. Ships behind `lg:` but inert until wired. Add `Sidebar.test.tsx`. | M |
| 3 | **Responsive Layout shell** | Wrap current header+bottom-nav in `lg:hidden`; root `flex-col lg:flex-row`; mount Sidebar (`hidden lg:flex`); add desktop top bar (title + Create/bell/avatar); center content `max-w-[1100px]`; `pb-20 lg:pb-8`. Update `Layout.test.tsx` (scope nav landmarks, `getAllByText`). | M |
| 4 | **Per-page desktop grids** | `Dashboard` KPI/stat grid (`lg:grid-cols-2/3`); `ContentStudio` calendar/gallery `lg:grid-cols-2`; optional `Inputs`/`Strategy` two-column. Additive `lg:` only. | M |
| 5 | **Polish + a11y + cross-theme QA** | Verify legacy (light rail) vs orchid-admin (dark rail) contrast; landmark labels; focus/hover states; sidebar own-scroll `.no-scrollbar`; regression pass on mobile (bottom nav unchanged). | S |

Total: **5 phases** (S, M, M, M, S).

---

## 9. Out of Scope (restated)

- **Online Ordering** (`Ordering` / any `ordering` dir)
- **Restaurant Intelligence** (`IntelligenceDashboard`, `components/intelligence/sections/**`)
- **Website Design** (`WebsiteDesign`)
- **"Get Started"** onboarding bucket (`GetStarted`)
- the reference's tabbed **"Content Engine"** grouping (we keep our discrete sections)
- the reference's `VITE_ADMIN_SHELL` build fork (we ship one always-on responsive shell)
