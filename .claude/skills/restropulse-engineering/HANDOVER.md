# RestroPulse v2 — Complete Handover (current state)

_Last updated: 2026-07-09. Read this first, then the SKILL.md + the reference
for whatever you're touching._

This is a snapshot of exactly where the project stands so a new developer (human
or AI) can pick it up with zero prior context. Pair it with `SKILL.md` (the
working handover) and `references/` (deep dives).

---

## 1. What the product is

One platform for independent restaurants, combining three products competitors
sell separately: **Content Engine** (AI social posts + auto-publish),
**Online Ordering** (per-restaurant storefront, checkout, tracking,
reservations), and **Growth/CRM** (funnel analytics, cohorts, campaigns). Two
placeholder pillars: Restaurant Intelligence and Website Design.

Everything lives in one monorepo: `bhargav465/restropulse-v2` (npm workspaces +
Turborepo, React 19 + Vite 6 + Tailwind v4 front ends, Express 4 + MongoDB
back end, TypeScript throughout).

Live demos (static, sample data, any login works):
- Storefront — https://bhargav465.github.io/restropulse-v2/demo
- Admin v2  — https://bhargav465.github.io/restropulse-v2/admin-v2/
- Admin v1  — https://bhargav465.github.io/restropulse-v2/admin/

---

## 2. What just shipped — the Electric Lavender v2 redesign

The v2 admin shell was restyled from the retired coral palette to **Electric
Lavender**, decluttered per the owner's feedback, and given two new surfaces.
It is **merged on `feat/monorepo-import` (commit `456137d`) and deployed** to
the admin-v2 demo.

Delivered (design.md §4.1–4.3):
- **Design system** — `apps/web/components/v2/theme.ts` (token source of truth)
  + `@theme` block in `apps/web/index.css` exposing Tailwind utilities
  (`bg-primary`, `text-ink`, `border-line`, …). Restyled `ShellV2` (aubergine
  rail, 3px-primary active edge, one emoji per bucket, 1100px column),
  `primitives` (number-first KPI cards, underline sub-nav, text deltas, lavender
  banner), and recolored all four bucket pages. No raw hex in components; zero
  coral remaining.
- **Dashboard** (`DashboardV2.tsx`) — the new default landing bucket: 4 KPIs, a
  Today panel, a 7-day SVG sparkline, a Needs-attention list. Reads existing
  demo APIs only.
- **Onboarding** (`GetStartedV2.tsx` + `onboarding.ts`) — 5-step checklist
  (profile → Instagram → menu → storefront → first campaign), completion
  computed from data, sidebar progress chip, localStorage dismissal.

**Verification (all green):** web test suite **550 passing** (was 549 — the
design pass added 1), `vite build` clean, all lavender tokens confirmed present
in the emitted CSS. Pre-existing `tsc` warnings in `ContentEngineV2.tsx:202` and
`ContentStudio.test.tsx` are not from this work (the vitest suite is the real
gate).

One product decision, flagged: **Dashboard is now the default v2 bucket**
(design.md §4.2 calls it "default landing"); the ShellV2 smoke test was updated
to match. To revert, change the `useState<BucketV2>('DASHBOARD')` initial value
in `ShellV2.tsx`.

---

## 3. Branch & PR state (as of this handover)

On the remote `bhargav465/restropulse-v2`:

| Branch | Role | Tip |
|---|---|---|
| `feat/monorepo-import` | Working trunk; redesign merged + deployed | `456137d` |
| `main` | Created at the pre-redesign base as the PR target | `736aa0c` |
| `feat/lavender-design-system` | PR 1 → `main` (palette + declutter) | design-system commit |
| `feat/admin-dashboard` | PR 2 → `feat/lavender-design-system` (Dashboard) | +Dashboard |
| `feat/onboarding-checklist` | PR 3 → `feat/admin-dashboard` (Onboarding) | == `456137d` tree |
| `gh-pages` | Built demo bundles (auto-deployed) | — |

