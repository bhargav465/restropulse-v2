#!/usr/bin/env bash
# =============================================================================
# RestroPulse - Azure Resource Provisioning Script
#
# Usage:
#   bash scripts/provision-azure.sh [options]
#
# Options:
#   --env         staging | production | both  (default: staging)
#   --location    Azure region          (default: centralindia)
#   --prefix      Resource name prefix  (default: restropulse)
#   --subscription  Azure subscription ID (optional, uses current if omitted)
#   --github-repo   GitHub repo in org/name format (default: baxeltech/restropulse)
#   --skip-oidc   Skip App Registration / federated credential setup
#   --reset       DANGER: delete the resource group and all its resources,
#                 then re-provision from scratch. Requires confirmation prompt.
#   --help        Show this help text
#
# What this script provisions:
#   1. Resource Group
#   2. Log Analytics Workspace
#   3. Application Insights
#   4. Key Vault (with placeholder secrets)
#   5. App Service Plan (S1 Linux - Standard)
#   6. App Service Web App (Express API + WebJob workers)
#      + staging deployment slot for non-production deployments
#   7. Static Web App (React SPA)
#
# WebJob note:
#   apps/publisher and apps/content-engine are deployed as Azure WebJobs
#   (continuous) under the API App Service. No separate Azure resources are
#   required for them beyond the App Service Plan already provisioned here.
#
# Azure MCP integration:
#   The Azure MCP server (@azure/mcp) is configured in .mcp.json for
#   interactive Azure operations from Claude Code. Use it for post-provisioning
#   inspection, secret updates, and log queries without leaving the editor.
#
# Prerequisites:
#   - Azure CLI (az) >= 2.50 installed and on PATH
#   - Logged in: az login
#   - Target subscription set or passed via --subscription
# =============================================================================

set -euo pipefail

# Prevent Git Bash (MSYS2) from converting Unix-style paths such as Azure ARM
# resource IDs (/subscriptions/...) into Windows paths when passing them as
# CLI arguments. Without this, paths like /subscriptions/<id>/resourceGroups/...
# get silently rewritten to C:/Program Files/Git/subscriptions/... which causes
# Azure API calls to fail with opaque BadRequest errors.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# ---------------------------------------------------------------------------
# Color helpers (fall back to no color when not in a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  C_GREEN=$(tput setaf 2)
  C_YELLOW=$(tput setaf 3)
  C_RED=$(tput setaf 1)
  C_CYAN=$(tput setaf 6)
  C_BOLD=$(tput bold)
  C_RESET=$(tput sgr0)
else
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
  C_CYAN=""
  C_BOLD=""
  C_RESET=""
fi

log_ok()   { echo "${C_GREEN}[OK]${C_RESET}   $*"; }
log_skip() { echo "${C_YELLOW}[SKIP]${C_RESET} $*"; }
log_err()  { echo "${C_RED}[ERR]${C_RESET}  $*" >&2; }
log_info() { echo "${C_CYAN}[INFO]${C_RESET} $*"; }
log_head() { echo ""; echo "${C_BOLD}${C_CYAN}=== $* ===${C_RESET}"; echo ""; }

die() {
  log_err "$*"
  exit 1
}

# ---------------------------------------------------------------------------
# reset_environment: delete the resource group and all its contents after a
# mandatory interactive confirmation. This is irreversible.
# ---------------------------------------------------------------------------
reset_environment() {
  local rg="$1"

  echo ""
  echo "${C_RED}${C_BOLD}RESET MODE - DESTRUCTIVE OPERATION${C_RESET}"
  echo "${C_RED}This will permanently delete resource group: $rg${C_RESET}"
  echo "${C_RED}ALL resources inside it (App Service, Key Vault, secrets,${C_RESET}"
  echo "${C_RED}Application Insights, Log Analytics, Static Web App) will${C_RESET}"
  echo "${C_RED}be destroyed. This cannot be undone.${C_RESET}"
  echo ""

  # Key Vault soft-delete protection requires a separate purge step; warn about it.
  echo "${C_YELLOW}Note: Key Vault uses soft-delete. After the resource group is${C_RESET}"
  echo "${C_YELLOW}deleted the vault enters a 90-day recovery period. If you want${C_RESET}"
  echo "${C_YELLOW}to reuse the same vault name immediately, purge it manually:${C_RESET}"
  echo "${C_YELLOW}  az keyvault purge --name $KV_NAME --location $LOCATION${C_RESET}"
  echo ""

  read -r -p "Type the resource group name to confirm deletion: " CONFIRM_RG
  if [[ "$CONFIRM_RG" != "$rg" ]]; then
    die "Confirmation did not match '$rg'. Aborting reset."
  fi

  log_info "Deleting resource group '$rg' and all contained resources..."
  az group delete \
    --name "$rg" \
    --yes \
    --no-wait
  log_ok "Deletion initiated for resource group: $rg"
  log_info "Deletion runs in the background. Wait ~2-5 minutes before re-provisioning."
  log_info "Poll status with: az group show --name $rg --query 'properties.provisioningState'"
  echo ""

  # Block until deletion completes so the subsequent provision run starts clean.
  log_info "Waiting for deletion to complete (this may take a few minutes)..."
  local wait_secs=0
  local max_wait=300
  while az group show --name "$rg" --output none 2>/dev/null; do
    if [[ $wait_secs -ge $max_wait ]]; then
      die "Timed out waiting for resource group deletion after ${max_wait}s. Check the portal and retry."
    fi
    sleep 10
    wait_secs=$((wait_secs + 10))
    log_info "Still waiting... (${wait_secs}s elapsed)"
  done
  log_ok "Resource group '$rg' fully deleted. Proceeding with fresh provisioning."
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ENV="staging"
LOCATION="southindia"
PREFIX="restropulse"
SUBSCRIPTION=""
GITHUB_REPO="baxeltech/restropulse"
SKIP_OIDC=false
RESET=false

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"; shift 2
      ;;
    --location)
      LOCATION="$2"; shift 2
      ;;
    --prefix)
      PREFIX="$2"; shift 2
      ;;
    --subscription)
      SUBSCRIPTION="$2"; shift 2
      ;;
    --github-repo)
      GITHUB_REPO="$2"; shift 2
      ;;
    --skip-oidc)
      SKIP_OIDC=true; shift
      ;;
    --reset)
      RESET=true; shift
      ;;
    --help|-h)
      sed -n '/^# ====/,/^# ====/p' "$0" | sed 's/^# \?//' | head -n 40
      exit 0
      ;;
    *)
      die "Unknown argument: $1. Run with --help for usage."
      ;;
  esac
