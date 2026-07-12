# UPSTREAM-INVENTORY: `baxeltech/restropulse` Port Assessment

**Brief**: 01 (Upstream Import)
**Status**: ✅ **COMPLETE — upstream accessed and fully compared**
**Method**: Read-only clone of private upstream via authenticated `gh` (account `bhargav465`); no code copied without adaptation; no secrets in any diff.

> This supersedes the earlier version of this file, which was written while
> SSH access was **blocked** and whose comparison was therefore *inferred from
> DESIGN-01.md*, not verified. Every claim below is verified against an actual
> clone.

---

## 0. Provenance

| | Repo | Ref | HEAD |
|---|---|---|---|
| Upstream | `baxeltech/restropulse` (PRIVATE) | `main` | `742ddec` |
| Upstream | ″ | `feature/azure-zero-secrets` | tip incl. `1bf87ab` |
| v2 | `bhargav465/restropulse-v2` | `feat/monorepo-import` | `1ef3428` |

**Upstream branches:** `main`, `feature/azure-zero-secrets`, `staging`,
`ravi/staging`, `worktree-claude-flow`.
**File counts (tracked, excl. binaries/lockfiles):** upstream `main` 262 · v2 587.

---

## 1. Headline finding

**v2 is newer than upstream on everything substantive.** There is essentially
**no application logic to import.** The only upstream-exclusive value is the
**Azure "zero-secret" provisioning work**, and that is *not* an additive port —
it is a **competing architecture** to a design v2 already built (`packages/secrets`).
See §4.

---

## 2. Priority 3a — Payment / Razorpay  →  **Already in v2 (superset). Nothing to port.**

| Artifact | Upstream `main` | v2 | Verdict |
|---|---|---|---|
| `apps/api/src/services/razorpay.ts` | 185 lines, **9** exported fns | 331 lines, **18** exported fns | v2 = strict superset |
| `apps/api/src/routes/subscriptions.ts` | 489 lines | 1479 lines | v2 far ahead |
| `packages/db/src/subscriptions.ts` | 119 lines | 175 lines | v2 ahead |
| `packages/db/src/subscription-plans.ts` | 84 lines | 84 lines | identical |
| `apps/db-cli/.../razorpay-setup.ts` | 340 lines | 324 lines | diverged (dev-only setup) |

v2 implements every upstream function plus: `createRazorpayCustomer`,
`fetchRazorpayCustomersByContact`, `updateRazorpaySubscription`,
`verifySubscriptionSignature`, `fetchRazorpaySubscription`,
`listRazorpaySubscriptionsForCustomer`, `fetchRazorpayPayment`,
`anonymizeRazorpayCustomer`, `isRazorpayConfigured`.

The only upstream-only content in `razorpay.ts` is 3 lines adding an optional
`offer_id` to the offer body — cosmetic, and v2's `createRazorpayOffer` already
covers the offer flow.

> ⚠️ **DESIGN-01 correction:** DESIGN-01 proposed creating a *new*
> `apps/api/src/services/payment/razorpay.ts`. **Do not** — it would duplicate
> and regress the existing, superior `apps/api/src/services/razorpay.ts`.

**Storefront checkout / ordering payment:** **no upstream ancestor at all** —
0 `apps/storefront` / `components/ordering` / `CheckoutPage` files across **all
six** upstream branches. Brief 02's storefront payment page is **greenfield**;
Brief 01 hands it only the payment *types* (§3).

---

## 3. Payment type layer (carried over from the prior run — kept)

