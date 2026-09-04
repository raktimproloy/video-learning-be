#!/bin/sh
set -eu
KEY=$(cat /tmp/sk.txt)
echo "KEYLEN=${#KEY}"
echo "Publishing to rtmp://srs:1935/live/<key> for 8s..."
ffmpeg -hide_banner -loglevel warning -re \
  -f lavfi -i testsrc=size=640x360:rate=30 \
  -f lavfi -i sine=frequency=1000:sample_rate=44100 \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 60 \
  -c:a aac -ar 44100 -ac 2 \
  -t 8 -f flv "rtmp://srs:1935/live/${KEY}"
echo "ffmpeg_exit=$?"
