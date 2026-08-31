# R2 Cost Optimization Runbook

Zero application behavior change. All steps are **env + Cloudflare dashboard + operational scripts**.

**Related:** [SCALING.md](./SCALING.md) (CDN playback), [VPS-DOCKER.md](./VPS-DOCKER.md) (deploy).

---

## Quick reference

| Phase | Action | Where |
|-------|--------|-------|
| 0 | Preflight smoke test | `npm run r2:preflight` |
| 1 | CDN segment delivery | `.env` + Cloudflare Cache Rules |
| 2 | Lifecycle cleanup | Cloudflare R2 Lifecycle Rules |
| 3 | Orphan audit | `npm run r2:orphan-audit` |
| 4 | Weekly monitoring | Cloudflare dashboards (below) |

**Production env (Phase 1):**

```env
CDN_SEGMENT_DELIVERY=cdn
R2_CDN_PUBLIC_URL=https://media.shikkhabhumi.com
R2_PUBLIC_URL=https://media.shikkhabhumi.com
```

**Rollback (instant):** set `CDN_SEGMENT_DELIVERY=presign` or `off`, then restart API only:

```bash
docker compose restart api
# or: pm2 restart api
```

---

## Phase 0 — Preflight

```bash
cd backend
npm run r2:preflight
```

Checks:

- R2 credentials and bucket connectivity
- Oldest + newest active video `r2_key` paths
- `master.m3u8`, variant playlist, sample `.ts` on R2
- Same paths via `https://media.shikkhabhumi.com/...`

Baseline snapshot: [r2-baseline-snapshot.json](./r2-baseline-snapshot.json)

**Cloudflare dashboard (manual):** R2 → bucket `videos` → Metrics → save 7-day snapshot of storage GB, Class A/B ops.

---

## Phase 1 — Cloudflare Cache Rules

**Domain:** `media.shikkhabhumi.com` (must be proxied — orange cloud).

### Step-by-step (Cloudflare Dashboard)

1. Go to **Websites** → select `shikkhabhumi.com` (or zone that owns `media` subdomain).
2. **Rules** → **Cache Rules** → **Create rule**.

#### Rule 1: Cache HLS segments

| Field | Value |
|-------|-------|
| Rule name | `R2 cache HLS segments` |
| When | Custom filter expression: `(http.host eq "media.shikkhabhumi.com" and ends_with(http.request.uri.path, ".ts"))` |
| Then | Cache eligibility: **Eligible for cache** |
| Edge TTL | **Ignore cache-control and cache** → TTL **1 hour** |

#### Rule 2: Bypass HLS playlists

| Field | Value |
|-------|-------|
| Rule name | `R2 bypass HLS playlists` |
| When | `(http.host eq "media.shikkhabhumi.com" and ends_with(http.request.uri.path, ".m3u8"))` |
| Then | Cache eligibility: **Bypass cache** |

#### Rule 3 (optional): Cache book page images

| Field | Value |
|-------|-------|
| Rule name | `R2 cache book pages` |
| When | `(http.host eq "media.shikkhabhumi.com" and http.request.uri.path contains "/pages/" and ends_with(http.request.uri.path, ".webp"))` |
| Then | Edge TTL **24 hours** |

**Why bypass `.m3u8`:** Playlists are served through API auth + URL rewrite. Segments are AES-128 encrypted — safe to cache at edge.

### Enable CDN mode on API

1. Set `CDN_SEGMENT_DELIVERY=cdn` in production `.env` (already set in repo template).
2. Restart **API only** (worker unchanged):

```bash
docker compose restart api
```

3. Validate:

```bash
npm run r2:preflight
# Play 1 old + 1 new video in browser (seek, quality switch)
# Optional load test:
cd ../tester_bot && npm run test:video-watch
```

4. **Cache hit monitoring:** Cloudflare → Analytics → Cache → filter hostname `media.shikkhabhumi.com`. Target **>70%** hit rate on `.ts` after warm-up.

---

## Phase 2 — R2 Lifecycle Rules

**Cloudflare Dashboard** → **R2** → bucket **`videos`** → **Settings** → **Lifecycle rules** → **Add rule**.

### Rule A — Abort incomplete multipart uploads

| Setting | Value |
|---------|-------|
| Rule name | `abort-incomplete-multipart` |
| Action | Abort incomplete multipart uploads |
| Days after initiation | **7** |

### Rule B — Delete orphan staging

