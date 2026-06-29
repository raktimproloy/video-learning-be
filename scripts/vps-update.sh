#!/usr/bin/env bash
# Pull latest code, rebuild, migrate, restart (run on VPS from backend folder)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Git pull (optional)..."
git pull --ff-only 2>/dev/null || echo "Skip git pull (not a repo or no remote)"

bash scripts/vps-deploy.sh
