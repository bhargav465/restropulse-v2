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

MAX_RETRIES=5
RETRY_DELAY=10

case "$SERVICE" in
  api)
    echo "Smoke testing API at ${BASE_URL}/health ..."
    RESPONSE=$(curl --fail --silent --max-time 30 --retry "$MAX_RETRIES" --retry-delay "$RETRY_DELAY" --retry-all-errors "${BASE_URL}/health")
    if echo "$RESPONSE" | grep -q '"status"'; then
      echo "API health check passed."
    else
      echo "API health check failed. Response: $RESPONSE"
      exit 1
    fi
    ;;
  web)
    echo "Smoke testing Web at ${BASE_URL} ..."
    RESPONSE=$(curl --fail --silent --max-time 30 --retry "$MAX_RETRIES" --retry-delay "$RETRY_DELAY" --retry-all-errors "${BASE_URL}")
    if echo "$RESPONSE" | grep -q '<div id="root"'; then
      echo "Web smoke test passed."
    else
      echo "Web smoke test failed. Response does not contain root div."
      exit 1
    fi
    ;;
  *)
    echo "Unknown service: $SERVICE"
    echo "Usage: smoke-test.sh <api|web> <base-url>"
    exit 1
    ;;
esac
