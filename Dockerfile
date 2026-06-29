# Shikkhabhumi API — production image (API + worker use same image, different command)
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p keys && chmod 755 keys

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node scripts/docker-healthcheck.js

# Default: API (override in docker-compose: worker uses node src/worker/index.js)
CMD ["node", "index.js"]