done

# Validate --env
if [[ "$ENV" != "staging" && "$ENV" != "production" && "$ENV" != "both" ]]; then
  die "--env must be 'staging', 'production', or 'both', got: $ENV"
fi

# ---------------------------------------------------------------------------
# Derived names  (single shared stack: always use prod segment)
# ---------------------------------------------------------------------------
NAME_ENV_SEGMENT="prod"

RG_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-rg"
LAW_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-law"
APPINSIGHTS_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-insights"
KV_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-kv"
PLAN_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-plan"
API_APP_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-api"
SWA_NAME="${PREFIX}-${NAME_ENV_SEGMENT}-web"
SWA_LOCATION="$LOCATION"
APP_SLOT_NAME="staging"

TARGET_SCOPE_LABEL="production"
if [[ "$ENV" == "staging" ]]; then
  TARGET_SCOPE_LABEL="staging slot"
elif [[ "$ENV" == "both" ]]; then
  TARGET_SCOPE_LABEL="production + staging slot"
fi

# ---------------------------------------------------------------------------
# Static Web App region resolver
# - Static Web App is not available in every Azure region.
# - Resolve to the nearest supported region based on the requested location.
# ---------------------------------------------------------------------------
get_swa_location_candidates() {
  local requested
  requested=$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

  case "$requested" in
    southindia)
      echo "southindia centralindia westindia southeastasia eastasia japaneast"
      ;;
    centralindia)
      echo "centralindia southindia westindia southeastasia eastasia japaneast"
      ;;
    westindia)
      echo "westindia centralindia southindia southeastasia eastasia westeurope"
      ;;
    southeastasia)
      echo "southeastasia eastasia japaneast centralindia southindia"
      ;;
    eastasia)
      echo "eastasia southeastasia japaneast centralindia southindia"
      ;;
    *)
      # Generic fallback order if location is not in the hand-tuned map.
      echo "$requested centralindia southeastasia eastasia eastus2 westeurope"
      ;;
  esac
}

