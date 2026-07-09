# Skill Creator — writing skills & agent contracts for RestroPulse

Read when: creating a new skill for AI-assisted work on this project, or
updating the main `SKILL.md`. This is how the founding runs were orchestrated;
keep the pattern and new developers (human or AI) stay productive.

---

## 1. Skill-authoring rules

1. **One skill = one job.** The main handover skill covers "work on this
   repo". Make separate skills only for genuinely separate jobs (e.g. a
   release-manager skill, a mobile-app skill after the split).
2. **SKILL.md stays under ~500 lines.** Past that, split into `references/`
   files and point to them from the main file **with explicit guidance on
   when to read each** (a "read this when…" table, like ours). An agent
   should never need to read everything to do one task.
3. **Frontmatter matters.** `name` + `description` decide when the skill
   triggers. Description = what it does + when to use it, with concrete
   trigger phrases ("admin dashboard", "storefront", "deploy demo").
4. **Facts over prose.** Tables, file paths, commands, exit criteria. A
   junior should be able to copy-paste their way to a green build.
5. **State the invariants loudly** (our five rules in SKILL.md §4). Repetition
   there is a feature — invariants are what agents violate first.
6. **Keep it current or kill it.** Any PR that changes routes, schema, tokens,
   or repo layout updates the affected reference in the SAME PR. A stale
   skill is worse than none.

## 2. Directory shape

```
restropulse-handover/
  SKILL.md                    < 500 lines, entry point, "when to read what"
  references/
    design.md                 palette/tokens/declutter/future design work
    infra.md                  environments, CI/CD, sub-repo + mobile plan
    api-reference.md          full route tables + client parity rules
    skill-creator.md          this file
```

## 3. The agent contract (paste into any AI coding session)

```markdown
# RestroPulse engineering agent

You are a senior full-stack engineer on RestroPulse. Before coding, read
SKILL.md (+ the reference file for your domain) in docs/handover/, and
docs/NEXT.md if touching a deferred-feature seam.

STACK (fixed): React 19 + Vite 6 + Tailwind SPA · Express 4 + TS · MongoDB
driver v6 · npm workspaces + Turborepo · React Native + Expo (mobile, after
the split). Do not introduce frameworks.

HARD RULES
1. Additive only — SaaS features and existing shells keep working; new
   behavior behind flags (VITE_DEMO_MODE, VITE_ADMIN_SHELL).
2. Demo parity — every new api.ts client method ships a demo-api.ts twin
   (typed `typeof realX`) the same day, with fixtures.
3. Data model first — shared types → db indexes/seeds → api routes →
   clients → UI. Never UI-first.
4. Sample data [SAMPLE]-marked, only in seeds/fixtures. No secrets in the
   repo, ever; .env.example documents each variable.
5. Design tokens only (Electric Lavender set, references/design.md §2);
   no raw hex in components; declutter rules apply to all touched UI.
6. Deferrals become docs/NEXT.md entries naming file + payload contract.
7. Gates before every commit: turbo build (--filter=!@restropulse/db-cli),
   turbo type-check, turbo test (web ≥549, storefront ≥31, api ordering
   suites green). Conventional commits. One logical change per commit.
8. Update docs (ORCHESTRATOR changelog; ARCHITECTURE if routes/schema
   changed; the relevant handover reference) in the same PR.
9. Report at the end: files changed, gate results, ASSUMPTION-labelled
   assumptions. Ask instead of guessing on product decisions.
10. After the sub-repo split: no cross-feature imports; features consume
    only published @restropulse/* packages; submodule pins bump via PR.
```

## 4. Task-brief template (how to hand work to an agent/junior)

```
CONTEXT: <one paragraph — which feature, which surface, link to reference>
TASK: <specific, with acceptance criteria a reviewer can check>
TOUCHES: <expected files/areas — from SKILL.md §8 index>
DO NOT: <known landmines, e.g. "don't restyle legacy component internals">
GATES: standard (rule 7) + <any task-specific check, e.g. screenshots>
REPORT: files, gates, assumptions
```

Split anything big along the layering (rule 3): one brief for
types+db+routes, one for clients+UI. Two small green runs beat one giant
red one.

## 5. Verifying an agent's work (reviewer checklist)

- [ ] Gates actually run (numbers in the report, not "should pass")
- [ ] Default builds unchanged when flags are off
- [ ] Demo twin exists for every new client method
- [ ] No raw hex / no secrets / no hard-coded sample data in components
- [ ] Docs updated in the same PR
- [ ] Live demo redeployed and eyeballed (CDN lag ≈ 10 min is normal)
