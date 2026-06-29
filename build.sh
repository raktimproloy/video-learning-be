#!/bin/sh
set -e
docker compose build
echo "Built — run: docker compose up -d"
