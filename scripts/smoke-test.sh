#!/bin/bash
set -euo pipefail

# Usage: ./scripts/smoke-test.sh <service> <base-url>
# Smoke tests for post-deploy verification.
#
# Services:
#   api  -- curl /health, verify {"status":"ok"}
#   web  -- curl /, verify HTTP 200 with <div id="root">

SERVICE="${1:?Usage: smoke-test.sh <api|web> <base-url>}"
BASE_URL="${2:?Usage: smoke-test.sh <api|web> <base-url>}"
EXPECTED_GIT_SHA="${EXPECTED_GIT_SHA:-}"

MAX_RETRIES=5
RETRY_DELAY=10
SHA_CHECK_RETRIES=36
SHA_CHECK_DELAY=10
BOOT_RETRIES=24
BOOT_RETRY_DELAY=10

request() {
  local url="$1"
  curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
    --retry "$MAX_RETRIES" --retry-delay "$RETRY_DELAY" --retry-all-errors "$url"
}

case "$SERVICE" in
  api)
    echo "Smoke testing API at ${BASE_URL}/health ..."
    RESPONSE=""
    for attempt in $(seq 1 "$BOOT_RETRIES"); do
      if RESPONSE=$(request "${BASE_URL}/health" 2>/dev/null); then
        break
      fi
      echo "API health not ready yet (attempt ${attempt}/${BOOT_RETRIES})..."
      if [ "$attempt" -eq "$BOOT_RETRIES" ]; then
        echo "API health check failed after ${BOOT_RETRIES} attempts."
        exit 1
      fi
      sleep "$BOOT_RETRY_DELAY"
    done
    if ! echo "$RESPONSE" | grep -q '"status"'; then
      echo "API health check failed. Response: $RESPONSE"
      exit 1
    fi
    if [ -n "$EXPECTED_GIT_SHA" ]; then
      for attempt in $(seq 1 "$SHA_CHECK_RETRIES"); do
        if ! RESPONSE=$(request "${BASE_URL}/health" 2>/dev/null); then
          if [ "$attempt" -eq "$SHA_CHECK_RETRIES" ]; then
            echo "API deploy SHA check failed: health endpoint never stabilized."
            exit 1
          fi
          sleep "$SHA_CHECK_DELAY"
          continue
        fi
        DEPLOYED_SHA=$(echo "$RESPONSE" | jq -r '.deployment.gitSha // empty')
        if [ "$DEPLOYED_SHA" = "$EXPECTED_GIT_SHA" ]; then
          break
        fi
        if [ "$attempt" -eq "$SHA_CHECK_RETRIES" ]; then
          echo "API deploy SHA mismatch. expected=$EXPECTED_GIT_SHA actual=$DEPLOYED_SHA"
          exit 1
        fi
        sleep "$SHA_CHECK_DELAY"
      done
    fi
    echo "API health check passed."
    ;;
  web)
    echo "Smoke testing Web at ${BASE_URL} ..."
    RESPONSE=""
    for attempt in $(seq 1 "$BOOT_RETRIES"); do
      if RESPONSE=$(request "${BASE_URL}" 2>/dev/null); then
        break
      fi
      echo "Web endpoint not ready yet (attempt ${attempt}/${BOOT_RETRIES})..."
      if [ "$attempt" -eq "$BOOT_RETRIES" ]; then
        echo "Web smoke check failed after ${BOOT_RETRIES} attempts."
        exit 1
      fi
      sleep "$BOOT_RETRY_DELAY"
    done
    if ! echo "$RESPONSE" | grep -q '<div id="root"'; then
      echo "Web smoke test failed. Response does not contain root div."
      exit 1
    fi
    if [ -n "$EXPECTED_GIT_SHA" ]; then
      for attempt in $(seq 1 "$SHA_CHECK_RETRIES"); do
        if ! CONFIG_RESPONSE=$(request "${BASE_URL}/config.json" 2>/dev/null); then
          if [ "$attempt" -eq "$SHA_CHECK_RETRIES" ]; then
            echo "Web deploy SHA check failed: config endpoint never stabilized."
            exit 1
          fi
          sleep "$SHA_CHECK_DELAY"
          continue
        fi
        DEPLOYED_SHA=$(echo "$CONFIG_RESPONSE" | jq -r '.deployment.gitSha // empty')
        if [ "$DEPLOYED_SHA" = "$EXPECTED_GIT_SHA" ]; then
          break
        fi
        if [ "$attempt" -eq "$SHA_CHECK_RETRIES" ]; then
          echo "Web deploy SHA mismatch. expected=$EXPECTED_GIT_SHA actual=$DEPLOYED_SHA"
          exit 1
        fi
        sleep "$SHA_CHECK_DELAY"
      done
    fi
    echo "Web smoke test passed."
    ;;
  *)
    echo "Unknown service: $SERVICE"
    echo "Usage: smoke-test.sh <api|web> <base-url>"
    exit 1
    ;;
esac
