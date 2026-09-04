#!/usr/bin/env bash
# Derive R2 live / SRS env from BASE_URL (OBS RTMP + HTTP-FLV teacher preview).
# Called automatically by vps-deploy.sh and docker:deploy.
set -euo pipefail

ENV_FILE="${1:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "derive-live-env: $ENV_FILE not found, skipping"
  exit 0
fi

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "$ENV_FILE" 2>/dev/null || true
set +a

BASE="${BASE_URL:-http://localhost:8080}"
# Strip protocol and path → public host
HOST="${BASE#*://}"
HOST="${HOST%%/*}"
HOST="${HOST%%:*}"

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

# Prefer public IP for RTMP (Cloudflare/proxy hostnames often block non-HTTP).
RTMP_HOST="$HOST"
if [[ -n "$PUBLIC_IP" ]]; then
  RTMP_HOST="$PUBLIC_IP"
fi
if [[ "$RTMP_HOST" == "localhost" || "$RTMP_HOST" == "127.0.0.1" ]]; then
  RTMP_HOST="127.0.0.1"
fi

upsert "MEDIAMTX_WHIP_PUBLIC_URL" "$BASE"
upsert "MEDIAMTX_INTERNAL_URL" "http://srs:8080"
upsert "MEDIAMTX_HLS_DIR" "/var/mediamtx/hls"
upsert "LIVE_RTMP_URL" "rtmp://${RTMP_HOST}:1935/live"
upsert "LIVE_SRS_HTTP_URL" "http://${RTMP_HOST}:8081"

if [[ "$HOST" == "localhost" || "$HOST" == "127.0.0.1" ]]; then
  upsert "MEDIAMTX_WEBRTC_HOST" "localhost,127.0.0.1"
else
  ICE_HOSTS="${HOST},localhost,127.0.0.1"
  if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$HOST" ]]; then
    ICE_HOSTS="${HOST},${PUBLIC_IP},localhost,127.0.0.1"
  fi
  upsert "MEDIAMTX_WEBRTC_HOST" "$ICE_HOSTS"
fi

echo "derive-live-env: LIVE_RTMP_URL=rtmp://${RTMP_HOST}:1935/live"
echo "derive-live-env: LIVE_SRS_HTTP_URL=http://${RTMP_HOST}:8081"
echo "derive-live-env: MEDIAMTX_WHIP_PUBLIC_URL=$BASE"
