#!/usr/bin/env bash
# =============================================================================
# set-keyvault-secrets.sh
#
# Sets Key Vault secrets and App Service settings for a target environment.
# Pass only the parameters you want to update -- omitted ones are skipped.
#
# Usage:
#   bash scripts/set-keyvault-secrets.sh --env staging \
#     --mongodb-uri "mongodb+srv://..." \
#     --mongodb-db-name "restropulsev1" \
#     --jwt-secret "..." \
#     --encryption-key "..." \
#     --instagram-app-id "..." \
#     --instagram-app-secret "..." \
#     --instagram-redirect-uri "https://<staging-api>/api/integrations/instagram/callback" \
#     --firebase-service-account-key '{"type":"service_account",...}' \
#     --razorpay-key-id "..." \
#     --razorpay-key-secret "..." \
#     --razorpay-webhook-secret "..." \
#     --google-maps-api-key "..." \
#     --anthropic-api-key "..." \
#     --media-storage-connection-string "DefaultEndpointsProtocol=https;AccountName=..." \
#     --zomato-adapter "manual" \
#     --frontend-url "https://<staging-web>" \
#     --backend-url "https://<staging-api>" \
#     --asset-server-base-url "https://<staging-api>/content/mockdata"
#
# Infrastructure defaults match provision-azure.sh naming conventions.
# Override with --vault-name, --app-name, --resource-group, --slot.
#
# Flags:
#   --dry-run     Print commands without executing.
#   --help        Show this message.
#
# Key Vault secret names use the canonical {env}-{kebab} scheme (lowercase,
# hyphens, env in dev/staging/prod), matching provision-azure.sh exactly.
# The App Service setting names match what the application code reads via
# process.env (INSTAGRAM_APP_ID, FIREBASE_SERVICE_ACCOUNT_KEY, etc.).
# =============================================================================

set -euo pipefail

# Prevent Git Bash (MSYS2) from converting Unix-style paths into Windows paths.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ENV="staging"
KV_NAME="restropulse-prod-kv"
APP_NAME="restropulse-prod-api"
RG_NAME="restropulse-prod-rg"
SLOT=""          # auto-set below based on --env unless overridden via --slot
DRY_RUN=false

# Secret values (empty = skip)
MONGODB_URI=""
MONGODB_DB_NAME=""
JWT_SECRET=""
ENCRYPTION_KEY=""
INSTAGRAM_APP_ID=""
INSTAGRAM_APP_SECRET=""
INSTAGRAM_REDIRECT_URI=""
FIREBASE_SERVICE_ACCOUNT_KEY=""
RAZORPAY_KEY_ID=""
RAZORPAY_KEY_SECRET=""
RAZORPAY_WEBHOOK_SECRET=""
GOOGLE_MAPS_API_KEY=""
ANTHROPIC_API_KEY=""
MEDIA_STORAGE_CONNECTION_STRING=""

# Plain App Service settings (empty = skip)
FRONTEND_URL=""
BACKEND_URL=""
ASSET_SERVER_BASE_URL=""
ZOMATO_ADAPTER=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
  sed -n '/^# Usage:/,/^# =====/{/^# =====/!p}' "$0" | sed 's/^# //'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)                        ENV="$2";                        shift 2 ;;
    --vault-name)                 KV_NAME="$2";                    shift 2 ;;
    --app-name)                   APP_NAME="$2";                   shift 2 ;;
    --resource-group)             RG_NAME="$2";                    shift 2 ;;
    --slot)                       SLOT="$2";                       shift 2 ;;
    --mongodb-uri)                MONGODB_URI="$2";                shift 2 ;;
    --mongodb-db-name)            MONGODB_DB_NAME="$2";            shift 2 ;;
    --jwt-secret)                 JWT_SECRET="$2";                 shift 2 ;;
    --encryption-key)             ENCRYPTION_KEY="$2";             shift 2 ;;
    --instagram-app-id)           INSTAGRAM_APP_ID="$2";           shift 2 ;;
    --instagram-app-secret)       INSTAGRAM_APP_SECRET="$2";       shift 2 ;;
    --instagram-redirect-uri)     INSTAGRAM_REDIRECT_URI="$2";     shift 2 ;;
    --firebase-service-account-key) FIREBASE_SERVICE_ACCOUNT_KEY="$2"; shift 2 ;;
    --razorpay-key-id)            RAZORPAY_KEY_ID="$2";            shift 2 ;;
    --razorpay-key-secret)        RAZORPAY_KEY_SECRET="$2";        shift 2 ;;
    --razorpay-webhook-secret)    RAZORPAY_WEBHOOK_SECRET="$2";    shift 2 ;;
    --google-maps-api-key)        GOOGLE_MAPS_API_KEY="$2";        shift 2 ;;
    --anthropic-api-key)          ANTHROPIC_API_KEY="$2";          shift 2 ;;
    --media-storage-connection-string) MEDIA_STORAGE_CONNECTION_STRING="$2"; shift 2 ;;
    --frontend-url)               FRONTEND_URL="$2";               shift 2 ;;
    --backend-url)                BACKEND_URL="$2";                shift 2 ;;
    --asset-server-base-url)      ASSET_SERVER_BASE_URL="$2";      shift 2 ;;
    --zomato-adapter)             ZOMATO_ADAPTER="$2";             shift 2 ;;
    --dry-run)                    DRY_RUN=true;                    shift   ;;
    --help|-h)                    usage ;;
    *) echo "[ERR] Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Derive slot from env when not explicitly set
