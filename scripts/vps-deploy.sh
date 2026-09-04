#!/usr/bin/env bash
# VPS deploy: build → migrate → up
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found."
  echo "  cp .env.docker.example .env"
  echo "  nano .env   # fill DB, JWT, R2, etc."
  exit 1
fi

echo "==> Deriving R2 live / MediaMTX env from BASE_URL..."
chmod +x scripts/derive-live-env.sh 2>/dev/null || true
bash scripts/derive-live-env.sh .env

echo "==> Building images..."
docker compose build

echo "==> Running migrations..."
docker compose run --rm --no-deps api node run_migrations.js

echo "==> Starting services..."
docker compose up -d --remove-orphans
# Recreate SRS so srs.conf (RTMP + HTTP-FLV) always applies.
docker compose up -d --force-recreate srs

echo "==> Waiting for health..."
sleep 5

set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a
HTTP_PORT="${HTTP_PORT:-80}"
if curl -sf "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null; then
  echo "OK: http://127.0.0.1:${HTTP_PORT}/health"
  curl -s "http://127.0.0.1:${HTTP_PORT}/health?detail=1" | head -c 200
  echo
else
  echo "WARN: health check failed — run: docker compose logs api"
fi

if docker compose ps srs 2>/dev/null | grep -q "healthy\|Up"; then
  echo "OK: SRS (OBS RTMP ingest + FLV preview) is running"
else
  echo "WARN: SRS not up — run: docker compose logs srs"
fi

docker compose ps
echo ""
echo "Deploy done. Point api.shikkhabhumi.com DNS to this VPS."
echo "OBS Server: rtmp://<VPS_IP>:1935/live  (open TCP 1935 + 8081)"
echo "Logs: docker compose logs -f api"
