# RestroPulse v2 — project memory for Claude Code

Before doing anything, load the engineering skill at
`.claude/skills/restropulse-engineering/SKILL.md` and read the reference file
for whatever you're touching (`references/design.md`, `api-reference.md`,
`infra.md`). Full current state is in
`.claude/skills/restropulse-engineering/HANDOVER.md` and `docs/ORCHESTRATOR.md`.

Working trunk: feat/monorepo-import. The Electric Lavender v2 redesign is live;
it's also split into 3 stacked PRs into `main`
(feat/lavender-design-system → feat/admin-dashboard → feat/onboarding-checklist).

Follow the five safety rules in SKILL.md §4. Gates before every commit:
`npx turbo build --filter=!@restropulse/db-cli`, `npx turbo type-check`,
`cd apps/web && npx vitest run` (expect 550 passing). Conventional commits.
