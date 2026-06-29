/**
 * Optional Redis client for shared cache + Socket.io adapter.
 * Falls back gracefully when REDIS_URL is unset.
 */
let client = null;
let connectPromise = null;

async function getRedisClient() {
    if (!process.env.REDIS_URL) return null;
    if (client?.isOpen) return client;

    if (!connectPromise) {
        connectPromise = (async () => {
            const { createClient } = require('redis');
            client = createClient({ url: process.env.REDIS_URL });
            client.on('error', (err) => console.error('Redis error:', err.message));
            await client.connect();
            console.log('Redis connected');
            return client;
        })().catch((err) => {
            connectPromise = null;
            console.warn('Redis unavailable, using in-memory cache:', err.message);
            return null;
        });
    }
    return connectPromise;
}

async function shutdownRedis() {
    if (client?.isOpen) {
        await client.quit().catch(() => {});
    }
    client = null;
    connectPromise = null;
}

module.exports = { getRedisClient, shutdownRedis };
