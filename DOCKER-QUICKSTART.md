# Docker quick reference (VPS)

Full guide: [docs/VPS-DOCKER.md](docs/VPS-DOCKER.md)

```bash
cd backend
cp .env.docker.example .env
nano .env

chmod +x scripts/*.sh
./scripts/vps-deploy.sh
```

Stack: **nginx** (host port **8080** by default) → **api** + **worker** + **mediamtx** + **redis**

R2 Live (WHIP): MediaMTX starts automatically — set `BASE_URL` only; no separate MediaMTX install.

If port 80 is free and you want Docker on 80: set `HTTP_PORT=80` in `.env`.

Frontend:
```
NEXT_PUBLIC_API_URL=https://api.shikkhabhumi.com/v1
NEXT_PUBLIC_SOCKET_URL=https://api.shikkhabhumi.com
```
