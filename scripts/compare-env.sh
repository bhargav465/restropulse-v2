#!/usr/bin/env bash
# =============================================================================
# compare-env.sh
#
# Compares local .env values against Azure cloud (App Service, Key Vault, SWA)
# and GitHub environment variables side-by-side in a formatted table.
#
# Usage:
#   bash scripts/compare-env.sh                        # staging, all apps
#   bash scripts/compare-env.sh --env production       # production slot
#   bash scripts/compare-env.sh --env staging --app api
#   bash scripts/compare-env.sh --env staging --app web
#   bash scripts/compare-env.sh --env staging --show-secrets
#
# Dependencies:
#   - az CLI (logged in)
#   - gh CLI (authenticated)
#   - jq
#
# Output columns: Variable | Local | Cloud/GitHub | Status
#
# Status values:
#   OK            local == cloud/github (exact match, or both masked as [SET])
#   MISMATCH      both set but values differ
#   LOCAL_ONLY    set locally, not in cloud/github
#   CLOUD_ONLY    set in cloud/github, not locally
#   EXPECTED_DIFF one side is a localhost URL, other is a real https:// URL
#   MISSING       required but not set anywhere
# =============================================================================

set -euo pipefail

# Prevent Git Bash (MSYS2) from converting Unix-style paths into Windows paths.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# On Git Bash/Windows, some tools are only available as *.exe.
# Provide lightweight shims so the script can call gh/jq uniformly.
if [[ -x "/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/python.exe" ]]; then
  az() { "/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/python.exe" -IBm azure.cli "$@"; }
fi
if ! command -v gh >/dev/null 2>&1 && command -v gh.exe >/dev/null 2>&1; then
  gh() { gh.exe "$@"; }
fi
if ! command -v jq >/dev/null 2>&1 && command -v jq.exe >/dev/null 2>&1; then
  jq() { jq.exe "$@"; }
fi

# ---------------------------------------------------------------------------
# Infrastructure constants
# ---------------------------------------------------------------------------
APP_NAME="restropulse-prod-api"
RG_NAME="restropulse-prod-rg"
KV_NAME="restropulse-prod-kv"
SWA_NAME="restropulse-prod-web"

# ---------------------------------------------------------------------------
# Column widths
# ---------------------------------------------------------------------------
COL_VAR=40
COL_LOCAL=25
COL_CLOUD=25
COL_STATUS=15

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ENV_TARGET="staging"
APP_FILTER=""
SHOW_SECRETS=false

# ---------------------------------------------------------------------------
# Color helpers (fall back to no color when not in a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  C_GREEN=$(tput setaf 2)
  C_YELLOW=$(tput setaf 3)
  C_RED=$(tput setaf 1)
  C_CYAN=$(tput setaf 6)
  C_RESET=$(tput sgr0)
else
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
  C_CYAN=""
  C_RESET=""
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
  echo "Usage: bash scripts/compare-env.sh [--env staging|production] [--app api|publisher|content-engine|web] [--show-secrets]"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_TARGET="${2:?--env requires a value (staging or production)}"
      shift 2
      ;;
    --app)
      APP_FILTER="${2:?--app requires a value (api, publisher, content-engine, or web)}"
      shift 2
      ;;
    --show-secrets)
      SHOW_SECRETS=true
      shift 1
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      ;;
  esac
done

if [[ "$ENV_TARGET" != "staging" && "$ENV_TARGET" != "production" ]]; then
  echo "Error: --env must be 'staging' or 'production'."
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine App Service slot flag
# ---------------------------------------------------------------------------
SLOT_ARGS=""
if [[ "$ENV_TARGET" == "staging" ]]; then
  SLOT_ARGS="--slot staging"
fi

# ---------------------------------------------------------------------------
# Sensitive key pattern
# ---------------------------------------------------------------------------
is_sensitive() {
  local key="$1"
  echo "$key" | grep -qiE 'SECRET|KEY|PASSWORD|TOKEN|ACCOUNT|CREDENTIAL|CONNECTION_STRING|PRIVATE'
}