| Setting | Value |
|---------|-------|
| Rule name | `delete-orphan-staging` |
| Prefix | `teachers/` |
| Action | Delete objects |
| Condition | Objects with prefix ending in `/staging/` OR path contains `/staging/` |
| Days after last modification | **14** |

> If the UI only supports prefix: create rule on prefix `teachers/` with filter **object key contains** `/staging/`, delete after **14 days**.

Safe: successful encode deletes `staging/` immediately in [videoProcessor.js](../src/worker/videoProcessor.js).

### Rule C — Delete orphan processing prefixes

| Setting | Value |
|---------|-------|
| Rule name | `delete-orphan-processing` |
| Prefix | `teachers/` |
| Filter | object key **contains** `/.processing/` |
| Action | Delete objects |
| Days after last modification | **7** |

### Rule D — Infrequent Access for cold originals (Day 30+)

**Enable only after 30 days of Phase 1–2 monitoring.**

| Setting | Value |
|---------|-------|
| Rule name | `ia-original-source` |
| Filter | object key **contains** `/original/source` |
| Action | Transition to **Infrequent Access** |
| Days after last access | **30** |

**Do NOT apply IA to:** `360p/`, `720p/`, `1080p/`, `/pages/`, `master.m3u8`, thumbnails.

---

## Phase 3 — Orphan audit (quarterly)

```bash
cd backend
npm run r2:orphan-audit
npm run r2:reencode-audit
```

JSON output for automation:

```bash
node scripts/r2-orphan-audit.js --json > reports/r2-orphan-$(date +%F).json
```

| Finding | Action |
|---------|--------|
| Orphan `staging/` prefix | Review → `deletePrefix` via script or wait for lifecycle Rule B |
| Orphan `.processing/` | Review → delete or wait for lifecycle Rule C |
| Active `r2_only` with leftover `staging/` | Investigate failed cleanup; manual delete after confirm |
| Missing `master.m3u8` | Broken video — notify teacher to re-upload |

---

## Phase 4 — Monitoring & alerts

### Weekly review (5 min)

**R2 → Metrics:**

- Total storage (GB) — should flatten after lifecycle rules
- Class B operations/day — should drop after CDN mode
- Class A operations/day — spikes during upload/re-encode weeks are normal

**Analytics → Cache** (`media.shikkhabhumi.com`):

- Cache hit ratio on `.ts`
- Bandwidth saved

### Recommended Cloudflare notifications

**Notifications** → **Add** → **R2**:

- Storage exceeds threshold (e.g. alert at +20% month-over-month)
- Class B operations approach free tier limit (10M/month)

### Rollback matrix

| Symptom | Fix | Downtime |
|---------|-----|----------|
| Segments 403/404 | Verify custom domain on bucket `videos`; check DNS proxied | 0 |
| Playback broken after CDN | `CDN_SEGMENT_DELIVERY=presign` + restart API | ~30s |
| Stale/wrong segment content | Purge cache: `media.shikkhabhumi.com` path `*.ts` | 0 |
| Lifecycle deleted active file | Disable lifecycle rule; restore from backup if available | Rare |

### Scale playbook

| Growth | Action |
|--------|--------|
| More viewers | CDN cache handles load; increase `.ts` TTL to 2h if hit rate high |
| Storage growing | Enable Rule D (IA); run `npm run r2:orphan-audit` |
| Re-encode batch | Expect Class A spike; schedule off-peak |
| New region/bucket | Avoid — custom domain is bucket-scoped; stay single bucket |

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run r2:preflight` | Phase 0 smoke test (DB + R2 + CDN URLs) |
| `npm run r2:orphan-audit` | Phase 3 orphan prefix scan |
| `npm run r2:reencode-audit` | Category A/B/C re-encode eligibility |

---

## Expected savings

| Phase | Saving | Timeline |
|-------|--------|----------|
| CDN mode + cache rules | Class B −50–90% on active videos | After cache warm-up |
| Lifecycle A–C | Storage −5–15% (orphan volume dependent) | 7–14 days |
| Lifecycle D (IA) | Storage −10–30% on `original/` library | After 30-day transition |

Free tier: 10 GB storage + 1M Class A + 10M Class B/month.

---

## Live HLS sessions (`live/sessions/`)

Active R2 Live broadcasts write to `live/sessions/{liveSessionId}/`. On discard/end-without-save, the API deletes this prefix. On save, segments are encrypted and promoted to the standard VOD path.

**Orphan safety (Cloudflare R2 Lifecycle):** auto-delete objects under prefix `live/sessions/` older than **7 days**.
