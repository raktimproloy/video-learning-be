#!/usr/bin/env bash
# Derive R2 live / MediaMTX env from BASE_URL so no separate MediaMTX setup is needed.
# Called automatically by vps-deploy.sh and docker:deploy.
set -euo pipefail

ENV_FILE="${1:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "derive-live-env: $ENV_FILE not found, skipping"
  exit 0
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE" 2>/dev/null || true
set +a

BASE="${BASE_URL:-http://localhost:8080}"
# Strip protocol and path → public host for WebRTC ICE
HOST="${BASE#*://}"
HOST="${HOST%%/*}"
HOST="${HOST%%:*}"

# Optional: include VPS public IP in ICE candidates (helps when DNS/proxy quirks)
PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    fi
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

# WHIP URL = same origin as API (nginx proxies /{path}/whip → MediaMTX)
upsert "MEDIAMTX_WHIP_PUBLIC_URL" "$BASE"
if [[ "$HOST" == "localhost" || "$HOST" == "127.0.0.1" ]]; then
  upsert "MEDIAMTX_WEBRTC_HOST" "localhost,127.0.0.1"
else
  ICE_HOSTS="${HOST},localhost,127.0.0.1"
  if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$HOST" ]]; then
    ICE_HOSTS="${HOST},${PUBLIC_IP},localhost,127.0.0.1"
  fi
  upsert "MEDIAMTX_WEBRTC_HOST" "$ICE_HOSTS"
fi
upsert "MEDIAMTX_INTERNAL_URL" "http://mediamtx:8888"
upsert "MEDIAMTX_HLS_DIR" "/var/mediamtx/hls"

echo "derive-live-env: MEDIAMTX_WHIP_PUBLIC_URL=$BASE"
echo "derive-live-env: MEDIAMTX_WEBRTC_HOST=$HOST"