mask_value() {
  local val="$1"
  if [[ -n "$val" ]]; then
    echo "[SET]"
  else
    echo "[NOT SET]"
  fi
}

# ---------------------------------------------------------------------------
# Truncate a display value to fit the column width
# ---------------------------------------------------------------------------
truncate_val() {
  local val="$1"
  local width="$2"
  if [[ ${#val} -gt $width ]]; then
    echo "${val:0:$((width - 3))}..."
  else
    echo "$val"
  fi
}

# ---------------------------------------------------------------------------
# Resolve Key Vault reference
# @Microsoft.KeyVault(SecretUri=https://...) or
# @Microsoft.KeyVault(VaultName=...;SecretName=...)
# Returns the resolved value or the original string on failure.
# ---------------------------------------------------------------------------
resolve_kv_ref() {
  local ref="$1"
  if [[ "$ref" != @Microsoft.KeyVault* ]]; then
    echo "$ref"
    return
  fi

  local secret_name=""
  local vault_name=""
  local secret_uri=""

  # SecretUri=https://<vault>.vault.azure.net/secrets/<name>[/version] form
  if [[ "$ref" == *"SecretUri="* ]]; then
    secret_uri=$(printf '%s' "$ref" | sed -n 's/.*SecretUri=\([^;)]*\).*/\1/p')
  fi

  # VaultName=...;SecretName=... form
  if [[ "$ref" == *"SecretName="* ]]; then
    secret_name=$(printf '%s' "$ref" | sed -n 's/.*SecretName=\([^;),]*\).*/\1/p')
    if [[ "$ref" == *"VaultName="* ]]; then
      vault_name=$(printf '%s' "$ref" | sed -n 's/.*VaultName=\([^;),]*\).*/\1/p')
    fi
  fi

  local resolved=""

  if [[ -n "$secret_uri" ]]; then
    # First try identifier mode, then parse URI into vault/name(/version) as fallback.
    resolved=$(az keyvault secret show \
      --id "$secret_uri" \
      --query "value" \
      -o tsv 2>/dev/null) || true

    if [[ -z "$resolved" ]]; then
      local uri_no_qs vault_from_uri secret_from_uri version_from_uri
      uri_no_qs="${secret_uri%%\?*}"
      if [[ "$uri_no_qs" =~ ^https://([^.]+)\.vault\.azure\.net/secrets/([^/]+)(/([^/]+))?$ ]]; then
        vault_from_uri="${BASH_REMATCH[1]}"
        secret_from_uri="${BASH_REMATCH[2]}"
        version_from_uri="${BASH_REMATCH[4]:-}"
        if [[ -n "$version_from_uri" ]]; then
          resolved=$(az keyvault secret show \
            --vault-name "$vault_from_uri" \
            --name "$secret_from_uri" \
            --version "$version_from_uri" \
            --query "value" \
            -o tsv 2>/dev/null) || true
        else
          resolved=$(az keyvault secret show \
            --vault-name "$vault_from_uri" \
            --name "$secret_from_uri" \
            --query "value" \
            -o tsv 2>/dev/null) || true
        fi
      fi
    fi
  elif [[ -n "$secret_name" ]]; then
    local target_vault="${vault_name:-$KV_NAME}"
    resolved=$(az keyvault secret show \
      --vault-name "$target_vault" \
      --name "$secret_name" \
      --query "value" \
      -o tsv 2>/dev/null) || true
  fi

  if [[ -z "$resolved" ]]; then
    echo "$ref"
    return
  fi

  # Strip Windows carriage return from az tsv output
  echo "${resolved%$'\r'}"
}

# ---------------------------------------------------------------------------
# resolve_secret_by_convention <key>
# Best-effort fallback for older CLI responses that return empty values
# for Key Vault-referenced app settings.
# Convention: <env>-<lowercase-key-with-dashes>
# ---------------------------------------------------------------------------
resolve_secret_by_convention() {
  local key="$1"
  local env_prefix
  if [[ "$ENV_TARGET" == "production" ]]; then
    env_prefix="prod"
  else
    env_prefix="staging"
  fi

  local secret_name
  secret_name="${key,,}"
  secret_name="${secret_name//_/-}"
  secret_name="${env_prefix}-${secret_name}"

  local resolved
  resolved=$(az keyvault secret show \
    --vault-name "$KV_NAME" \
    --name "$secret_name" \
    --query "value" \
    -o tsv 2>/dev/null) || true

  echo "${resolved%$'\r'}"
}

# ---------------------------------------------------------------------------
# load_local_env <env_file>
# Populates global associative array LOCAL_VARS.
# ---------------------------------------------------------------------------
load_local_env() {
  local env_file="$1"
  LOCAL_VARS=()

  if [[ ! -f "$env_file" ]]; then
    LOCAL_ENV_MISSING=true
    return
  fi

  LOCAL_ENV_MISSING=false

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip Windows carriage return
    line="${line%$'\r'}"
    # Skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == *=* ]]; then
      local key="${line%%=*}"
      local val="${line#*=}"
      # Strip surrounding quotes
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      key="${key## }"
      key="${key%% }"
      LOCAL_VARS["$key"]="$val"
    fi
  done < "$env_file"
}

# ---------------------------------------------------------------------------
# load_appservice_vars
# Populates global associative array CLOUD_VARS.
# Resolves Key Vault references inline.
# Uses az rest (POST to appsettings/list action) to avoid Azure CLI
# version differences where `az webapp config appsettings list` can
# return null values for Key Vault-referenced settings.
# ---------------------------------------------------------------------------
load_appservice_vars() {
  CLOUD_VARS=()
  CLOUD_FETCH_ERROR=false

  local raw="" parsed=false

  # Primary path: native command (most reliable for auth context).
  if [[ "$ENV_TARGET" == "staging" ]]; then
    raw=$(az webapp config appsettings list --name "$APP_NAME" --resource-group "$RG_NAME" --slot staging -o json 2>/dev/null) || true
  else
    raw=$(az webapp config appsettings list --name "$APP_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null) || true
  fi

  if [[ -n "$raw" ]] && echo "$raw" | jq -e 'type=="array"' >/dev/null 2>&1; then
    while IFS=$'\t' read -r key val; do
      [[ -z "$key" ]] && continue
      val="${val%$'\r'}"

      if [[ "$val" == @Microsoft.KeyVault* ]]; then
        val=$(resolve_kv_ref "$val")
      elif [[ -z "$val" ]] && [[ "$SHOW_SECRETS" == "true" ]] && is_sensitive "$key"; then
        # Older az CLI versions can return empty value for KV-referenced keys.
        local guessed
        guessed=$(resolve_secret_by_convention "$key")
        if [[ -n "$guessed" ]]; then
          val="$guessed"
        fi
      fi

      CLOUD_VARS["$key"]="$val"
    done < <(echo "$raw" | jq -r '.[] | [.name, (.value // "")] | @tsv' 2>/dev/null || true)
    parsed=true
  fi

  # Fallback path: ARM action (returns {properties:{...}}).
  if [[ "$parsed" != "true" ]]; then
    local subscription_id
    subscription_id=$(az account show --query "id" -o tsv 2>/dev/null) || { CLOUD_FETCH_ERROR=true; return; }

    local url_path
    if [[ "$ENV_TARGET" == "staging" ]]; then
      url_path="providers/Microsoft.Web/sites/${APP_NAME}/slots/staging/config/appsettings/list"
    else
      url_path="providers/Microsoft.Web/sites/${APP_NAME}/config/appsettings/list"
    fi

    local rest_url
    rest_url="https://management.azure.com/subscriptions/${subscription_id}/resourceGroups/${RG_NAME}/${url_path}?api-version=2022-03-01"
    raw=$(az rest --method POST --url "$rest_url" -o json 2>/dev/null) || { CLOUD_FETCH_ERROR=true; return; }
    if ! echo "$raw" | jq -e '.properties' &>/dev/null 2>&1; then
      CLOUD_FETCH_ERROR=true
      return
    fi

    while IFS=$'\t' read -r key val; do
      [[ -z "$key" ]] && continue
      val="${val%$'\r'}"
      if [[ "$val" == @Microsoft.KeyVault* ]]; then
        val=$(resolve_kv_ref "$val")
      elif [[ -z "$val" ]] && [[ "$SHOW_SECRETS" == "true" ]] && is_sensitive "$key"; then
        local guessed
        guessed=$(resolve_secret_by_convention "$key")
        if [[ -n "$guessed" ]]; then
          val="$guessed"
        fi
      fi
      CLOUD_VARS["$key"]="$val"
    done < <(echo "$raw" | jq -r '.properties | to_entries[] | [.key, (.value // "")] | @tsv' 2>/dev/null || true)
  fi
}

# ---------------------------------------------------------------------------
# load_github_vars <env_name>
# Populates global associative array GITHUB_VARS.
# gh variable list outputs tab-delimited: NAME\tVALUE\tUPDATED_AT
# ---------------------------------------------------------------------------
load_github_vars() {
  local gh_env="$1"
  GITHUB_VARS=()
  GITHUB_FETCH_ERROR=false

  local raw
  raw=$(gh variable list --env "$gh_env" 2>/dev/null) || { GITHUB_FETCH_ERROR=true; return; }

  if [[ -z "$raw" ]]; then
    # Empty environment is valid (not an error)
    return
  fi

  while IFS=$'\t' read -r key val _rest; do
    [[ -z "$key" ]] && continue
    GITHUB_VARS["$key"]="$val"
  done <<< "$raw"
}

# ---------------------------------------------------------------------------
# load_swa_vars
# Populates global associative array SWA_VARS (informational reference).
# ---------------------------------------------------------------------------
load_swa_vars() {
  SWA_VARS=()
  SWA_FETCH_ERROR=false

  local raw
  raw=$(az staticwebapp appsettings list \
    --name "$SWA_NAME" \
    --resource-group "$RG_NAME" \
    -o json 2>/dev/null) || { SWA_FETCH_ERROR=true; return; }

  if ! echo "$raw" | jq -e '.' &>/dev/null 2>&1; then
    SWA_FETCH_ERROR=true
    return
  fi

  # SWA appsettings list returns {"properties": {"KEY": "VALUE", ...}}
  while IFS=$'\t' read -r key val; do
    SWA_VARS["$key"]="$val"
  done < <(echo "$raw" | jq -r '.properties | to_entries[] | [.key, (.value // "")] | @tsv' 2>/dev/null || true)
}

# ---------------------------------------------------------------------------
# determine_status <local_val> <cloud_val> <key>
# Prints the status string.
# ---------------------------------------------------------------------------
determine_status() {
  local local_val="$1"
  local cloud_val="$2"
  local key="$3"

  local local_set=false
  local cloud_set=false
  [[ -n "$local_val" ]] && local_set=true
  [[ -n "$cloud_val" ]] && cloud_set=true

  if ! $local_set && ! $cloud_set; then
    echo "MISSING"
    return
  fi

  if $local_set && ! $cloud_set; then
    echo "LOCAL_ONLY"
    return
  fi

  if ! $local_set && $cloud_set; then
    echo "CLOUD_ONLY"
    return
  fi

  # Both are set. Check for expected diff (localhost vs real URL).
  if echo "$local_val" | grep -qE 'localhost|127\.0\.0\.1'; then
    if echo "$cloud_val" | grep -qE '^https://'; then
      echo "EXPECTED_DIFF"
      return
    fi
  fi

  if is_sensitive "$key"; then
    # For sensitive vars, both being set == OK.
    echo "OK"
    return
  fi

  if [[ "$local_val" == "$cloud_val" ]]; then
    echo "OK"
  else
    echo "MISMATCH"
  fi
}

# ---------------------------------------------------------------------------
# color_status <status>
# ---------------------------------------------------------------------------
color_status() {
  local status="$1"
  case "$status" in
    OK)            echo "${C_GREEN}${status}${C_RESET}" ;;
    EXPECTED_DIFF) echo "${C_CYAN}${status}${C_RESET}" ;;
    MISMATCH)      echo "${C_RED}${status}${C_RESET}" ;;
    LOCAL_ONLY)    echo "${C_YELLOW}${status}${C_RESET}" ;;
    CLOUD_ONLY)    echo "${C_YELLOW}${status}${C_RESET}" ;;
    MISSING)       echo "${C_RED}${status}${C_RESET}" ;;
    *)             echo "$status" ;;
  esac
}

