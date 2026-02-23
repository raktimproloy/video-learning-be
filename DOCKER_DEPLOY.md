# Backend Docker Deployment Guide

This guide explains how to build and deploy the EncLearn backend using Docker.

---

## Step 1: Test Docker Locally (Optional but Recommended)

### 1.1 Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed on your machine
- PostgreSQL running (locally or a cloud instance like Supabase/Neon)

### 1.2 Build the Image

Open a terminal in the **backend** folder and run:

```bash
cd backend
docker build -t enclearn-backend .
```

### 1.3 Run the Container Locally

```bash
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=encryption_learning \
  -e DB_USER=postgres \
  -e DB_PASSWORD=your_password \
  -e JWT_SECRET=your_jwt_secret \
  -e BASE_URL=http://localhost:3000 \
  -e R2_ACCOUNT_ID=your_r2_id \
  -e R2_ACCESS_KEY_ID=your_r2_key \
  -e R2_SECRET_ACCESS_KEY=your_r2_secret \
  -e R2_BUCKET_NAME=your_bucket \
  enclearn-backend
```

- **Windows/Mac:** Use `host.docker.internal` to reach PostgreSQL on your host.
- **Linux:** Use your machine's LAN IP or run PostgreSQL in another container.

Test the API at: http://localhost:3000

---

## Step 2: Deploy to Render

### 2.1 Create a Render Account
1. Go to [render.com](https://render.com) and sign up (free).

### 2.2 Connect Your Repository
1. Log in to Render Dashboard
2. Click **New** → **Web Service**
3. Connect your GitHub/GitLab repository
4. Select the repository that contains your EncLearn project

### 2.3 Configure the Web Service

| Setting | Value |
|---------|-------|
| **Name** | `enclearn-backend` (or any name) |
| **Region** | Choose closest to your users |
| **Root Directory** | `backend` |
| **Environment** | Docker |
| **Branch** | `main` (or your default branch) |

### 2.4 Add Environment Variables

In **Environment** section, add these variables (use your real values):

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Render sets this automatically; add `3000` as default if needed |
| `DB_HOST` | Yes | PostgreSQL host (e.g. Supabase/Neon host) |
| `DB_PORT` | Yes | `5432` |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `JWT_SECRET` | Yes | Strong random string for JWT |
| `BASE_URL` | Yes | Your backend URL (e.g. `https://enclearn-backend.onrender.com`) |
| `KEYS_ROOT_DIR` | No | Defaults to `./keys` |
| `R2_ACCOUNT_ID` | Yes* | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | Yes* | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Yes* | R2 secret key |
| `R2_BUCKET_NAME` | Yes* | R2 bucket name |
| `AGORA_APP_ID` | Yes* | Agora app ID (for live streaming) |
| `AGORA_APP_CERTIFICATE` | Yes* | Agora certificate |

*Required if you use those features.

### 2.5 Deploy
1. Click **Create Web Service**
2. Render will build the Docker image and deploy
3. First deploy may take 5–10 minutes
4. Your API will be at: `https://<your-service-name>.onrender.com`

### 2.6 Important Notes for Render Free Tier
- Service sleeps after **15 minutes** of no traffic (cold start ~1 min)
- **750 free hours/month** per account
- **Video encryption keys** are stored in R2 when configured (see `keys/<videoId>/enc.key`), so they persist across restarts

---

## Step 3: Run Database Migrations

Your backend expects a migrated PostgreSQL database.

### Option A: Before First Deploy
1. Use a hosted PostgreSQL (Supabase, Neon, Railway) with a new database
2. Run migrations locally against that database:
   ```bash
   DB_HOST=your-db-host DB_USER=... DB_PASSWORD=... DB_NAME=... node run_migrations.js
   ```
3. Optionally seed admin: `node scripts/seed-admin.js admin@example.com yourpassword`

### Option B: Add a Deploy Hook
Add a **Background Worker** or **Deploy Hook** on Render that runs migrations after deploy (advanced).

---

## Step 4: Update Your Frontend

Point your frontend to the deployed backend:

- Set `NEXT_PUBLIC_API_URL` or your API base URL to:
  `https://<your-render-service-name>.onrender.com`

---

## Quick Reference: Build & Run Commands

```bash
# Build
docker build -t enclearn-backend .

# Run (replace values)
docker run -p 3000:3000 --env-file .env enclearn-backend

# Or with individual -e flags (see Step 1.3)
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Container exits immediately | Check Render logs; likely missing env vars (DB_*, JWT_SECRET) |
| FFmpeg not found | Ensure Dockerfile `apt-get install ffmpeg` runs (it should) |
| Database connection failed | Verify DB_HOST is reachable from Render (use cloud DB, not localhost) |
| 502 Bad Gateway | Container may be starting; wait 1–2 min or check logs |
