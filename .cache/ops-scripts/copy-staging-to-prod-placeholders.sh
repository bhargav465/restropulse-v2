#!/usr/bin/env bash
# =============================================================================
# copy-staging-to-prod-placeholders.sh
#
# One-time remediation: 11 prod-* secrets in restropulse-prod-kv were found
# holding a shared placeholder value (same length, same suffix) instead of
# real values. This copies the corresponding staging-* secret's value into
# each one. Only touches the 11 names below -- nothing else in the vault.
#
# Usage:
#   bash copy-staging-to-prod-placeholders.sh --dry-run   # preview, no writes
#   bash copy-staging-to-prod-placeholders.sh --confirm   # actually write
#
# Requires: az CLI logged in (az login) with write access to the vault.
# =============================================================================

set -euo pipefail

VAULT="restropulse-prod-kv"

NAMES=(
  jwt-secret
  encryption-key
  firebase-service-account-key
  firebase-project-id
  instagram-app-id
  instagram-app-secret
  firebase-api-key
  firebase-auth-domain
  firebase-storage-bucket
  firebase-messaging-sender-id
  firebase-app-id
)

MODE="${1:-}"
if [[ "$MODE" != "--dry-run" && "$MODE" != "--confirm" ]]; then
  echo "Usage: $0 --dry-run | --confirm" >&2
  exit 1
fi

if [[ -t 1 ]] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  C_GREEN=$(tput setaf 2); C_YELLOW=$(tput setaf 3); C_RED=$(tput setaf 1); C_RESET=$(tput sgr0)
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

echo ""
echo "Vault: $VAULT"
echo "Mode : $MODE"
echo ""

if [[ "$MODE" == "--confirm" ]]; then
  echo "${C_YELLOW}This will overwrite 11 production secrets with staging's current values.${C_RESET}"
  echo "Existing prod Instagram tokens (if any) encrypted under the current"
  echo "placeholder ENCRYPTION_KEY will become undecryptable after this runs."
  echo ""
  read -r -p "Type 'yes' to proceed: " ans
  if [[ "$ans" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

FAILED=0
for name in "${NAMES[@]}"; do
  val=$(az keyvault secret show --vault-name "$VAULT" --name "staging-$name" --query value -o tsv 2>/dev/null || true)
  if [[ -z "$val" ]]; then
    echo "${C_YELLOW}[SKIP]${C_RESET} prod-$name: staging-$name is empty or missing"
    continue
  fi

  if [[ "$MODE" == "--dry-run" ]]; then
    echo "[DRY]  would set prod-$name from staging-$name (len=${#val})"
  else
    if az keyvault secret set --vault-name "$VAULT" --name "prod-$name" --value "$val" --output none 2>/tmp/akv_copy_err.log; then
      echo "${C_GREEN}[OK]${C_RESET}   prod-$name updated from staging-$name"
    else
      echo "${C_RED}[FAIL]${C_RESET} prod-$name -- $(cat /tmp/akv_copy_err.log)"
      FAILED=1
    fi
  fi
  unset val
done
rm -f /tmp/akv_copy_err.log

echo ""
if [[ "$MODE" == "--confirm" && "$FAILED" -eq 0 ]]; then
  echo "Done. Production App Service needs a restart to pick up the new values:"
  echo "    az webapp restart --resource-group restropulse-prod-rg --name restropulse-prod-api"
fi