resolve_swa_location() {
  local requested supported_raw supported_normalized candidates candidate first_supported
  requested=$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

  supported_raw=$(az provider show \
    --namespace Microsoft.Web \
    --query "resourceTypes[?resourceType=='staticSites'].locations[]" \
    --output tsv 2>/dev/null || true)

  if [[ -z "$supported_raw" ]]; then
    log_skip "Could not fetch supported Static Web App regions; using requested location '$1'" >&2
    echo "$1"
    return
  fi

  supported_normalized=$(echo "$supported_raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
  candidates=$(get_swa_location_candidates "$requested")

  for candidate in $candidates; do
    if echo "$supported_normalized" | grep -Fxq "$candidate"; then
      echo "$candidate"
      return
    fi
  done

  first_supported=$(echo "$supported_normalized" | head -n 1)
  if [[ -n "$first_supported" ]]; then
    log_skip "No nearby Static Web App region match found; using supported region '$first_supported'" >&2
    echo "$first_supported"
  else
    log_skip "Supported Static Web App region list was empty; using requested location '$1'" >&2
    echo "$1"
  fi
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
log_head "Prerequisite checks"

if ! command -v az &>/dev/null; then
  die "Azure CLI (az) is not installed or not on PATH. Install from https://aka.ms/installazurecliwindows"
fi
log_ok "Azure CLI found: $(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo 'unknown version')"

# Verify login and ensure token is fresh (az account show can succeed with
# stale cached metadata even when the MSAL token has expired; get-access-token
# forces an actual token fetch and fails fast if re-auth is needed).
log_info "Verifying Azure credentials..."
if ! az account get-access-token --output none 2>/dev/null; then
  log_info "Token missing or expired. Launching az login..."
  az login --output none
fi

CURRENT_ACCOUNT=$(az account show --query "name" --output tsv)
if [[ -z "$CURRENT_ACCOUNT" ]]; then
  die "Could not determine current Azure account after login."
fi
log_ok "Logged in. Current account: $CURRENT_ACCOUNT"

# Set subscription if provided
if [[ -n "$SUBSCRIPTION" ]]; then
  log_info "Setting subscription to: $SUBSCRIPTION"
  az account set --subscription "$SUBSCRIPTION"
fi

SUBSCRIPTION_ID=$(az account show --query "id" --output tsv)
SUBSCRIPTION_NAME=$(az account show --query "name" --output tsv)
log_ok "Subscription: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"

SWA_LOCATION=$(resolve_swa_location "$LOCATION")
REQUESTED_LOCATION_NORMALIZED=$(echo "$LOCATION" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
if [[ "$SWA_LOCATION" == "$REQUESTED_LOCATION_NORMALIZED" ]]; then
  log_ok "Static Web App location: $SWA_LOCATION"
else
  log_info "Static Web App location fallback: requested '$LOCATION', using '$SWA_LOCATION'"
fi

# ---------------------------------------------------------------------------
# Reset: delete resource group before provisioning if --reset was passed
# ---------------------------------------------------------------------------
if [[ "$RESET" == "true" ]]; then
  EXISTING_RG_CHECK=$(az group show --name "$RG_NAME" --query "name" --output tsv 2>/dev/null || true)
  if [[ -z "$EXISTING_RG_CHECK" ]]; then
    log_info "Resource group '$RG_NAME' does not exist -- nothing to reset. Proceeding with fresh provisioning."
  else
    reset_environment "$RG_NAME"
  fi
fi

# ---------------------------------------------------------------------------
# Summary before proceeding
# ---------------------------------------------------------------------------
log_head "Provisioning plan"
echo "  Environment  : $ENV"
echo "  Deploy target: $TARGET_SCOPE_LABEL"
echo "  Location     : $LOCATION"
echo "  Prefix       : $PREFIX"
echo "  Subscription : $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"
echo ""
echo "  Resources to provision:"
echo "    Resource Group     : $RG_NAME"
echo "    Log Analytics WS   : $LAW_NAME"
echo "    Application Insights: $APPINSIGHTS_NAME"
echo "    Key Vault          : $KV_NAME"
echo "    App Service Plan   : $PLAN_NAME"
echo "    App Service (API)  : $API_APP_NAME"
echo "    Static Web App     : $SWA_NAME ($SWA_LOCATION)"
if [[ "$SKIP_OIDC" == "false" ]]; then
echo "    App Registration   : ${PREFIX}-github-actions (OIDC for GitHub Actions)"
fi
echo ""

# ---------------------------------------------------------------------------
# Helper: check whether a resource already exists by querying its ID
# Returns 0 (exists) or 1 (does not exist)
# ---------------------------------------------------------------------------
resource_exists() {
  local id
  id=$(az resource show --ids "$1" --query "id" --output tsv 2>/dev/null || true)
  [[ -n "$id" ]]
}

# Retry helper for transient Azure control-plane lag.
run_az_with_retry() {
  local max_attempts=6
  local delay_seconds=10
  local attempt=1
  local output
  local exit_code

  while true; do
    set +e
    output=$("$@" 2>&1)
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
      if [[ -n "$output" ]]; then
        echo "$output"
      fi
      return 0
    fi

    if echo "$output" | grep -qE "ResourceNotFound|PrincipalNotFound|does not exist in the directory|ConnectionResetError|Connection aborted|ConnectionError|HTTPSConnectionPool" && [[ $attempt -lt $max_attempts ]]; then
      log_info "Transient Azure error (control plane or network). Retrying (${attempt}/${max_attempts}) in ${delay_seconds}s..."
      sleep "$delay_seconds"
      attempt=$((attempt + 1))
      continue
    fi

    echo "$output" >&2
    return "$exit_code"
  done
}

# Like run_az_with_retry, but treats resource-not-found responses as an empty
# result (exit 0) instead of an error. Use for existence checks that previously
# used the  az ... 2>/dev/null || true  pattern, to add network-error retry
# without changing the semantics of "not found = empty string".
az_or_empty() {
  local max_attempts=6
  local delay_seconds=10
  local attempt=1
  local output
  local exit_code

  while true; do
    set +e
    output=$("$@" 2>&1)
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 ]]; then
      echo "$output"
      return 0
    fi

    # Resource genuinely does not exist: return empty, exit 0 (mirrors || true)
    if echo "$output" | grep -qiE "ResourceNotFound|was not found|could not be found|does not exist|Code: 404|NotFound|ResourceGroupNotFound"; then
      return 0
    fi

    # Transient network or control-plane error: retry
    if echo "$output" | grep -qE "ConnectionResetError|Connection aborted|ConnectionError|HTTPSConnectionPool" && [[ $attempt -lt $max_attempts ]]; then
      log_info "Transient network error on existence check. Retrying (${attempt}/${max_attempts}) in ${delay_seconds}s..."
      sleep "$delay_seconds"
      attempt=$((attempt + 1))
      continue
    fi

    # Any other error: return empty (preserve original || true behaviour)
    return 0
  done
}

# ---------------------------------------------------------------------------
# 1. Resource Group
# ---------------------------------------------------------------------------
log_head "Resource Group"

EXISTING_RG=$(az group show --name "$RG_NAME" --query "name" --output tsv 2>/dev/null || true)
if [[ -n "$EXISTING_RG" ]]; then
  log_skip "Resource group '$RG_NAME' already exists"
else
  az group create \
    --name "$RG_NAME" \
    --location "$LOCATION" \
    --output none
  log_ok "Created resource group: $RG_NAME"
fi

# ---------------------------------------------------------------------------
# 2. Log Analytics Workspace
# ---------------------------------------------------------------------------
log_head "Log Analytics Workspace"

EXISTING_LAW=$(az_or_empty az monitor log-analytics workspace show \
  --resource-group "$RG_NAME" \
  --workspace-name "$LAW_NAME" \
  --query "customerId" --output tsv)

if [[ -n "$EXISTING_LAW" ]]; then
  log_skip "Log Analytics Workspace '$LAW_NAME' already exists"
  LAW_ID=$(run_az_with_retry az monitor log-analytics workspace show \
    --resource-group "$RG_NAME" \
    --workspace-name "$LAW_NAME" \
    --query "id" --output tsv)
else
  LAW_ID=$(az monitor log-analytics workspace create \
    --resource-group "$RG_NAME" \
    --workspace-name "$LAW_NAME" \
    --location "$LOCATION" \
    --retention-time 30 \
    --query "id" --output tsv)
  log_ok "Created Log Analytics Workspace: $LAW_NAME"
fi

# ---------------------------------------------------------------------------
# 3. Application Insights
# ---------------------------------------------------------------------------
log_head "Application Insights"

EXISTING_AI=$(az_or_empty az monitor app-insights component show \
  --resource-group "$RG_NAME" \
  --app "$APPINSIGHTS_NAME" \
  --query "instrumentationKey" --output tsv)

if [[ -n "$EXISTING_AI" ]]; then
  log_skip "Application Insights '$APPINSIGHTS_NAME' already exists"
  AI_CONNECTION_STRING=$(run_az_with_retry az monitor app-insights component show \
    --resource-group "$RG_NAME" \
    --app "$APPINSIGHTS_NAME" \
    --query "connectionString" --output tsv)
else
  AI_CONNECTION_STRING=$(az monitor app-insights component create \
    --resource-group "$RG_NAME" \
    --app "$APPINSIGHTS_NAME" \
    --location "$LOCATION" \
    --kind web \
    --application-type web \
    --workspace "$LAW_ID" \
    --query "connectionString" --output tsv)
  log_ok "Created Application Insights: $APPINSIGHTS_NAME"
fi

# ---------------------------------------------------------------------------
# 4. Key Vault
# ---------------------------------------------------------------------------
log_head "Key Vault"

EXISTING_KV=$(az_or_empty az keyvault show \
  --resource-group "$RG_NAME" \
  --name "$KV_NAME" \
  --query "name" --output tsv)

if [[ -n "$EXISTING_KV" ]]; then
  log_skip "Key Vault '$KV_NAME' already exists"
else
  az keyvault create \
    --resource-group "$RG_NAME" \
    --name "$KV_NAME" \
    --location "$LOCATION" \
    --enable-rbac-authorization false \
    --sku standard \
    --output none
  log_ok "Created Key Vault: $KV_NAME"
fi

# Grant the current user access to set secrets
CURRENT_USER_ID=$(az ad signed-in-user show --query "id" --output tsv 2>/dev/null || true)
if [[ -n "$CURRENT_USER_ID" ]]; then
  log_info "Setting Key Vault access policy for current user..."
  az keyvault set-policy \
    --name "$KV_NAME" \
    --resource-group "$RG_NAME" \
    --object-id "$CURRENT_USER_ID" \
    --secret-permissions get list set delete \
    --output none
  log_ok "Key Vault access policy set for current user"
else
  log_skip "Could not determine current user ID -- skipping Key Vault access policy"
fi

# Populate placeholder secrets for both production app and staging slot.
# Secret names use hyphens as required by Key Vault naming rules.
log_info "Seeding Key Vault placeholder secrets for PROD and STAGING groups..."

declare -a KV_SECRET_BASENAMES=(
  "MONGODB-URI"
  "MONGODB-DB-NAME"
  "JWT-SECRET"
  "ENCRYPTION-KEY"
  "INSTAGRAM-APP-ID"
  "INSTAGRAM-APP-SECRET"
  "INSTAGRAM-REDIRECT-URI"
  "RAZORPAY-KEY-ID"
  "RAZORPAY-KEY-SECRET"
  "RAZORPAY-WEBHOOK-SECRET"
  "FIREBASE-SERVICE-ACCOUNT-KEY"
)

for GROUP_PREFIX in PROD STAGING; do
  for SECRET_BASENAME in "${KV_SECRET_BASENAMES[@]}"; do
    SECRET_NAME="${GROUP_PREFIX}-${SECRET_BASENAME}"
    EXISTING_SECRET=$(az keyvault secret show \
      --vault-name "$KV_NAME" \
      --name "$SECRET_NAME" \
      --query "name" --output tsv 2>/dev/null || true)

    if [[ -n "$EXISTING_SECRET" ]]; then
      log_skip "Secret '$SECRET_NAME' already exists in Key Vault"
    else
      az keyvault secret set \
        --vault-name "$KV_NAME" \
        --name "$SECRET_NAME" \
        --value "PLACEHOLDER - replace with actual value" \
        --output none
      log_ok "Created placeholder secret: $SECRET_NAME"
    fi
  done
done

# ---------------------------------------------------------------------------
# 5. App Service Plan (shared, Standard)
# ---------------------------------------------------------------------------
log_head "App Service Plan"

PLAN_SKU="S1"

EXISTING_PLAN=$(az_or_empty az appservice plan show \
  --resource-group "$RG_NAME" \
  --name "$PLAN_NAME" \
  --query "name" --output tsv)

if [[ -n "$EXISTING_PLAN" ]]; then
  log_skip "App Service Plan '$PLAN_NAME' already exists"
else
  az appservice plan create \
    --resource-group "$RG_NAME" \
    --name "$PLAN_NAME" \
    --location "$LOCATION" \
    --is-linux \
    --sku "$PLAN_SKU" \
    --output none
  log_ok "Created App Service Plan: $PLAN_NAME ($PLAN_SKU Linux)"
fi

# ---------------------------------------------------------------------------
# 6. App Service Web App (Express API)
# ---------------------------------------------------------------------------
# Note: apps/publisher and apps/content-engine are deployed as Azure WebJobs
# (continuous) under this same App Service. The WebJob binaries are placed in
# App_Data/jobs/continuous/publisher/ and App_Data/jobs/continuous/content-engine/
# respectively during the CI/CD deployment step. No additional Azure resources
# are needed for them.
# ---------------------------------------------------------------------------
log_head "App Service Web App (API + WebJobs)"

EXISTING_APP=$(az_or_empty az webapp show \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --query "name" --output tsv)

if [[ -n "$EXISTING_APP" ]]; then
  log_skip "App Service '$API_APP_NAME' already exists"
else
  az webapp create \
    --resource-group "$RG_NAME" \
    --plan "$PLAN_NAME" \
    --name "$API_APP_NAME" \
    --runtime "NODE:22-lts" \
    --output none
  log_ok "Created App Service: $API_APP_NAME"
fi

# Create or verify staging slot once; staging env targets this slot.
EXISTING_STAGING_SLOT=$(az_or_empty az webapp deployment slot list \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --query "[?name=='$APP_SLOT_NAME'].name | [0]" \
  --output tsv)

if [[ -n "$EXISTING_STAGING_SLOT" ]]; then
  log_skip "App Service slot '$APP_SLOT_NAME' already exists"
else
  az webapp deployment slot create \
    --resource-group "$RG_NAME" \
    --name "$API_APP_NAME" \
    --slot "$APP_SLOT_NAME" \
    --output none
  log_ok "Created App Service slot: $APP_SLOT_NAME"
fi

configure_app_target() {
  local target_env="$1"
  local secret_group_prefix="$2"
  shift 2
  local target_args=("$@")

  log_info "Configuring App Service settings for $target_env..."

  run_az_with_retry az webapp config set \
    "${target_args[@]}" \
    --startup-file "node apps/api/dist/index.js" \
    --output none

  run_az_with_retry az webapp config appsettings set \
    "${target_args[@]}" \
    --settings \
      NODE_ENV="$target_env" \
      PORT="8080" \
      WEBSITE_NODE_DEFAULT_VERSION="~22" \
      SCM_DO_BUILD_DURING_DEPLOYMENT="false" \
      APPLICATIONINSIGHTS_CONNECTION_STRING="$AI_CONNECTION_STRING" \
      LOG_LEVEL="info" \
      OTEL_TRACES_SAMPLER_ARG="0.1" \
    --output none

  run_az_with_retry az webapp config appsettings set \
    "${target_args[@]}" \
    --settings \
      MONGODB_URI="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-MONGODB-URI)" \
      MONGODB_DB_NAME="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-MONGODB-DB-NAME)" \
      JWT_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-JWT-SECRET)" \
      ENCRYPTION_KEY="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-ENCRYPTION-KEY)" \
      INSTAGRAM_APP_ID="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-INSTAGRAM-APP-ID)" \
      INSTAGRAM_APP_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-INSTAGRAM-APP-SECRET)" \
      INSTAGRAM_REDIRECT_URI="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-INSTAGRAM-REDIRECT-URI)" \
      RAZORPAY_KEY_ID="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-RAZORPAY-KEY-ID)" \
      RAZORPAY_KEY_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-RAZORPAY-KEY-SECRET)" \
      RAZORPAY_WEBHOOK_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-RAZORPAY-WEBHOOK-SECRET)" \
      FIREBASE_SERVICE_ACCOUNT_KEY="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=${secret_group_prefix}-FIREBASE-SERVICE-ACCOUNT-KEY)" \
    --output none

  log_ok "App Service settings configured for $target_env"
}