# ---------------------------------------------------------------------------
if [[ -z "$SLOT" ]]; then
  if [[ "$ENV" == "staging" ]]; then
    SLOT="staging"
  else
    SLOT=""
  fi
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "[ERR] --env must be 'staging' or 'production'" >&2
  exit 1
fi

# KV secret name prefix using the canonical {env}-{kebab} scheme
# (lowercase, env in dev/staging/prod). "production" maps to the "prod"
# prefix -- there is no "PRODUCTION-" prefix in the vault.
case "$ENV" in
  staging)    KV_PREFIX="staging" ;;
  production) KV_PREFIX="prod" ;;
esac

# App Service target args
APP_TARGET_ARGS=(--resource-group "$RG_NAME" --name "$APP_NAME")
if [[ -n "$SLOT" ]]; then
  APP_TARGET_ARGS+=(--slot "$SLOT")
fi

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  C_GREEN=$(tput setaf 2); C_YELLOW=$(tput setaf 3)
  C_RED=$(tput setaf 1);   C_CYAN=$(tput setaf 6)
  C_BOLD=$(tput bold);     C_RESET=$(tput sgr0)
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_BOLD=""; C_RESET=""
fi

log_ok()   { echo "${C_GREEN}[OK]${C_RESET}   $*"; }
log_skip() { echo "${C_YELLOW}[SKIP]${C_RESET} $*"; }
log_info() { echo "${C_CYAN}[INFO]${C_RESET} $*"; }
log_dry()  { echo "${C_YELLOW}[DRY]${C_RESET}  $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
kv_secret_set() {
  local secret_name="$1"
  local secret_value="$2"
  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "az keyvault secret set --vault-name $KV_NAME --name $secret_name --value '<redacted>'"
  else
    az keyvault secret set \
      --vault-name "$KV_NAME" \
      --name "$secret_name" \
      --value "$secret_value" \
      --output none
    log_ok "KV secret set: $secret_name"
  fi
}

# Set a KV secret and add the matching App Service setting as a KV reference.
# Usage: kv_and_appsetting <kv-secret-name> <app-setting-name> <value>
kv_and_appsetting() {
  local kv_name="$1"
  local app_setting="$2"
  local value="$3"
  kv_secret_set "$kv_name" "$value"
  local kv_ref="@Microsoft.KeyVault(VaultName=${KV_NAME};SecretName=${kv_name})"
  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "az webapp config appsettings set ... ${app_setting}='${kv_ref}'"
  else
    az webapp config appsettings set \
      "${APP_TARGET_ARGS[@]}" \
      --settings "${app_setting}=${kv_ref}" \
      --output none
    log_ok "App setting linked: $app_setting -> KV $kv_name"
  fi
}

# Set a plain (non-secret) App Service setting.
plain_appsetting() {
  local app_setting="$1"
  local value="$2"
  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "az webapp config appsettings set ... ${app_setting}='${value}'"
  else
    az webapp config appsettings set \
      "${APP_TARGET_ARGS[@]}" \
      --settings "${app_setting}=${value}" \
      --output none
    log_ok "App setting set: $app_setting"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "${C_BOLD}${C_CYAN}=== RestroPulse Key Vault + App Service Update ===${C_RESET}"
echo ""
echo "  Environment  : ${C_BOLD}${ENV}${C_RESET}"
echo "  Key Vault    : $KV_NAME  (prefix: ${KV_PREFIX}-)"
echo "  App Service  : $APP_NAME${SLOT:+ (slot: $SLOT)}"
echo "  Resource Group: $RG_NAME"
[[ "$DRY_RUN" == "true" ]] && echo "  ${C_YELLOW}Mode: DRY RUN -- no changes will be made${C_RESET}"
echo ""

# ---------------------------------------------------------------------------
# KV Secrets + matching App Service settings
#
# KV secret names use the canonical {env}-{kebab} scheme (lowercase). The
# App setting names match exactly what the application code reads via
# process.env (INSTAGRAM_APP_ID, FIREBASE_SERVICE_ACCOUNT_KEY, etc.).
# ---------------------------------------------------------------------------
log_info "--- Key Vault secrets ---"

[[ -n "$MONGODB_URI" ]] \
  && kv_and_appsetting "${KV_PREFIX}-mongodb-uri" "MONGODB_URI" "$MONGODB_URI" \
  || log_skip "MONGODB_URI (not provided)"

[[ -n "$MONGODB_DB_NAME" ]] \
  && kv_and_appsetting "${KV_PREFIX}-mongodb-db-name" "MONGODB_DB_NAME" "$MONGODB_DB_NAME" \
  || log_skip "MONGODB_DB_NAME (not provided)"

[[ -n "$JWT_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-jwt-secret" "JWT_SECRET" "$JWT_SECRET" \
  || log_skip "JWT_SECRET (not provided)"

[[ -n "$ENCRYPTION_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-encryption-key" "ENCRYPTION_KEY" "$ENCRYPTION_KEY" \
  || log_skip "ENCRYPTION_KEY (not provided)"

[[ -n "$INSTAGRAM_APP_ID" ]] \
  && kv_and_appsetting "${KV_PREFIX}-instagram-app-id" "INSTAGRAM_APP_ID" "$INSTAGRAM_APP_ID" \
  || log_skip "INSTAGRAM_APP_ID (not provided)"

[[ -n "$INSTAGRAM_APP_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-instagram-app-secret" "INSTAGRAM_APP_SECRET" "$INSTAGRAM_APP_SECRET" \
  || log_skip "INSTAGRAM_APP_SECRET (not provided)"

[[ -n "$INSTAGRAM_REDIRECT_URI" ]] \
  && kv_and_appsetting "${KV_PREFIX}-instagram-redirect-uri" "INSTAGRAM_REDIRECT_URI" "$INSTAGRAM_REDIRECT_URI" \
  || log_skip "INSTAGRAM_REDIRECT_URI (not provided)"

[[ -n "$FIREBASE_SERVICE_ACCOUNT_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-firebase-service-account-key" "FIREBASE_SERVICE_ACCOUNT_KEY" "$FIREBASE_SERVICE_ACCOUNT_KEY" \
  || log_skip "FIREBASE_SERVICE_ACCOUNT_KEY (not provided)"

[[ -n "$RAZORPAY_KEY_ID" ]] \
  && kv_and_appsetting "${KV_PREFIX}-razorpay-key-id" "RAZORPAY_KEY_ID" "$RAZORPAY_KEY_ID" \
  || log_skip "RAZORPAY_KEY_ID (not provided)"

[[ -n "$RAZORPAY_KEY_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-razorpay-key-secret" "RAZORPAY_KEY_SECRET" "$RAZORPAY_KEY_SECRET" \
  || log_skip "RAZORPAY_KEY_SECRET (not provided)"

[[ -n "$RAZORPAY_WEBHOOK_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-razorpay-webhook-secret" "RAZORPAY_WEBHOOK_SECRET" "$RAZORPAY_WEBHOOK_SECRET" \
  || log_skip "RAZORPAY_WEBHOOK_SECRET (not provided)"

# Restaurant Intelligence server-side keys (api). Absent -> scan 503s gracefully.
[[ -n "$GOOGLE_MAPS_API_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-google-maps-api-key" "GOOGLE_MAPS_API_KEY" "$GOOGLE_MAPS_API_KEY" \
  || log_skip "GOOGLE_MAPS_API_KEY (not provided)"

[[ -n "$ANTHROPIC_API_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-anthropic-api-key" "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY" \
  || log_skip "ANTHROPIC_API_KEY (not provided)"

# Durable generated-media storage (content-engine). Use the PROD storage account's
# connection string for --env production and the NON-PROD account's for staging.
[[ -n "$MEDIA_STORAGE_CONNECTION_STRING" ]] \
  && kv_and_appsetting "${KV_PREFIX}-media-storage-connection-string" "MEDIA_STORAGE_CONNECTION_STRING" "$MEDIA_STORAGE_CONNECTION_STRING" \
  || log_skip "MEDIA_STORAGE_CONNECTION_STRING (not provided)"

# ---------------------------------------------------------------------------
# Plain App Service settings (not secrets, not in KV)
# ---------------------------------------------------------------------------
echo ""
log_info "--- Plain App Service settings ---"

[[ -n "$FRONTEND_URL" ]] \
  && plain_appsetting "FRONTEND_URL" "$FRONTEND_URL" \
  || log_skip "FRONTEND_URL (not provided)"

[[ -n "$BACKEND_URL" ]] \
  && plain_appsetting "BACKEND_URL" "$BACKEND_URL" \
  || log_skip "BACKEND_URL (not provided)"

[[ -n "$ASSET_SERVER_BASE_URL" ]] \
  && plain_appsetting "ASSET_SERVER_BASE_URL" "$ASSET_SERVER_BASE_URL" \
  || log_skip "ASSET_SERVER_BASE_URL (not provided)"

# Restaurant Intelligence Zomato source selector (plain toggle; default 'manual').
[[ -n "$ZOMATO_ADAPTER" ]] \
  && plain_appsetting "ZOMATO_ADAPTER" "$ZOMATO_ADAPTER" \
  || log_skip "ZOMATO_ADAPTER (not provided)"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
log_ok "Finished. App Service restart may be needed for new settings to take effect:"
echo "    az webapp restart ${APP_TARGET_ARGS[*]}"
echo ""
echo "Verify KV secrets:"
echo "    az keyvault secret list --vault-name $KV_NAME --query \"[?starts_with(name,'${KV_PREFIX}-')].name\" -o tsv"
echo ""