# ---------------------------------------------------------------------------
# print_table_header <cloud_col_label>
# ---------------------------------------------------------------------------
print_table_header() {
  local cloud_label="$1"
  local divider
  divider=$(printf '%*s' $((COL_VAR + COL_LOCAL + COL_CLOUD + COL_STATUS + 9)) '' | tr ' ' '-')
  echo "$divider"
  printf "| %-*s | %-*s | %-*s | %-*s |\n" \
    $((COL_VAR - 2)) "Variable" \
    $((COL_LOCAL - 2)) "Local" \
    $((COL_CLOUD - 2)) "$cloud_label" \
    $((COL_STATUS - 2)) "Status"
  echo "$divider"
}

# ---------------------------------------------------------------------------
# print_table_footer
# ---------------------------------------------------------------------------
print_table_footer() {
  local divider
  divider=$(printf '%*s' $((COL_VAR + COL_LOCAL + COL_CLOUD + COL_STATUS + 9)) '' | tr ' ' '-')
  echo "$divider"
}

# ---------------------------------------------------------------------------
# print_table_row <key> <local_display> <cloud_display> <status>
# ---------------------------------------------------------------------------
print_table_row() {
  local key="$1"
  local local_display="$2"
  local cloud_display="$3"
  local status="$4"

  local key_trunc local_trunc cloud_trunc
  key_trunc=$(truncate_val "$key" $((COL_VAR - 2)))
  local_trunc=$(truncate_val "$local_display" $((COL_LOCAL - 2)))
  cloud_trunc=$(truncate_val "$cloud_display" $((COL_CLOUD - 2)))

  local colored_status
  colored_status=$(color_status "$status")

  # Use printf with padding, then color the status column separately
  printf "| %-*s | %-*s | %-*s | " \
    $((COL_VAR - 2)) "$key_trunc" \
    $((COL_LOCAL - 2)) "$local_trunc" \
    $((COL_CLOUD - 2)) "$cloud_trunc"
  printf "%-*s |\n" $((COL_STATUS - 2)) "$colored_status"
}

