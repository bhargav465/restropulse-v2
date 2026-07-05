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
# Env variable names stored in Key Vault match exactly what the application
# code reads via process.env (INSTAGRAM_APP_ID, FIREBASE_SERVICE_ACCOUNT_KEY,
# etc.). The provision-azure.sh script uses different names (META_APP_ID,
# FIREBASE_SERVICE_ACCOUNT) -- see docs/INFRASTRUCTURE.md for the known
# naming gaps.
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

# Plain App Service settings (empty = skip)
FRONTEND_URL=""
BACKEND_URL=""
ASSET_SERVER_BASE_URL=""

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
    --frontend-url)               FRONTEND_URL="$2";               shift 2 ;;
    --backend-url)                BACKEND_URL="$2";                shift 2 ;;
    --asset-server-base-url)      ASSET_SERVER_BASE_URL="$2";      shift 2 ;;
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

# KV secret name prefix (STAGING-* or PROD-*)
KV_PREFIX="${ENV^^}"

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
# Note on naming: The env var names used here (INSTAGRAM_APP_ID,
# FIREBASE_SERVICE_ACCOUNT_KEY, etc.) match exactly what the application code
# reads. The original provision-azure.sh used META_APP_ID and
# FIREBASE_SERVICE_ACCOUNT, which do NOT match the code. This script corrects
# that by using the right names for both the KV secret and the App setting.
# ---------------------------------------------------------------------------
log_info "--- Key Vault secrets ---"

[[ -n "$MONGODB_URI" ]] \
  && kv_and_appsetting "${KV_PREFIX}-MONGODB-URI" "MONGODB_URI" "$MONGODB_URI" \
  || log_skip "MONGODB_URI (not provided)"

[[ -n "$MONGODB_DB_NAME" ]] \
  && kv_and_appsetting "${KV_PREFIX}-MONGODB-DB-NAME" "MONGODB_DB_NAME" "$MONGODB_DB_NAME" \
  || log_skip "MONGODB_DB_NAME (not provided)"

[[ -n "$JWT_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-JWT-SECRET" "JWT_SECRET" "$JWT_SECRET" \
  || log_skip "JWT_SECRET (not provided)"

[[ -n "$ENCRYPTION_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-ENCRYPTION-KEY" "ENCRYPTION_KEY" "$ENCRYPTION_KEY" \
  || log_skip "ENCRYPTION_KEY (not provided)"

# INSTAGRAM_APP_ID / SECRET: KV name uses INSTAGRAM- prefix to match code.
# provision-azure.sh incorrectly used META-APP-ID -- this script corrects it.
[[ -n "$INSTAGRAM_APP_ID" ]] \
  && kv_and_appsetting "${KV_PREFIX}-INSTAGRAM-APP-ID" "INSTAGRAM_APP_ID" "$INSTAGRAM_APP_ID" \
  || log_skip "INSTAGRAM_APP_ID (not provided)"

[[ -n "$INSTAGRAM_APP_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-INSTAGRAM-APP-SECRET" "INSTAGRAM_APP_SECRET" "$INSTAGRAM_APP_SECRET" \
  || log_skip "INSTAGRAM_APP_SECRET (not provided)"

[[ -n "$INSTAGRAM_REDIRECT_URI" ]] \
  && kv_and_appsetting "${KV_PREFIX}-INSTAGRAM-REDIRECT-URI" "INSTAGRAM_REDIRECT_URI" "$INSTAGRAM_REDIRECT_URI" \
  || log_skip "INSTAGRAM_REDIRECT_URI (not provided)"

# FIREBASE_SERVICE_ACCOUNT_KEY: KV name uses _KEY suffix to match code.
# provision-azure.sh incorrectly used FIREBASE-SERVICE-ACCOUNT -- corrected here.
[[ -n "$FIREBASE_SERVICE_ACCOUNT_KEY" ]] \
  && kv_and_appsetting "${KV_PREFIX}-FIREBASE-SERVICE-ACCOUNT-KEY" "FIREBASE_SERVICE_ACCOUNT_KEY" "$FIREBASE_SERVICE_ACCOUNT_KEY" \
  || log_skip "FIREBASE_SERVICE_ACCOUNT_KEY (not provided)"

[[ -n "$RAZORPAY_KEY_ID" ]] \
  && kv_and_appsetting "${KV_PREFIX}-RAZORPAY-KEY-ID" "RAZORPAY_KEY_ID" "$RAZORPAY_KEY_ID" \
  || log_skip "RAZORPAY_KEY_ID (not provided)"

[[ -n "$RAZORPAY_KEY_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-RAZORPAY-KEY-SECRET" "RAZORPAY_KEY_SECRET" "$RAZORPAY_KEY_SECRET" \
  || log_skip "RAZORPAY_KEY_SECRET (not provided)"

[[ -n "$RAZORPAY_WEBHOOK_SECRET" ]] \
  && kv_and_appsetting "${KV_PREFIX}-RAZORPAY-WEBHOOK-SECRET" "RAZORPAY_WEBHOOK_SECRET" "$RAZORPAY_WEBHOOK_SECRET" \
  || log_skip "RAZORPAY_WEBHOOK_SECRET (not provided)"

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
