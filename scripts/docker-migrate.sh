#!/usr/bin/env bash
# Run DB migrations inside a one-off API container
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run: cp .env.docker.example .env"
  exit 1
fi

echo "Running migrations..."
docker compose run --rm --no-deps api node run_migrations.js
echo "Migrations complete."
