# MCP Server Configuration

RestroPulse uses five Model Context Protocol (MCP) servers arranged as a
non-redundant **context stack**. Each layer has a distinct role and strict
scope so the AI assistant never receives conflicting or duplicate data.

## Layer Overview

| Layer | Server | Role | Scope |
|-------|--------|------|-------|
| Semantic Search | `codebase-rag` | Find files by *intent*, not just name | `apps/*/src`, `packages/*/src`, `docs/`, READMEs |
| Logic / Navigation | `mcp-language-server` | Type-aware jump-to-definition, references, diagnostics | One instance per app/package boundary |
| Knowledge / Memory | `@modelcontextprotocol/server-memory` | Persist architecture decisions, conventions, preferences | Decision-only -- never code snippets |
| Azure | `@azure/mcp` | Inspect and manage live Azure resources | Subscriptions, resource groups, App Service, Key Vault, Application Insights |
| Browser Automation | `@playwright/mcp` | Drive the running web app for E2E QA, bug repro, exploratory testing | Live app at localhost or staging; never source files |

## Prerequisites (one-time)

The fastest way to check and install everything is the automated setup script:

```bash
# Interactive -- checks all tools then prompts to install missing ones
npm run setup:mcp

# Auto-install without prompts
node scripts/setup-mcp.mjs --install

# Check only (CI-friendly, exits 1 if anything is missing)
node scripts/setup-mcp.mjs --check
```

The script handles:

| Tool | How it installs |
|------|-----------------|
| Go (>= 1.21) | winget / Chocolatey (Windows) or Homebrew (macOS/Linux) |
| typescript | `npm install -g typescript` |
| typescript-language-server | `npm install -g typescript-language-server` |
| mcp-language-server | `go install github.com/isaacphi/mcp-language-server@latest` |
| codebase-rag | Fetched automatically via `npx -y` at runtime |
| @modelcontextprotocol/server-memory | Fetched automatically via `npx -y` at runtime |

If you prefer to install manually:

```bash
npm install -g typescript typescript-language-server
go install github.com/isaacphi/mcp-language-server@latest
```

Verify both are on your PATH:

```bash
typescript-language-server --version
mcp-language-server --help
```

## Configuration Files

Two configuration files define the same set of MCP servers for different AI
assistants. Both are committed to git and share the same server topology.

| File | Consumer | Format | Variable Syntax |
|------|----------|--------|-----------------|
| `.vscode/mcp.json` | VS Code Copilot | JSONC (comments allowed) | `${workspaceFolder}`, `${userHome}` |
| `.mcp.json` (project root) | Claude Code CLI + VS Code Extension | Strict JSON | `${USERPROFILE}` (Windows) / `${HOME}` (Unix) |

Open either file for the full config. The inline comments in `.vscode/mcp.json`
explain each entry.

### Semantic Search (`semantic-search`)

- Runs `codebase-rag` against the workspace root.
- Respects `.gitignore` by default.
- Additional excludes via `CODEBASE_RAG_EXCLUDE` env var keep `coverage/`,
  `html/`, `public/mockdata`, media assets, and lock files out of the index.

### Logic / Navigation (`lsp-*`)

Six scoped instances, one per workspace boundary:

| Server ID | Workspace |
|-----------|-----------|
| `lsp-web` | `apps/web` |
| `lsp-api` | `apps/api` |
| `lsp-publisher` | `apps/publisher` |
| `lsp-content-engine` | `apps/content-engine` |
| `lsp-shared` | `packages/shared` |
| `lsp-db` | `packages/db` |

Each instance runs `typescript-language-server` through the
`mcp-language-server` bridge, scoped to its own `tsconfig.json`. This keeps
the TypeScript program graph small and fast.

Cross-package type resolution works because each app's `tsconfig.json` already
maps `@restropulse/shared` and `@restropulse/db` via paths or workspace
resolution.

### Knowledge / Memory (`project-memory`)