PROD_TARGET_ARGS=(--resource-group "$RG_NAME" --name "$API_APP_NAME")
STAGING_TARGET_ARGS=(--resource-group "$RG_NAME" --name "$API_APP_NAME" --slot "$APP_SLOT_NAME")

if [[ "$ENV" == "production" ]]; then
  configure_app_target "production" "PROD" "${PROD_TARGET_ARGS[@]}"
elif [[ "$ENV" == "staging" ]]; then
  configure_app_target "staging" "STAGING" "${STAGING_TARGET_ARGS[@]}"
else
  configure_app_target "production" "PROD" "${PROD_TARGET_ARGS[@]}"
  configure_app_target "staging" "STAGING" "${STAGING_TARGET_ARGS[@]}"
fi

# Grant App Service managed identity access to Key Vault
log_info "Enabling system-assigned managed identity for App Service (production + staging slot)..."
PROD_PRINCIPAL_ID=$(run_az_with_retry az webapp identity assign \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --query "principalId" --output tsv)

SLOT_PRINCIPAL_ID=$(run_az_with_retry az webapp identity assign \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --slot "$APP_SLOT_NAME" \
  --query "principalId" --output tsv)

log_info "Granting separate Key Vault access policies to production app identity and staging slot identity..."
if [[ -n "$PROD_PRINCIPAL_ID" ]]; then
  az keyvault set-policy \
    --name "$KV_NAME" \
    --resource-group "$RG_NAME" \
    --object-id "$PROD_PRINCIPAL_ID" \
    --secret-permissions get list \
    --output none