The redesign exists **twice on purpose**: already merged on
`feat/monorepo-import` (so the demo is live), and split into three **stacked**
review PRs into `main` (each PR scoped to one feature; merge order 1 → 2 → 3;
GitHub auto-retargets each onto `main` as the one below merges). The top branch's
tree is byte-identical to `456137d`, proving the split is faithful.

**Open PRs** (compare links; base ← head):
- `main` ← `feat/lavender-design-system`
- `feat/lavender-design-system` ← `feat/admin-dashboard`
- `feat/admin-dashboard` ← `feat/onboarding-checklist`

**Reconciliation note:** because the same code lives on `feat/monorepo-import`
AND is landing into `main` via the PRs, decide which branch is the long-term
trunk. Simplest: merge the three PRs into `main`, then fast-forward/rebase
`feat/monorepo-import` onto `main` (or retire it). This is a repo-governance
call for the owner.

---

## 4. Deliverable folders in this handover

Inside `~/Desktop/Restropulse/`:
- `restropulse-engineering-skill/` — **this skill** (SKILL.md + references +
  HANDOVER.md). Drop into `.claude/skills/` (see §6).
- `lavender-redesign/` — the single-commit form of the redesign: `.patch`,
  `.bundle`, raw `changed-files/`, `APPLY_INSTRUCTIONS.md`.
- `feature-prs/` — the split form: `feature-branches.bundle`,
  `push-and-open-prs.sh`, `README.md`.

---

## 5. How to run / verify locally

```bash
git clone https://github.com/bhargav465/restropulse-v2 && cd restropulse-v2
git checkout feat/monorepo-import
npm install
# demo mode needs no database:
cd apps/web && VITE_DEMO_MODE=true VITE_ADMIN_SHELL=v2 npx vite dev   # lavender admin
cd ../storefront && VITE_DEMO_MODE=true npx vite dev                  # storefront /demo
```
Gates before any commit (from repo root):
```bash
npx turbo build --filter=!@restropulse/db-cli
npx turbo type-check
cd apps/web && npx vitest run     # expect 550 passing
```

---

## 6. Using this as a Claude Code skill

This directory is a self-contained skill. To install it in the repo so Claude
Code auto-loads it:

```bash
# from the root of your restropulse-v2 clone
mkdir -p .claude/skills
cp -R ~/Desktop/Restropulse/restropulse-engineering-skill .claude/skills/restropulse-engineering
```

Claude Code discovers skills under `.claude/skills/*/SKILL.md` by the YAML
frontmatter (`name`, `description`). Once copied, ask Claude Code things like
"work on the RestroPulse admin dashboard" or "add Campaign ROI attribution" and
it will load this skill, then pull the right `references/*.md` for the task.

For a shareable/global install instead of per-repo, put the same directory under
your user skills folder (`~/.claude/skills/restropulse-engineering/`).

To keep it honest: any PR that changes routes, schema, tokens, or repo layout
must update the affected `references/*.md` in the **same PR**
(`references/skill-creator.md` rule 6). A stale skill is worse than none.

---

## 7. What's next (from SKILL.md §7)

1. Campaign ROI attribution (+ the ROI funnel visual, design.md §4.1)
2. Customers / guest-360 sub-tab (design.md §4.2)
3. Churn automation rules (worker loop, copy `apps/publisher`)
4. Intelligence v1 — heatmap + repeat-rate/ROI-trend cards (design.md §4.3)
5. Sub-repo split + mobile apps (read `references/infra.md` first)
6. Deferred seams in `docs/NEXT.md`: loyalty, QR tracking, reviews, real
   payments, WhatsApp delivery, template gallery.

Plus two small design follow-ups already scoped: the storefront DEMO theme
lavender recolor (design.md §4.5) and flipping the PWA `theme-color` meta tag
from orange to lavender.
