# VPS Docker deployment — Shikkhabhumi backend

Production stack on your VPS:

```
Internet → nginx (port 80) → api (Node + Socket.io, RUN_WORKER=0)
                          → redis (cache + Socket.io adapter)
         worker (FFmpeg video processing, separate container)
         PostgreSQL (Supabase — external, not in Docker)
```

---

## 1. VPS requirements

| Item | Minimum |
|------|---------|
| OS | Ubuntu 22.04 / 24.04 LTS |
| RAM | 4 GB (8–12 GB recommended) |
| CPU | 2 vCPU (6 vCPU for heavy video encoding) |
| Disk | 40 GB+ |
| Software | Docker Engine + Docker Compose v2 |

### Install Docker (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version
```

---

## 2. First-time setup on VPS

### 2.1 Clone / upload backend

```bash
git clone <your-repo-url> /opt/shikkhabhumi
cd /opt/shikkhabhumi/backend
```

Or upload the `backend` folder via SFTP to `/opt/shikkhabhumi/backend`.

### 2.2 Create environment file

```bash
cp .env.docker.example .env
nano .env
```

Fill at minimum:

- `DB_*` — Supabase pooler (port **6543** for transaction pooler)
- `JWT_SECRET`
- `BASE_URL=https://api.shikkhabhumi.com`
- `FRONTEND_URL=https://shikkhabhumi.com`
- `R2_*` — video storage
- `AGORA_*` — live classes (if used)

### 2.3 Deploy

```bash
chmod +x scripts/*.sh
./scripts/vps-deploy.sh
```

Or:

```bash
npm run docker:deploy
```

This will:

1. `docker compose build`
2. Run migrations (`node run_migrations.js`)
3. Start `api`, `worker`, `redis`, `nginx`

### 2.4 Verify

```bash
curl http://127.0.0.1/health
curl "http://127.0.0.1/health?detail=1"
docker compose ps
docker compose logs -f api
```

---

## 3. DNS & frontend

1. Point **api.shikkhabhumi.com** A record → VPS IP
2. Vercel frontend env:
   ```env
   NEXT_PUBLIC_API_URL=https://api.shikkhabhumi.com/v1
   NEXT_PUBLIC_SOCKET_URL=https://api.shikkhabhumi.com
   ```

---

## 4. HTTPS (Let's Encrypt)

### Option A — Certbot on host (recommended)

Install nginx on host only for SSL termination, proxy to Docker port 80:

```bash
sudo apt install certbot python3-certbot-nginx
```

Host nginx config (`/etc/nginx/sites-available/api.shikkhabhumi.com`):

```nginx
server {
    listen 443 ssl http2;
    server_name api.shikkhabhumi.com;

    ssl_certificate     /etc/letsencrypt/live/api.shikkhabhumi.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.shikkhabhumi.com/privkey.pem;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }
}

server {
    listen 80;
    server_name api.shikkhabhumi.com;
    return 301 https://$host$request_uri;
}
```

In `.env` set `HTTP_PORT=8080` so Docker nginx listens on 8080, not 80.

```bash
sudo certbot --nginx -d api.shikkhabhumi.com
sudo nginx -t && sudo systemctl reload nginx
```

### Option B — Docker nginx on port 80 only (HTTP)

Use for testing. Production should use HTTPS (Option A or Cloudflare proxy).

---

## 5. Day-to-day commands

| Task | Command |
|------|---------|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Logs (API) | `docker compose logs -f api` |
| Logs (worker) | `docker compose logs -f worker` |
| Rebuild after code change | `./scripts/vps-update.sh` |
| Migrations only | `./scripts/docker-migrate.sh` |
| Shell into API | `docker compose exec api sh` |
| Restart API | `docker compose restart api` |

---

## 6. Architecture details

| Container | Role | Notes |
|-----------|------|-------|
| **api** | Express + Socket.io | `RUN_WORKER=0` — no FFmpeg here |
| **worker** | FFmpeg video encoding | Same image, `node src/worker/index.js` |
| **redis** | Cache + Socket.io | Auto via `REDIS_URL=redis://redis:6379` |
| **nginx** | Reverse proxy | `/v1/`, `/health`, `/socket.io/` |

Volumes:

- `app_keys` — video encryption keys (persist across redeploys)
- `redis_data` — Redis persistence

---

## 7. Scaling

See [SCALING.md](./SCALING.md).

Quick wins already enabled in Docker:

- Separate API / worker containers
- Redis for shared cache
- DB pool `DB_POOL_MAX=30`
- Write batching for heartbeats/progress

To run **2 API containers** (needs Redis):

```yaml
# docker-compose.yml — duplicate api service or use:
docker compose up -d --scale api=2
```

Update `docker/nginx.conf` upstream to list multiple `api` instances (Docker DNS round-robin).

---

## 8. Troubleshooting

| Problem | Fix |
|---------|-----|
| `api` unhealthy | `docker compose logs api` — check DB_* env |
| DB connection refused | Use Supabase **pooler** host + port 6543, `DB_SSL=true` |
| Worker not processing | `docker compose logs worker` — check R2 credentials |
| 502 from nginx | Wait for api healthcheck; `docker compose ps` |
| Socket.io fails | Ensure `NEXT_PUBLIC_SOCKET_URL` has no `/v1` suffix |
| Migrations fail | Run manually: `docker compose run --rm api node run_migrations.js` |

---

## 9. Local test (before VPS)

```bash
cd backend
cp .env.docker.example .env
# Edit .env with your Supabase credentials

docker compose build
docker compose run --rm api node run_migrations.js
docker compose up -d

curl http://localhost/health
```

---

## File reference

| File | Purpose |
|------|---------|
| [docker-compose.yml](../docker-compose.yml) | Full stack definition |
| [Dockerfile](../Dockerfile) | API/worker image |
| [docker/nginx.conf](../docker/nginx.conf) | In-container nginx |
| [.env.docker.example](../.env.docker.example) | Env template |
| [scripts/vps-deploy.sh](../scripts/vps-deploy.sh) | First deploy |
| [scripts/vps-update.sh](../scripts/vps-update.sh) | Redeploy after git pull |
