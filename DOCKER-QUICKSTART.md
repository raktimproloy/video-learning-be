# Docker quick reference (VPS)

Full guide: [docs/VPS-DOCKER.md](docs/VPS-DOCKER.md)

```bash
cd backend
cp .env.docker.example .env
nano .env

chmod +x scripts/*.sh
./scripts/vps-deploy.sh
```

Stack: **nginx** (80) → **api** (Node+Socket) + **worker** (FFmpeg) + **redis**

Frontend:
```
NEXT_PUBLIC_API_URL=https://api.shikkhabhumi.com/v1
NEXT_PUBLIC_SOCKET_URL=https://api.shikkhabhumi.com
```
