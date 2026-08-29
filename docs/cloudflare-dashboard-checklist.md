# Cloudflare Dashboard Checklist — R2 Cost Optimization

Print this and check off in Cloudflare dashboard. No code deploy required for cache/lifecycle rules.

**After env change on VPS:** `CDN_SEGMENT_DELIVERY=cdn` → `docker compose restart api`

---

## Phase 1 — Cache Rules (zone: shikkhabhumi.com)

- [ ] Rule **R2 cache HLS segments**
  - Host: `media.shikkhabhumi.com`
  - Path ends with: `.ts`
  - Action: Cache, Edge TTL **1 hour**

- [ ] Rule **R2 bypass HLS playlists**
  - Host: `media.shikkhabhumi.com`
  - Path ends with: `.m3u8`
  - Action: **Bypass cache**

- [ ] Rule **R2 cache book pages** (optional)
  - Host: `media.shikkhabhumi.com`
  - Path contains: `/pages/` AND ends with: `.webp`
  - Action: Cache, Edge TTL **24 hours**

- [ ] Verify DNS: `media.shikkhabhumi.com` is **proxied** (orange cloud)

---

## Phase 2 — R2 Lifecycle Rules (bucket: `videos`)

- [ ] **abort-incomplete-multipart** — abort after **7 days**

- [ ] **delete-orphan-staging** — delete objects with `/staging/` in key after **14 days**

- [ ] **delete-orphan-processing** — delete objects with `/.processing/` in key after **7 days**

---

## Phase 2 Day 30 — Infrequent Access (optional)

- [ ] Review R2 storage metrics for 30 days after Phase 1
- [ ] **ia-original-source** — transition keys containing `/original/source` to IA after **30 days** no access

---

## Phase 4 — Notifications

- [ ] R2 storage alert (e.g. +20% MoM threshold)
- [ ] Class B operations alert (approaching 10M/month free tier)

---

## Phase 4 — Weekly monitoring (5 min)

- [ ] R2 → Metrics: storage GB, Class A/B ops/day
- [ ] Analytics → Cache: hit rate on `media.shikkhabhumi.com` (target >70% on `.ts`)

---

## Rollback (if playback issues)

- [ ] Set `CDN_SEGMENT_DELIVERY=presign` in `.env`
- [ ] `docker compose restart api`
- [ ] Optional: Purge Cloudflare cache for `media.shikkhabhumi.com/*.ts`

---

## R2 CORS (required when CDN_SEGMENT_DELIVERY=cdn)

Browser loads `.ts` from `media.shikkhabhumi.com` via XHR — bucket CORS must allow your frontend origins.

- [ ] R2 bucket `videos` → Settings → CORS policy includes:
  - Allowed origins: `https://shikkhabhumi.com`, `https://www.shikkhabhumi.com`, `https://*.vercel.app` (or explicit Vercel URL)
  - Allowed methods: `GET`, `HEAD`
  - Allowed headers: `*`
  - Expose headers: `Content-Length`, `Content-Type`, `ETag`
  - Max age: `86400`

Without this, playback fails intermittently or with CORS / fragment errors after CDN enable.
