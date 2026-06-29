const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const liveChatService = require('./services/liveChatService');
const lessonService = require('./services/lessonService');
const courseService = require('./services/courseService');
const liveWatchService = require('./services/liveWatchService');
const liveSessionService = require('./services/liveSessionService');
const { getRedisClient } = require('./utils/redisClient');

let io;
const roomNotes = {}; // legacy in-memory notes (LiveNote)

async function attachRedisAdapter(socketServer) {
    if (!process.env.REDIS_URL) return;
    try {
        const { createAdapter } = require('@socket.io/redis-adapter');
        const pub = await getRedisClient();
        if (!pub) return;
        const sub = pub.duplicate();
        await sub.connect();
        socketServer.adapter(createAdapter(pub, sub));
        console.log('Socket.io Redis adapter enabled');
    } catch (err) {
        console.warn('Socket.io Redis adapter skipped:', err.message);
    }
}

const initSocket = async (server) => {
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  await attachRedisAdapter(io);

  io.use((socket, next) => {