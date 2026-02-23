# EncLearn Backend - Docker Image
# Includes Node.js, FFmpeg (for video processing), and Sharp (image processing)

FROM node:20-slim

# Install FFmpeg (required for fluent-ffmpeg video processing)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Copy application code
COPY . .

# Create keys directory for video encryption (must be writable)
RUN mkdir -p keys && chmod 755 keys

# Use PORT from environment (Render/Railway set this)
ENV PORT=3000
EXPOSE 3000

# Start the server (runs Express + Socket.io + Worker in one process)
CMD ["node", "index.js"]