fi
if [[ -n "$SLOT_PRINCIPAL_ID" ]]; then
  az keyvault set-policy \
    --name "$KV_NAME" \
    --resource-group "$RG_NAME" \
    --object-id "$SLOT_PRINCIPAL_ID" \
    --secret-permissions get list \
    --output none
fi

log_ok "Managed identity configured and Key Vault access granted"

# ---------------------------------------------------------------------------
# 7. Static Web App (React SPA)
# ---------------------------------------------------------------------------
log_head "Static Web App (Frontend)"

EXISTING_SWA=$(az_or_empty az staticwebapp show \
  --resource-group "$RG_NAME" \
  --name "$SWA_NAME" \
  --query "name" --output tsv)

if [[ -n "$EXISTING_SWA" ]]; then
  log_skip "Static Web App '$SWA_NAME' already exists"
  SWA_URL=$(run_az_with_retry az staticwebapp show \
    --resource-group "$RG_NAME" \
    --name "$SWA_NAME" \
    --query "defaultHostname" --output tsv)
  SWA_TOKEN=$(run_az_with_retry az staticwebapp secrets list \
    --resource-group "$RG_NAME" \
    --name "$SWA_NAME" \
    --query "properties.apiKey" --output tsv)
else
  SWA_URL=$(az staticwebapp create \
    --resource-group "$RG_NAME" \
    --name "$SWA_NAME" \
    --location "$SWA_LOCATION" \
    --sku Free \
    --query "defaultHostname" --output tsv)
  log_ok "Created Static Web App: $SWA_NAME ($SWA_LOCATION)"

  SWA_TOKEN=$(az staticwebapp secrets list \
    --resource-group "$RG_NAME" \
    --name "$SWA_NAME" \
    --query "properties.apiKey" --output tsv)
