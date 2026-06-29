# Shikkhabhumi scaling guide

Based on load test results (`tester_bot/reports/prod-run-*`) and production architecture.

## Load test baseline (6 vCPU / 12 GB VPS)

| Scenario | Safe capacity (before changes) |
|----------|-------------------------------|
| Browse | ~50 concurrent users |
| Auth API | ~30 sessions |
| Video watch | ~10–15 per video |
| Live heartbeat | ~30 viewers |
| Live chat | 10+ connections tested OK |

After applying this guide, re-run: `cd tester_bot && npm run test:all`

---

## P0 — Do first (implemented in code)

### 1. PostgreSQL connection pool

**File:** [db.js](../db.js)

```env
DB_POOL_MAX=30
DB_POOL_MIN=2
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECT_TIMEOUT_MS=10000
```

Supabase pooler: keep `DB_POOL_MAX` ≤ your plan limit (often 30–50 on pooler port 6543).

Run migration:

```bash
cd backend && npm run migrate
```

Includes `100_perf_indexes.sql` for heartbeat/progress paths.

### 2. Separate API and FFmpeg worker

**Never run video encoding on the same process as live users.**

| Process | Env | Command |
|---------|-----|---------|
| API + Socket.io | `RUN_WORKER=0` | `npm start` or PM2 `api` |
| FFmpeg worker | — | `npm run worker` or PM2 `worker` |

**PM2 (recommended on VPS):**

```bash
npm install -g pm2
cd backend
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## P1 — Implemented (enable via env)

### 3. Rate limiting

**File:** [src/middleware/rateLimit.js](../src/middleware/rateLimit.js)

```env
RATE_LIMIT_ENABLED=true          # set false to disable
RATE_LIMIT_AUTH_MAX=30           # per IP / 15 min
RATE_LIMIT_ANALYTICS_MAX=120     # per IP / minute
RATE_LIMIT_API_MAX=300           # general / minute
```

### 4. Redis (optional — multi-instance)

```env
REDIS_URL=redis://127.0.0.1:6379
```

When set:

- TTL cache shared across API instances ([ttlCache.js](../src/utils/ttlCache.js))
- Socket.io rooms shared ([socket.js](../src/socket.js))

Install Redis on VPS:

```bash
# Ubuntu
sudo apt install redis-server
sudo systemctl enable redis-server
```

---

## P2 — nginx + PM2 cluster

### 5. nginx tuning

**File:** [nginx.conf](../nginx.conf)

- `worker_processes auto`
- `worker_connections 4096`
- `/health`, `/v1/`, `/socket.io/` proxied
- Upstream `node_api` ready for multiple backends

Reload after deploy:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 6. PM2 API cluster (2–4 instances)

```env
PM2_API_INSTANCES=2
REDIS_URL=redis://127.0.0.1:6379   # required for Socket.io across instances
```

nginx: use `ip_hash` on upstream or sticky sessions for `/socket.io/`.

---

## P3 — Write batching (enabled by default)

Reduces DB writes under video/live load.

```env
ANALYTICS_BATCH_MS=30000      # page view heartbeats (0 = immediate)
PROGRESS_BATCH_MS=15000       # video progress (0 = immediate)
LIVE_HEARTBEAT_BATCH_MS=15000 # live watch heartbeat (0 = immediate)
```

Set any to `0` to disable batching for that path.

---

## P3 — CDN for HLS (Cloudflare + R2)

Video segments are on R2. To scale off VPS:

1. Cloudflare in front of R2 public/custom domain
2. Cache `.ts` segments (short TTL), `.m3u8` (very short or bypass)
3. Keep signed URLs / encryption keys on API

---

## Deploy checklist

1. [ ] Follow [VPS-DOCKER.md](./VPS-DOCKER.md) — `docker compose` on VPS
2. [ ] `npm run migrate` on production DB (or `npm run docker:migrate`)
2. [ ] Set `RUN_WORKER=0` on API service
3. [ ] Run worker as separate process (`npm run worker`)
4. [ ] Set `DB_POOL_MAX=30`
5. [ ] Enable rate limits (`RATE_LIMIT_ENABLED=true`)
6. [ ] (Optional) Redis + `REDIS_URL`
7. [ ] Update nginx config and reload
8. [ ] Re-run load test from `tester_bot`

---

## Expected gains

| Change | Expected improvement |
|--------|---------------------|
| DB pool 10 → 30 | 2–3× concurrent write users |
| RUN_WORKER=0 | Stable API during uploads |
| Progress/analytics batching | ~50–70% fewer DB writes per active viewer |
| Redis + PM2 cluster | Linear API scaling, shared live rooms |
| nginx 4096 connections | Higher connection ceiling |
