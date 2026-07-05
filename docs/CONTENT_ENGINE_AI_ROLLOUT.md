# Content Engine AI - Rollout Runbook

This runbook describes the rollout of the AI content generator behind a single master flag. Default behavior (placeholder generator) is the production fallback and never gets removed -- the flag is a permanent operational switch.

## Master flag

```
CONTENT_GENERATOR_BACKEND=placeholder   # default -- asset-catalog generator (current production)
CONTENT_GENERATOR_BACKEND=ai            # uber flag -- enables LLM + fal.ai + V1 calendar + V2 Sonar
```

When `CONTENT_GENERATOR_BACKEND=ai` is set, all four sub-features default-on:
- Anthropic Claude for cycle planning + caption generation
- fal.ai for image (Flux dev) + video (Kling 1.6) generation
- Google Calendar for India holiday hint injection (V1)
- Perplexity Sonar Pro for current-affairs hints (V2 -- daily refresh + per-post triggers)

All four require keys; the factory pre-validates them upfront and throws a single combined error listing every missing key (with override hints).

## Pre-flight

Before flipping the master flag in any environment:

1. Application Insights connection string is configured for the content-engine deployment slot (workbooks won't populate otherwise).
2. The two workbooks (`cost-by-restaurant`, `per-post-audit`) are imported into the Azure Portal under the App Insights resource. See `infra/workbooks/` for the JSON templates.
3. Cost ceilings are agreed with billing -- dashboards exist but alerts are operator's call.
4. All four required API keys are provisioned. See `docs/SECRETS.md` for step-by-step instructions on obtaining each key.

## Rollout -- two stages

### Stage 0: Default (placeholder, no AI)

```
CONTENT_GENERATOR_BACKEND=placeholder   # default
```

Behavior: the existing asset-catalog generator runs. No external AI calls. Zero per-call cost. This is what production runs today and what every rollback target should be.

### Stage 1: AI mode (everything on)

Set the master flag and all four required keys on the staging deployment first; observe the workbooks for 24 hours; then promote to production.

```
CONTENT_GENERATOR_BACKEND=ai
ANTHROPIC_API_KEY=<key>
FAL_API_KEY=<key>
GOOGLE_CALENDAR_API_KEY=<key>
PERPLEXITY_API_KEY=<key>
```

**What happens:**
- Cycles + captions via Anthropic Claude (Sonnet for cycles, Haiku for posts)
- Calendar V1 auto-injects holiday hints (free)
- Sonar V2 daily refresh + per-post triggers run (~$0.30-1/restaurant/month)
- IMAGE/STORY/CAROUSEL routes through fal.ai Flux dev (~$0.025/image)
- REEL/VIDEO submits to fal.ai queue (Kling 1.6, ~$0.30/clip); posts go to `PENDING_MEDIA` while the queue runs; the `media-job-poller` cron advances them to `PENDING_APPROVAL` on completion
- Per-call cost events written to MongoDB `costEvents` and Application Insights `customEvents` (queryable from the workbooks)

**Smoke check at boot:**

```bash
cd apps/content-engine && \
  CONTENT_GENERATOR_BACKEND=ai \
  ANTHROPIC_API_KEY=<key> \
  FAL_API_KEY=<key> \
  GOOGLE_CALENDAR_API_KEY=<key> \
  PERPLEXITY_API_KEY=<key> \
  npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { const g = m.createContentGenerator('ai'); console.log('ai:', g.name, 'media:', m.getLastAiMediaGenerator()?.name, 'currentAffairs:', m.getLastAiCurrentAffairsProvider()?.name); })"

# Expected: ai: ai media: fal-ai currentAffairs: sonar-augmented
```

If any key is missing, the factory throws a single combined error listing every missing key plus override hints. Operators see the entire setup gap at once instead of fixing one key per boot.

**Monitor (first 60 minutes after promotion):**
- `cost-by-restaurant` workbook -- per-restaurant LLM/image/video/sonar surface costs roll in
- `per-post-audit` workbook -- spot-check a few `postId` values end-to-end
- Worker logs:
  - `AIContentGenerator instantiated`
  - `current-affairs-refresh processor registered`
  - `media-job-poller processor registered`
- DB collections: `mediaJobs` and `costEvents` should populate as posts are created

**Web UI for `PENDING_MEDIA`:** `apps/web/components/ContentStudio.tsx` renders PENDING_MEDIA posts in the Review tab with a "Generating media" badge; the Approve action is gated until the poller advances the post to PENDING_APPROVAL. The web app must be rebuilt and deployed alongside (or before) the master flag flip in production.

**Rollback:** set `CONTENT_GENERATOR_BACKEND=placeholder` (or unset). All AI behavior stops immediately. Any in-flight `mediaJobs` rows are left as-is; the poller no longer registers and the rows become inert. No data cleanup is required.

## Advanced sub-flag overrides

For staged rollouts, debug deployments, or cost control, individual sub-features can be disabled while the master flag stays on. Setting any sub-flag to `false` removes the corresponding key from the required-key validation.

| Override                              | Effect                                                                                  |
|---------------------------------------|-----------------------------------------------------------------------------------------|
| `MEDIA_BACKEND=placeholder`           | Skip fal.ai. IMAGE posts use the asset catalog. REEL/VIDEO posts use placeholder media. |
| `CURRENT_AFFAIRS_V1_ENABLED=false`    | Skip Google Calendar. Captions get no holiday hints injected.                           |
| `CURRENT_AFFAIRS_V2_ENABLED=false`    | Skip Perplexity Sonar Pro. No daily refresh, no per-post triggers.                      |

These are explicit operator opt-outs; the supported normal mode is "all on". Documented for completeness, not for routine rollouts.

### Example -- LLM only, no fal.ai (validation deployment)

```
CONTENT_GENERATOR_BACKEND=ai
ANTHROPIC_API_KEY=<key>
GOOGLE_CALENDAR_API_KEY=<key>
PERPLEXITY_API_KEY=<key>
MEDIA_BACKEND=placeholder
```

LLM cycle + caption + V1 + V2 run; media falls back to the asset catalog. Useful for validating prompt changes without paying for image/video generation.

### Example -- bare minimum AI (cheapest debug mode)

```
CONTENT_GENERATOR_BACKEND=ai
ANTHROPIC_API_KEY=<key>
MEDIA_BACKEND=placeholder
CURRENT_AFFAIRS_V1_ENABLED=false
CURRENT_AFFAIRS_V2_ENABLED=false
```

LLM-only mode: no media calls, no calendar, no Sonar. Use this to validate Anthropic credentials or the LLM-side test surface in isolation.

## Per-stage observations checklist

After promotion to production:

- [ ] cost-by-restaurant workbook shows non-zero rows
- [ ] worker logs include the expected boot lines
- [ ] no spikes in worker error logs over the first 60 minutes
- [ ] no spikes in cost beyond the expected envelope (see `docs/INFRASTRUCTURE.md` cost expectations)

## Emergency rollback

```
CONTENT_GENERATOR_BACKEND=placeholder
```

Forces every operation back to the asset-catalog generator. AI keys can stay in the env (unused). In-flight `mediaJobs` rows become inert.

## Reference

- ADR 0001: `docs/adr/0001-content-engine-ai-framework.md` (full rationale, decision drivers, alternatives)
- Phase plans: `docs/superpowers/plans/2026-05-03-content-engine-ai-phase-{1..6}.md`
- Workbooks: `infra/workbooks/cost-by-restaurant.workbook.json`, `per-post-audit.workbook.json`
- Secrets setup: `docs/SECRETS.md`
- Architecture: `docs/ARCHITECTURE.md` (AI backend section)
