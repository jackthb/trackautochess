#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
JOB_FILE="${1:-${REPO_ROOT}/ops/cronicle/cronicle-job.dac-poll-drodo-active.json}"

if [ ! -f "$JOB_FILE" ]; then
  echo "Cronicle job file missing: $JOB_FILE" >&2
  exit 1
fi

CRONICLE_BASE_URL="${CRONICLE_BASE_URL:-}"
CRONICLE_API_KEY="${CRONICLE_API_KEY:-}"
CRONICLE_EVENT_ID="${CRONICLE_EVENT_ID:-}"

if [ -z "$CRONICLE_BASE_URL" ] || [ -z "$CRONICLE_API_KEY" ]; then
  echo "ERROR: CRONICLE_BASE_URL or CRONICLE_API_KEY not set." >&2
  echo "Set secrets CRONICLE_BASE_URL and CRONICLE_API_KEY for dac-tools workflow." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this sync script" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for this sync script" >&2
  exit 1
fi

BASE=$(echo "$CRONICLE_BASE_URL" | sed 's#/$##')

if [ -n "$CRONICLE_EVENT_ID" ]; then
  ENDPOINT="/api/app/update_event/v1"
else
  ENDPOINT="/api/app/create_event/v1"
  echo "CRONICLE_EVENT_ID not set; this run will create a new event if it does not already exist."
fi

TITLE=$(jq -r '.title // .name // empty' "$JOB_FILE")
if [ -z "$TITLE" ]; then
  echo "Cronicle job file must include title" >&2
  exit 1
fi

EVENT_PAYLOAD=$(jq -c --arg key "$CRONICLE_API_KEY" --arg id "$CRONICLE_EVENT_ID" \
  '. + {api_key: $key} | if $id != "" then . + {id: $id} else . end' \
  "$JOB_FILE")

echo "Cronicle sync start"
echo "  endpoint: ${BASE}${ENDPOINT}"
echo "  title: ${TITLE}"
if [ -n "$CRONICLE_EVENT_ID" ]; then
  echo "  event id: ${CRONICLE_EVENT_ID}"
fi

RESPONSE=$(curl -sS -X POST "${BASE}${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: ${CRONICLE_API_KEY}" \
  -d "$EVENT_PAYLOAD")

if ! echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  echo "Cronicle API response not valid JSON: $RESPONSE" >&2
  exit 1
fi

CODE=$(echo "$RESPONSE" | jq -r '.code // "1"')
if [ "$CODE" != "0" ]; then
  echo "Cronicle API error (${ENDPOINT}): $RESPONSE" >&2
  echo "Payload sent: $EVENT_PAYLOAD" >&2
  exit 1
fi

echo "Cronicle event sync response: $RESPONSE"
CREATED_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
if [ -n "$CREATED_ID" ] && [ -z "$CRONICLE_EVENT_ID" ]; then
  echo "Created Cronicle event id: ${CREATED_ID}"
  echo "Set the matching DAC_TOOLS_* event ID secret to this value for deterministic updates on future pushes."
fi
echo "Cronicle sync complete"