# ---------------------------------------------------------------------------
# compare_and_print_appservice <app_name> <env_file>
# Compares local env vs App Service appsettings.
# ---------------------------------------------------------------------------
compare_and_print_appservice() {
  local app_label="$1"
  local env_file="$2"

  echo ""
  echo "===================================================================="
  echo "App: ${app_label}  |  Env: ${ENV_TARGET}  |  Source: App Service appsettings"
  echo "===================================================================="

  # Load sources
  declare -A LOCAL_VARS
  declare -l LOCAL_ENV_MISSING
  LOCAL_ENV_MISSING=false
  load_local_env "$env_file"

  declare -A CLOUD_VARS
  declare -l CLOUD_FETCH_ERROR
  CLOUD_FETCH_ERROR=false
  load_appservice_vars

  if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
    echo "  Note: Local .env not found at ${env_file} -- local column shows [NO LOCAL ENV]"
  fi
  if [[ "$CLOUD_FETCH_ERROR" == "true" ]]; then
    echo "  Note: Failed to fetch App Service appsettings -- cloud column shows [FETCH ERROR]"
  fi

  print_table_header "Cloud (App Service)"

  # Collect all keys from both sources
  declare -A ALL_KEYS
  for k in "${!LOCAL_VARS[@]}"; do ALL_KEYS["$k"]=1; done
  for k in "${!CLOUD_VARS[@]}"; do ALL_KEYS["$k"]=1; done

  # Sort and print
  while IFS= read -r key; do
    local local_val="" cloud_val=""

    if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
      local_val=""
    else
      local_val="${LOCAL_VARS[$key]:-}"
    fi

    if [[ "$CLOUD_FETCH_ERROR" == "true" ]]; then
      cloud_val=""
    else
      cloud_val="${CLOUD_VARS[$key]:-}"
    fi

    local local_display cloud_display status

    if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
      local_display="[NO LOCAL ENV]"
    elif is_sensitive "$key" && [[ "$SHOW_SECRETS" != "true" ]]; then
      local_display=$(mask_value "$local_val")
    else
      local_display="${local_val:-[NOT SET]}"
    fi

    if [[ "$CLOUD_FETCH_ERROR" == "true" ]]; then
      cloud_display="[FETCH ERROR]"
    elif is_sensitive "$key" && [[ "$SHOW_SECRETS" != "true" ]]; then
      cloud_display=$(mask_value "$cloud_val")
    else
      cloud_display="${cloud_val:-[NOT SET]}"
    fi

    if [[ "$CLOUD_FETCH_ERROR" == "true" || "$LOCAL_ENV_MISSING" == "true" ]]; then
      status="UNKNOWN"
    else
      status=$(determine_status "$local_val" "$cloud_val" "$key")
    fi

    print_table_row "$key" "$local_display" "$cloud_display" "$status"
  done < <(printf '%s\n' "${!ALL_KEYS[@]}" | sort)

  print_table_footer
}