`packages/shared/src/types/payment.ts` (created by the earlier blocked run;
retained, builds clean) provides the interfaces Brief 02 consumes:
`RazorpayOrderPayload`, `RazorpayWebhookEvent`,
`RazorpayPaymentVerificationRequest`, `RazorpayOrderRequest`,
`RazorpayPaymentDetails`, `RazorpayConfig`.
`.env.example` documents `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
`RAZORPAY_WEBHOOK_SECRET` / `VITE_RAZORPAY_KEY_ID` (placeholders only).

---

## 4. Priority 3b — Azure scripts  →  **CONFLICT, not an additive port. Deferred.**

The upstream-only value lives on `feature/azure-zero-secrets` (commit
`1bf87ab` "migrate to zero-secret build artifacts using Azure App Config and
Key Vault"). Isolated, it looked like two scripts. It is not:

**Full branch delta vs `main`: 22 files, +962/−270.** It re-architects runtime
config: `apps/web/utils/client-config.ts` (new), `packages/shared/src/env.ts`
(rewritten, 131 lines), `apps/api/src/routes/config.ts`, `apps/web/index.tsx`,
`firebase.ts`, worker boot, `provision-azure.sh` (+113, adds Azure **App
Configuration**), `scripts/set-web-secrets.sh` (new, 82 lines), CI workflows.

**Why it conflicts with v2 (v2 wins per brief DO-NOT):**

| Concern | Upstream (`azure-zero-secrets`) | v2 (`feat/monorepo-import`) |
|---|---|---|
| Secret hydration | Azure **App Configuration** + runtime `client-config.ts` fetch | Dedicated **`packages/secrets/`** pkg (15 files: `azure-kv-provider`, `cached-provider`, `factory`, `hydrate`, `manifest` + tests) — **absent upstream** |
| `packages/shared/src/env.ts` | 131 lines (App Config oriented) | 46 lines (dotenv + Zod `validateEnv`) |
| `provision-azure.sh` | provisions App Configuration | provisions Key Vault, **no** App Config |

v2 already solved zero-secret config **its own, more modular way** and it is the
newer implementation. Importing upstream's approach would mean a second,
competing config mechanism and overwriting v2's `env.ts` — a violation of
*Additive only / v2 wins on conflict*.

**Genuinely absent from v2:** only `apps/web/utils/client-config.ts` — but it is
a leaf of the App-Config design and is inert (and misleading) without the rest.

**Recommendation:** treat "zero-secret config" as a **v2-owned infra decision**,
not an upstream import. If App Configuration is desired, do it as a dedicated
infra brief built on top of `packages/secrets` — not a port. **No files changed
by Brief 01 here.**

---

## 5. Priority 3c — Everything else  →  **Listed; all stale/superseded. Nothing to port.**

Full sweep: only **9** files exist in upstream `main` but not v2, all superseded:

| Upstream-`main`-only path | Why not ported |
|---|---|
| `apps/content-engine/src/services/content-generator.ts` | v2 refactored into a full `content-generator/backends/ai/…` tree (dozens of files) |
| `…/services/adhoc-processor.ts`, `…/strategy-processor.ts` | superseded by v2's processor architecture |
| `apps/content-engine/src/assets/media-catalog.ts` | old flat asset file; v2's `asset-manager.ts` "media-catalog missing" build error is a **v2-internal refactor bug**, not fixed by copying this |
| `apps/api/src/data/mockData.ts.archived` | archived |
| `apps/db-cli/.env.example` | superseded by v2 root `.env.example` |
| `.vscode/settings.json`, `.claude/worktrees/security-audit` | editor / worktree noise |

---

## 6. Secrets & security

- No `.env*` real values, keys, tokens, or Key Vault material appeared in any
  diff. Nothing to rotate.
- Upstream access used a personal `gh` token (account `bhargav465`); not stored
  in the repo.

---

## 7. What Brief 01 changed (this run)

| File | Change |
|---|---|
| `docs/UPSTREAM-INVENTORY.md` | **rewritten** with verified upstream comparison (this file) |
| `packages/shared/src/types/payment.ts` | **kept** (from prior run) — Brief 02 type layer |
| `.env.example` | **kept** (from prior run) — Razorpay var docs |
| _application code_ | **none** — nothing to port; payment logic already in v2, Azure work conflicts |

`docs/BRIEF-01-COMPLETION-REPORT.md` (prior run) is retained for history but its
"SSH blocked / cannot verify Azure" sections are now superseded by this file.

---

## 8. Handoff to Brief 02 (storefront payment page)

- Consume `@restropulse/shared` payment types (§3).
- Call existing `apps/api/src/services/razorpay.ts`:
  `createRazorpayOrder`, `verifyPaymentSignature`, `verifyWebhookSignature`,
  `fetchRazorpayPayment`. No new service needed.
- Keep `/api/subscriptions/webhook` raw-body mount **before** the JSON parser.
- Brief 02 is greenfield UI — there is no upstream storefront to port from.

---

**Verified**: read-only clone comparison, upstream `742ddec` vs v2 `1ef3428`.
