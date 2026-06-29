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

echo "==> Building images..."
docker compose build

echo "==> Running migrations..."
docker compose run --rm --no-deps api node run_migrations.js

echo "==> Starting services..."
docker compose up -d --remove-orphans

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

docker compose ps
echo ""
echo "Deploy done. Point api.shikkhabhumi.com DNS to this VPS."
echo "Logs: docker compose logs -f api"
