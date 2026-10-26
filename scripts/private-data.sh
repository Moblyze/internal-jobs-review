#!/usr/bin/env bash
# Pull/push people-data to the private R2 bucket (Moblyze Ops account).
# Usage: scripts/private-data.sh pull|push
# Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment (GH secrets).
# ALWAYS --remote: wrangler r2 object commands default to a local simulated bucket
# in some versions, which makes production look empty.
set -euo pipefail
BUCKET="${PRIVATE_BUCKET:-bd-feed-private}"
KEY="feed/decision_makers.json"
LOCAL="${DECISION_MAKERS_PATH:-.private/decision_makers.json}"
mkdir -p "$(dirname "$LOCAL")"
case "${1:-}" in
  pull)
    if npx --yes wrangler@4 r2 object get "$BUCKET/$KEY" --file "$LOCAL" --remote; then
      echo "[private-data] pulled $KEY ($(wc -c < "$LOCAL") bytes)"
    else
      echo "::error::could not pull $KEY from R2 (bucket missing or empty? run the one-time seed first)"; exit 1
    fi ;;
  push)
    [ -s "$LOCAL" ] || { echo "::error::$LOCAL missing or empty, refusing to push"; exit 1; }
    npx --yes wrangler@4 r2 object put "$BUCKET/$KEY" --file "$LOCAL" --content-type application/json --remote
    echo "[private-data] pushed $KEY" ;;
  *) echo "usage: $0 pull|push" >&2; exit 2 ;;
esac
