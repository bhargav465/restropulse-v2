@.github/copilot-instructions.md
@README.md
@docs/TESTING.md
@docs/INFRASTRUCTURE.md
@docs/ARCHITECTURE.md
@docs/MCP-SETUP.md
@docs/RTK.md

## Content Engine AI Backend

The content-engine has three pluggable backends behind a feature flag:

- `CONTENT_GENERATOR_BACKEND=placeholder` (default, production): asset catalog at `apps/content-engine/src/services/content-generator/backends/placeholder/`
- `CONTENT_GENERATOR_BACKEND=ai`: AI orchestration at `apps/content-engine/src/services/content-generator/backends/ai/`
- `CONTENT_GENERATOR_BACKEND=replicate-proxy`: at `apps/content-engine/src/services/content-generator/backends/replicate-proxy/`. Same scheduling/cron/processors as the other backends (all three implement the same `IContentGenerator` contract and are selected via the same factory). `draftCycle`/`reviseCycle` reuse the `ai` backend's Anthropic-based cycle-planning pipeline unchanged. `generatePost`/`revisePost` are a pure proxy to Replicate: the caption is the caller-supplied concept verbatim (no LLM call, no specialization prompt engineering, no dish resolution, no current-affairs enrichment), forwarded as-is to `ReplicateMediaGenerator`. Requires only `ANTHROPIC_API_KEY` and `REPLICATE_API_TOKEN` (no Calendar/Sonar keys).

The AI backend composes four pluggable seams (`ILLMProvider`, `IMediaGenerator`, `ICurrentAffairsProvider`, `IDomainSpecialization`). `CONTENT_GENERATOR_BACKEND=ai` is an "uber" master flag -- when set, all four sub-features default-on (Anthropic + Replicate + V1 calendar + V2 Sonar) and all four required keys must be present. The factory throws a single combined error listing every missing key. Sub-flag overrides (`MEDIA_BACKEND=placeholder`, `CURRENT_AFFAIRS_V1_ENABLED=false`, `CURRENT_AFFAIRS_V2_ENABLED=false`) exist for debug/staged rollout but are advanced operator opt-outs, not the supported normal mode.

See `docs/CONTENT_ENGINE_AI_ROLLOUT.md` for the rollout runbook, `docs/SECRETS.md` for how to obtain the four required keys, and `docs/adr/0001-content-engine-ai-framework.md` for design rationale.

Per-call cost events flow into both `costEvents` (MongoDB) and Application Insights `customEvents` (queryable from the workbooks at `infra/workbooks/`).

**Generated media is persisted to Azure Blob Storage, never stored as a Replicate URL.** Replicate deletes API output files after ~1 hour, so `ReplicateMediaGenerator` copies every image/video through `IMediaStorage` (`apps/content-engine/src/services/media-storage/`) *before* any URL is written to `mediaJobs` or a post -- keep that invariant on every path (sync image, carousel frames, async video `pollJob`). Storage is split prod vs non-prod by **account** (`restropulsemediaprod`, `restropulsemedianonprod`, selected by the `MEDIA_STORAGE_CONNECTION_STRING` Key Vault secret `{env}-media-storage-connection-string`) and tied to the database by **container** (derived from `MONGODB_DB_NAME`). `createMediaStorage()` must never throw at boot (`startup.sh` stops all processes if one exits); unset/malformed falls back to a passthrough with an error log. See `docs/SECRETS.md`.

When changing AI-backend code:
- Tests use mocked external APIs (`vi.mock('ai', ...)` for Vercel AI SDK; mocked `fetch` for Replicate/Sonar/Calendar). Do not introduce real network calls.
- The `CostEvent` type lives in `@restropulse/shared`; the `MediaJobRecord` type lives there too. Don't duplicate types in app-local files.
- Adding a new external API surface (e.g. a new media provider): also add per-call pricing in the relevant `pricing.ts` so cost dashboards stay accurate.

## Secrets Management

Deployed staging/production slots resolve secrets via **Azure App Service Key Vault References** (`@Microsoft.KeyVault(VaultName=restropulse-prod-kv;SecretName=...)`), set as App Service settings and resolved by the slot's managed identity into plain `process.env` at startup -- application code never talks to Key Vault directly, and `SECRETS_BACKEND` stays `env` (the default) on running slots.

`@restropulse/secrets` (`packages/secrets/`) is a manifest-driven fetch utility used only by (a) `npm run secrets:pull` (hydrates `dev-*` secrets from the shared vault into `apps/*/.env` for local dev) and (b) the web `config.json` generator at deploy time. It is not used at app boot.

Key conventions when working on this codebase:
- Never read secrets directly from `process.env` in new code -- add them to the app's Zod schema and `packages/secrets/src/manifest.ts` (`SECRETS_MANIFEST`)
- Per-service scoping: each app only hydrates its own keys via `getAppSecretKeys(appName)`. The manifest is the authoritative list of which app owns which secret
- Single shared vault (`restropulse-prod-kv`); secret names use `{env}-{kebab}` with env in `dev`, `staging`, `prod` (e.g. `prod-mongodb-uri`, `dev-jwt-secret`)
- Local dev is hybrid: `.env` by default (`SECRETS_BACKEND=env`); `npm run secrets:pull` is opt-in to hydrate `dev-*` secrets into `apps/*/.env`
- `SECRETS_BACKEND=azure-kv` (in-app hydrate-on-boot via `createSecretsProvider`) exists as a capability but is not set on the deployed slots -- do not describe it as the production mechanism
- Integration tests (`tests/integration/`): use `requireSecrets(suiteName, keys)` which throws on any missing secret -- no skip mechanism. Tests are manual-trigger only via `workflow_dispatch`
- See `docs/INTEGRATION_TESTING.md` for how to run and add integration tests

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (90-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk vitest run          # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->