fi

# Apply CORS origin after SWA URL is known.
log_info "Configuring CORS_ORIGIN using Static Web App hostname..."
if [[ "$ENV" == "production" ]]; then
  run_az_with_retry az webapp config appsettings set \
    "${PROD_TARGET_ARGS[@]}" \
    --settings CORS_ORIGIN="https://$SWA_URL" \
    --output none
elif [[ "$ENV" == "staging" ]]; then
  run_az_with_retry az webapp config appsettings set \
    "${STAGING_TARGET_ARGS[@]}" \
    --settings CORS_ORIGIN="https://$SWA_URL" \
    --output none
else
  run_az_with_retry az webapp config appsettings set \
    "${PROD_TARGET_ARGS[@]}" \
    --settings CORS_ORIGIN="https://$SWA_URL" \
    --output none
  run_az_with_retry az webapp config appsettings set \
    "${STAGING_TARGET_ARGS[@]}" \
    --settings CORS_ORIGIN="https://$SWA_URL" \
    --output none
fi
log_ok "CORS_ORIGIN configured"

# ---------------------------------------------------------------------------
# 8. OIDC: App Registration + Federated Credentials + Role Assignments
# ---------------------------------------------------------------------------
APP_CLIENT_ID=""
TENANT_ID=$(az account show --query "tenantId" --output tsv)

if [[ "$SKIP_OIDC" == "true" ]]; then
  log_head "OIDC setup (skipped)"
  log_skip "Skipping App Registration and federated credential setup (--skip-oidc)"