# ---------------------------------------------------------------------------
# compare_and_print_web <env_file>
# Compares local env vs GitHub env vars (primary) and SWA appsettings (ref).
# ---------------------------------------------------------------------------
compare_and_print_web() {
  local env_file="$1"

  echo ""
  echo "===================================================================="
  echo "App: web  |  Env: ${ENV_TARGET}  |  Source: GitHub env vars (primary)"
  echo "===================================================================="

  # Load sources
  declare -A LOCAL_VARS
  declare -l LOCAL_ENV_MISSING
  LOCAL_ENV_MISSING=false
  load_local_env "$env_file"

  declare -A GITHUB_VARS
  declare -l GITHUB_FETCH_ERROR
  GITHUB_FETCH_ERROR=false
  load_github_vars "$ENV_TARGET"

  declare -A SWA_VARS
  declare -l SWA_FETCH_ERROR
  SWA_FETCH_ERROR=false
  load_swa_vars

  if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
    echo "  Note: Local .env not found at ${env_file} -- local column shows [NO LOCAL ENV]"
  fi
  if [[ "$GITHUB_FETCH_ERROR" == "true" ]]; then
    echo "  Note: Failed to fetch GitHub vars -- cloud column shows [FETCH ERROR]"
  fi
  if [[ "$SWA_FETCH_ERROR" == "false" ]] && [[ ${#SWA_VARS[@]} -gt 0 ]]; then
    echo "  Note: SWA runtime appsettings also present (informational)."
  fi

  print_table_header "GitHub (${ENV_TARGET} env)"

  # Collect all keys from both sources
  declare -A ALL_KEYS
  for k in "${!LOCAL_VARS[@]}"; do ALL_KEYS["$k"]=1; done
  for k in "${!GITHUB_VARS[@]}"; do ALL_KEYS["$k"]=1; done

  while IFS= read -r key; do
    local local_val="" github_val=""

    if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
      local_val=""
    else
      local_val="${LOCAL_VARS[$key]:-}"
    fi

    if [[ "$GITHUB_FETCH_ERROR" == "true" ]]; then
      github_val=""
    else
      github_val="${GITHUB_VARS[$key]:-}"
    fi

    local local_display cloud_display status

    if [[ "$LOCAL_ENV_MISSING" == "true" ]]; then
      local_display="[NO LOCAL ENV]"
    elif is_sensitive "$key" && [[ "$SHOW_SECRETS" != "true" ]]; then
      local_display=$(mask_value "$local_val")
    else
      local_display="${local_val:-[NOT SET]}"
    fi

    if [[ "$GITHUB_FETCH_ERROR" == "true" ]]; then
      cloud_display="[FETCH ERROR]"
    elif is_sensitive "$key" && [[ "$SHOW_SECRETS" != "true" ]]; then
      cloud_display=$(mask_value "$github_val")
    else
      cloud_display="${github_val:-[NOT SET]}"
    fi

    if [[ "$GITHUB_FETCH_ERROR" == "true" || "$LOCAL_ENV_MISSING" == "true" ]]; then
      status="UNKNOWN"
    else
      status=$(determine_status "$local_val" "$github_val" "$key")
    fi

    print_table_row "$key" "$local_display" "$cloud_display" "$status"
  done < <(printf '%s\n' "${!ALL_KEYS[@]}" | sort)

  print_table_footer

  # Print SWA appsettings as a reference block if any were fetched
  if [[ "$SWA_FETCH_ERROR" == "false" ]] && [[ ${#SWA_VARS[@]} -gt 0 ]]; then
    echo ""
    echo "  SWA Runtime Appsettings (reference only -- VITE_* vars are build-time baked):"
    for k in $(printf '%s\n' "${!SWA_VARS[@]}" | sort); do
      local v="${SWA_VARS[$k]}"
      if is_sensitive "$k" && [[ "$SHOW_SECRETS" != "true" ]]; then
        v=$(mask_value "$v")
      fi
      printf "    %-40s = %s\n" "$k" "$v"
    done
  fi
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  echo "===================================================================="
  echo "RestroPulse -- Environment Comparison"
  echo "Target environment: ${ENV_TARGET}"
  echo "===================================================================="

  # Verify dependencies
  local missing_deps=false
  for dep in az gh jq; do
    if ! command -v "$dep" &>/dev/null; then
      echo "Error: required dependency '${dep}' not found on PATH."
      missing_deps=true
    fi
  done
  if $missing_deps; then
    exit 1
  fi

  # Determine which apps to process
  local apps=()
  if [[ -n "$APP_FILTER" ]]; then
    apps=("$APP_FILTER")
  else
    apps=("api" "publisher" "content-engine" "web")
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local repo_root
  repo_root="$(cd "${script_dir}/.." && pwd)"

  for app in "${apps[@]}"; do
    case "$app" in
      api)
        compare_and_print_appservice "api" "${repo_root}/apps/api/.env"
        ;;
      publisher)
        compare_and_print_appservice "publisher" "${repo_root}/apps/publisher/.env"
        ;;
      content-engine)
        compare_and_print_appservice "content-engine" "${repo_root}/apps/content-engine/.env"
        ;;
      web)
        compare_and_print_web "${repo_root}/apps/web/.env"
        ;;
      *)
        echo "Unknown app: ${app}. Valid values: api, publisher, content-engine, web"
        exit 1
        ;;
    esac
  done

  echo ""
  echo "===================================================================="
  echo "Comparison complete."
  echo "===================================================================="
}

main "$@"