- Stores only **decisions, conventions, and preferences**.
- Does NOT store code snippets (that is RAG's job) or type information
  (that is LSP's job).
- Periodically ask the AI to "summarize project memory" and prune stale nodes.

## Tool-Routing Rules

These rules prevent overlap between the three layers. They are codified in both
`.github/copilot-instructions.md` (for Copilot) and `CLAUDE.md` (for Claude
Code) so every AI assistant session respects them.

| Task | Primary | Secondary | Never Use |
|------|---------|-----------|-----------|
| "Where is the feature that does X?" | `codebase-rag` | -- | `project-memory` |
| Jump to definition / find references | `lsp-*` | -- | `codebase-rag` |
| Type errors or diagnostics | `lsp-*` | -- | `codebase-rag` |
| Refactor a symbol across files | `lsp-*` | `codebase-rag` (impact search) | -- |
| "What convention do we use for X?" | `project-memory` | -- | `codebase-rag` |
| Debugging a logic error | `lsp-*` | `project-memory` (past context) | -- |
| Reading/writing file contents | Filesystem tools | -- | `codebase-rag` |
| E2E test, bug repro, drive the running app | `playwright` | -- | Filesystem tools (do not read source via playwright) |

## Index Hygiene

`.vscode/settings.json` defines `search.exclude` and `files.watcherExclude`
entries that mirror the RAG exclude list. This keeps VS Code search, file
watchers, and AI indexing aligned on the same noise-free subset.

Excluded paths: `node_modules`, `dist`, `.turbo`, `coverage`, `html`,
`public/mockdata`, `assets/videos`, `assets/images`, `package-lock.json`.

### Azure (`azure`)

- Runs `@azure/mcp` via `npx -y @azure/mcp@latest server start`.
- No additional install required; npx fetches the package on first use.
- Authenticates using the current Azure CLI session (`az login`).
- Use for post-provisioning inspection, secret name listing, App Service log
  queries, and Application Insights queries -- without leaving the editor.
- Tool-routing rule: use `azure` only for live Azure resource operations.
  Never use it to read source files or look up TypeScript types.

Verify it is active:

```bash
claude mcp list
# Should show: azure   npx -y @azure/mcp@latest server start
```

### Browser Automation (`playwright`)

- Runs `@playwright/mcp` via `npx -y @playwright/mcp@latest`.
- No additional install required; npx fetches the package + browser on first
  use (Chromium is downloaded automatically).
- Use to drive the running web app for E2E QA, bug repro, exploratory testing
  of subscription/checkout flows, and any task that requires interacting with
  rendered DOM, iframes (e.g., Razorpay checkout), or network requests.
- Tool-routing rule: use `playwright` only for live app interaction. Never use
  it to read source files (use Filesystem tools) or to search code (use
  `codebase-rag`).
- Requires the local dev environment to be running (`npm run dev`) or a
  reachable staging URL.

Verify it is active:

```bash
claude mcp list
# Should show: playwright   npx -y @playwright/mcp@latest
```

## Claude Code Setup

Claude Code (the CLI and its VS Code extension) reads `.mcp.json` at the
project root. It does **not** read `.vscode/mcp.json`.

- **Instructions file**: `CLAUDE.md` at the project root -- equivalent to
  `.github/copilot-instructions.md` for Copilot. Uses `@path` imports to
  reference docs instead of duplicating content.
- **Personal overrides**: Create `CLAUDE.local.md` for personal preferences.
  It is gitignored automatically.
- **Cross-platform paths**: The `.mcp.json` uses `${USERPROFILE}` for the
  bun/codebase-rag path (Windows). On macOS/Linux, change this to `${HOME}`.
- **Verify servers**: Run `claude mcp list` from the project root.

## Troubleshooting

- **LSP not starting**: Ensure `typescript-language-server` and
  `mcp-language-server` are on PATH. Run `typescript-language-server --version`
  to confirm.
- **RAG indexing too slow**: Check that `.gitignore` is up to date and
  `CODEBASE_RAG_EXCLUDE` covers large generated folders.
- **Memory bloat**: Ask the AI to list all memory nodes and delete outdated
  entries.
- **Cross-package types not resolving**: Confirm that the app's `tsconfig.json`
  has correct `paths` or that `@restropulse/shared` resolves via
  `node_modules` workspace symlinks.
- **Claude Code not finding servers**: Ensure you are running `claude` from the
  project root where `.mcp.json` lives. Run `claude mcp list` to verify.
- **npx errors in monorepo**: The `project-memory` server uses a globally
  installed `mcp-server-memory` binary to avoid npm arborist bugs with `npx`
  in monorepos. Install it with `npm i -g @modelcontextprotocol/server-memory`.