else
  log_head "OIDC: App Registration + Federated Credentials"

  APP_DISPLAY_NAME="${PREFIX}-github-actions"

  # Find or create the App Registration
  EXISTING_APP_ID=$(az ad app list \
    --display-name "$APP_DISPLAY_NAME" \
    --query "[0].appId" --output tsv 2>/dev/null || true)

  if [[ -n "$EXISTING_APP_ID" ]]; then
    log_skip "App Registration '$APP_DISPLAY_NAME' already exists (appId: $EXISTING_APP_ID)"
    APP_CLIENT_ID="$EXISTING_APP_ID"
  else
    APP_CLIENT_ID=$(az ad app create \
      --display-name "$APP_DISPLAY_NAME" \
      --query "appId" --output tsv)
    log_ok "Created App Registration: $APP_DISPLAY_NAME (appId: $APP_CLIENT_ID)"
  fi

  # Create Service Principal if it doesn't exist
  EXISTING_SP=$(az ad sp show --id "$APP_CLIENT_ID" --query "appId" --output tsv 2>/dev/null || true)
  if [[ -n "$EXISTING_SP" ]]; then
    log_skip "Service Principal for '$APP_DISPLAY_NAME' already exists"
  else
    az ad sp create --id "$APP_CLIENT_ID" --output none
    log_ok "Created Service Principal for: $APP_DISPLAY_NAME"
  fi

  SP_OBJECT_ID=$(az ad sp show --id "$APP_CLIENT_ID" --query "id" --output tsv)

  # Brief wait for Azure AD replication when the SP was just created.
  # Role assignments fail with PrincipalNotFound if the SP hasn't propagated yet.
  if [[ -z "$EXISTING_SP" ]]; then
    log_info "Waiting 15s for Service Principal to propagate across Azure AD..."
    sleep 15
  fi

  # Add federated credentials for each GitHub environment
  for GH_ENV in staging production; do
    CRED_NAME="github-${GH_ENV}"
    SUBJECT="repo:${GITHUB_REPO}:environment:${GH_ENV}"

    EXISTING_CRED=$(az ad app federated-credential list \
      --id "$APP_CLIENT_ID" \
      --query "[?name=='$CRED_NAME'].name | [0]" --output tsv 2>/dev/null || true)

    if [[ -n "$EXISTING_CRED" ]]; then
      log_skip "Federated credential '$CRED_NAME' already exists"
    else
      az ad app federated-credential create \
        --id "$APP_CLIENT_ID" \
        --parameters "{
          \"name\": \"$CRED_NAME\",
          \"issuer\": \"https://token.actions.githubusercontent.com\",
          \"subject\": \"$SUBJECT\",
          \"description\": \"GitHub Actions $GH_ENV environment\",
          \"audiences\": [\"api://AzureADTokenExchange\"]
        }" \
        --output none
      log_ok "Created federated credential: $CRED_NAME (subject: $SUBJECT)"
    fi
  done

  # Use the well-known Contributor role definition ID to avoid a role name
  # resolution REST call that fails with MissingSubscription in some CLI versions.
  CONTRIBUTOR_ROLE_ID="b24988ac-6180-42a0-ab88-20f7382dd24c"

  # Grant Contributor on the resource group (covers App Service + WebJobs)
  RG_SCOPE="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}"
  EXISTING_RG_ROLE=$(az role assignment list \
    --scope "$RG_SCOPE" \
    --assignee-object-id "$SP_OBJECT_ID" \
    --query "[?roleDefinitionId=='$CONTRIBUTOR_ROLE_ID'].id | [0]" \
    --output tsv 2>/dev/null || true)

  if [[ -n "$EXISTING_RG_ROLE" ]]; then
    log_skip "Contributor role on resource group already assigned"
  else
    run_az_with_retry az role assignment create \
      --scope "$RG_SCOPE" \
      --role "$CONTRIBUTOR_ROLE_ID" \
      --assignee-object-id "$SP_OBJECT_ID" \
      --assignee-principal-type ServicePrincipal \
      --output none
    log_ok "Granted Contributor on resource group: $RG_NAME"
  fi

  # Grant Contributor on the Static Web App resource specifically
  SWA_RESOURCE_ID=$(az staticwebapp show \
    --resource-group "$RG_NAME" \
    --name "$SWA_NAME" \
    --query "id" --output tsv 2>/dev/null || true)

  if [[ -n "$SWA_RESOURCE_ID" ]]; then
    EXISTING_SWA_ROLE=$(az role assignment list \
      --scope "$SWA_RESOURCE_ID" \
      --assignee-object-id "$SP_OBJECT_ID" \
      --query "[?roleDefinitionId=='$CONTRIBUTOR_ROLE_ID'].id | [0]" \
      --output tsv 2>/dev/null || true)

    if [[ -n "$EXISTING_SWA_ROLE" ]]; then
      log_skip "Contributor role on Static Web App already assigned"
    else
      run_az_with_retry az role assignment create \
        --scope "$SWA_RESOURCE_ID" \
        --role "$CONTRIBUTOR_ROLE_ID" \
        --assignee-object-id "$SP_OBJECT_ID" \
        --assignee-principal-type ServicePrincipal \
        --output none
      log_ok "Granted Contributor on Static Web App: $SWA_NAME"
    fi
  else
    log_skip "Static Web App not found -- skipping SWA role assignment"
  fi

  log_ok "OIDC setup complete (appId: $APP_CLIENT_ID)"
fi

# ---------------------------------------------------------------------------
# Retrieve App Service URL for GitHub Actions
# ---------------------------------------------------------------------------
log_head "Retrieving deployment outputs"

PROD_API_APP_URL=$(az webapp show \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --query "defaultHostName" --output tsv)

STAGING_API_APP_URL=$(az webapp show \
  --resource-group "$RG_NAME" \
  --name "$API_APP_NAME" \
  --slot "$APP_SLOT_NAME" \
  --query "defaultHostName" --output tsv)

KV_URI=$(az keyvault show \
  --resource-group "$RG_NAME" \
  --name "$KV_NAME" \
  --query "properties.vaultUri" --output tsv)

# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------
log_head "Provisioning complete"

echo "${C_BOLD}Resource Names${C_RESET}"
echo "--------------------------------------------------------------"
printf "  %-30s %s\n" "Resource Group:"       "$RG_NAME"
printf "  %-30s %s\n" "Log Analytics WS:"     "$LAW_NAME"
printf "  %-30s %s\n" "Application Insights:" "$APPINSIGHTS_NAME"
printf "  %-30s %s\n" "Key Vault:"            "$KV_NAME"
printf "  %-30s %s\n" "App Service Plan:"     "$PLAN_NAME"
printf "  %-30s %s\n" "App Service (API):"    "$API_APP_NAME"
printf "  %-30s %s\n" "Target Scope:"         "$TARGET_SCOPE_LABEL"
printf "  %-30s %s\n" "Static Web App:"       "$SWA_NAME"
echo ""

echo "${C_BOLD}Endpoints${C_RESET}"
echo "--------------------------------------------------------------"
if [[ "$ENV" == "production" ]]; then
  printf "  %-30s %s\n" "API URL (Production):" "https://$PROD_API_APP_URL"
