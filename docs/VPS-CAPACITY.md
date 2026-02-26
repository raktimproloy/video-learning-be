# VPS capacity: encryption time and concurrency

This doc estimates **time to encrypt + upload a 30‑minute video** and **how many jobs at a time** are safe on a **6 vCPU / 12 GB RAM** VPS, while keeping the backend responsive.

---

## What the pipeline does

1. **Download** source from R2 (if staging is in R2) to temp dir.
2. **Encode + encrypt** with FFmpeg:
   - H.264 (libx264) or H.265 (libx265), preset `slow`, single resolution
   - HLS segments (6 s) with **AES-128** via `-hls_key_info_file`
3. **Upload** all `.ts` segments and `.m3u8` playlists to R2 (sequential files).

The heavy part is **FFmpeg encoding** (CPU-bound). Upload is usually short compared to encode time.

---

## 6 vCPU, 12 GB RAM – rough numbers

### Time for one 30‑minute video

| Step        | Estimate |
|------------|----------|
| Download   | ~0.5–2 min (depends on R2 and source size) |
| Encode + encrypt | **~10–25 min** (1080p, preset slow). Can be ~5–15 min for 720p. |
| Upload     | ~1–3 min (depends on output size and upload bandwidth) |
| **Total**  | **~12–30 min** per 30‑minute video (encode dominates) |

Notes:

- FFmpeg uses multiple threads (libx264/libx265 scale with cores). With 6 vCPUs, one job can use most of the CPU.
- Exact time depends on resolution, bitrate, and codec (H.264 vs H.265). H.265 is slower to encode but often smaller output.

So on this VPS, **one 30‑minute video** typically finishes in **about 15–25 minutes** end‑to‑end.

---

## How many encryptions at a time?

- The **API and worker run in the same Node process** (`index.js` starts the worker loop).
- The worker is **single-threaded**: it processes **one** `video_processing_tasks` row at a time (see `src/worker/index.js`).
- So by default you run **1 encryption job at a time**. The backend stays responsive because only one FFmpeg run is active.

**Recommendation for 6 vCPU / 12 GB:**

- **1 job at a time (default):** Safe and recommended. One 30‑min video ≈ 15–25 min; backend keeps enough CPU and RAM free.
- **2 jobs in parallel:** Possible only if you run a **second worker process** (separate Node process, same DB). Then:
  - Reserve ~1 vCPU and ~1–2 GB for API + DB.
  - Two FFmpeg jobs share ~5 vCPUs and ~10 GB; each job will be slower and use ~2–4 GB (source + output in temp). Possible, but monitor RAM and latency.

So: **“At a time” = 1** with the current single worker; **up to 2** if you run two worker processes and monitor resources.

---

## Keeping the backend healthy

- **CPU:** One FFmpeg job can use all 6 vCPUs. The API is light; the main risk is CPU starvation if you run multiple encoding jobs (e.g. two workers).
- **RAM:** Per 30‑min job, temp usage (source + HLS output) can be ~1–3 GB. With 12 GB total, leave ~2–3 GB for OS, Node, Postgres, and API. So 1–2 concurrent jobs is the safe range.
- **Disk:** Temp dir is `os.tmpdir()` (e.g. `/tmp`). Ensure enough free space for at least one full video (source + segments); for 30 min, 2–5 GB free is a reasonable minimum.

---

## Summary

| Question | Answer |
|----------|--------|
| **Time to encrypt + upload one 30‑min video?** | **~15–25 minutes** (often ~20 min) on 6 vCPU / 12 GB. |
| **How many at a time (backend must keep running)?** | **1** with default setup; **up to 2** if you run a second worker process and watch RAM/CPU. |
| **Bottleneck** | CPU (FFmpeg encoding). Then disk I/O, then network upload. |

No code changes are required for “1 at a time” and a stable backend; the current worker already processes one task at a time.