elif [[ "$ENV" == "staging" ]]; then
  printf "  %-30s %s\n" "API URL (Staging Slot):" "https://$STAGING_API_APP_URL"
else
  printf "  %-30s %s\n" "API URL (Production):" "https://$PROD_API_APP_URL"
  printf "  %-30s %s\n" "API URL (Staging Slot):" "https://$STAGING_API_APP_URL"
fi
printf "  %-30s %s\n" "Frontend URL:"         "https://$SWA_URL"
printf "  %-30s %s\n" "Key Vault URI:"        "$KV_URI"
echo ""

if [[ "$SKIP_OIDC" == "false" && -n "$APP_CLIENT_ID" ]]; then
  echo "${C_BOLD}GitHub Actions Variables (add to each environment in repo Settings > Environments)${C_RESET}"
  echo "--------------------------------------------------------------"
  printf "  %-45s %s\n" "AZURE_CLIENT_ID:"                      "$APP_CLIENT_ID"
  printf "  %-45s %s\n" "AZURE_TENANT_ID:"                      "$TENANT_ID"
  printf "  %-45s %s\n" "AZURE_SUBSCRIPTION_ID:"                "$SUBSCRIPTION_ID"
  printf "  %-45s %s\n" "AZURE_WEBAPP_NAME_STAGING:"            "${API_APP_NAME}/slots/staging"
  printf "  %-45s %s\n" "AZURE_WEBAPP_NAME_PROD:"               "$API_APP_NAME"
  printf "  %-45s %s\n" "STAGING_API_URL:"                      "https://$STAGING_API_APP_URL"
  printf "  %-45s %s\n" "STAGING_WEB_URL:"                      "https://$SWA_URL"
  printf "  %-45s %s\n" "PRODUCTION_API_URL:"                   "https://$PROD_API_APP_URL"
  printf "  %-45s %s\n" "PRODUCTION_WEB_URL:"                   "https://$SWA_URL"
  printf "  %-45s %s\n" "APPLICATIONINSIGHTS_CONNECTION_STRING:" "$AI_CONNECTION_STRING"
  echo ""
  echo "  These are environment variables (not secrets). Set them under:"
  echo "  GitHub repo > Settings > Environments > staging (and production)"
  echo ""
else
  echo "${C_BOLD}GitHub Actions Variables${C_RESET}"
  echo "--------------------------------------------------------------"
  printf "  %-45s %s\n" "AZURE_SUBSCRIPTION_ID:"                "$SUBSCRIPTION_ID"
  printf "  %-45s %s\n" "AZURE_WEBAPP_NAME_STAGING:"            "${API_APP_NAME}/slots/staging"
  printf "  %-45s %s\n" "AZURE_WEBAPP_NAME_PROD:"               "$API_APP_NAME"
  printf "  %-45s %s\n" "STAGING_API_URL:"                      "https://$STAGING_API_APP_URL"
  printf "  %-45s %s\n" "STAGING_WEB_URL:"                      "https://$SWA_URL"
  printf "  %-45s %s\n" "PRODUCTION_API_URL:"                   "https://$PROD_API_APP_URL"
  printf "  %-45s %s\n" "PRODUCTION_WEB_URL:"                   "https://$SWA_URL"
  printf "  %-45s %s\n" "APPLICATIONINSIGHTS_CONNECTION_STRING:" "$AI_CONNECTION_STRING"
  echo ""
  echo "  OIDC was skipped. Run without --skip-oidc to create the App Registration"
  echo "  and get AZURE_CLIENT_ID / AZURE_TENANT_ID values."
  echo ""
fi

echo "${C_BOLD}Next steps${C_RESET}"
echo "--------------------------------------------------------------"
echo "  1. Fill in real values for Key Vault secrets using the reusable script:"
echo "     bash scripts/set-keyvault-secrets.sh --env staging \\"
echo "       --mongodb-uri '<value>' --mongodb-db-name '<value>' \\"
echo "       --jwt-secret '<value>' --encryption-key '<value>' \\"
echo "       --instagram-app-id '<value>' --instagram-app-secret '<value>' \\"
echo "       --instagram-redirect-uri 'https://$STAGING_API_APP_URL/api/integrations/instagram/callback' \\"
echo "       --firebase-service-account-key '<json>' \\"
echo "       --razorpay-key-id '<value>' --razorpay-key-secret '<value>' \\"
echo "       --razorpay-webhook-secret '<value>' \\"
echo "       --frontend-url 'https://$SWA_URL' \\"
echo "       --backend-url 'https://$STAGING_API_APP_URL' \\"
echo "       --asset-server-base-url 'https://$STAGING_API_APP_URL/content/mockdata'"
echo ""
echo "     Run with --env production for the production slot."
echo "     Key Vault references and CORS settings are already automated by this script."
echo ""
echo "  2. CORS_ORIGIN has been set automatically from the SWA URL above."
echo "     FRONTEND_URL and BACKEND_URL must be set via set-keyvault-secrets.sh (step 1)."
echo ""
echo "  3. Copy the GitHub Actions variables printed above into:"
echo "     GitHub repo > Settings > Environments > staging and production"
echo ""
echo "  4. Deploy WebJobs (publisher + content-engine) as continuous WebJobs"
echo "     under the API App Service (see scripts/README-azure.md for details)."
echo ""

log_ok "Done."
