/**
 * TTL cache with optional Redis backing (REDIS_URL).
 * Same API as before — single-instance uses memory; multi-instance uses Redis when configured.
 */
const { getRedisClient } = require('./redisClient');

class TtlCache {
    constructor() {
        /** @type {Map<string, { value: any, expiresAt: number }>} */
        this.store = new Map();
        /** @type {Map<string, Promise<any>>} */
        this.inflight = new Map();
        this._redisReady = null;
    }

    async _redis() {
        if (this._redisReady === null) {
            this._redisReady = getRedisClient();
        }
        return this._redisReady;
    }

    _memGet(key) {
        const hit = this.store.get(key);
        if (!hit) return undefined;
        if (hit.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return hit.value;
    }

    /**
     * @param {string} key
     * @returns {any | undefined}
     */
    get(key) {
        return this._memGet(key);
    }

    /**
     * @param {string} key
     * @param {any} value
     * @param {number} ttlMs
     */
    set(key, value, ttlMs) {
        const ttl = Math.max(0, Number(ttlMs) || 0);
        this.store.set(key, { value, expiresAt: Date.now() + ttl });
        this._redis().then((redis) => {
            if (!redis) return;
            const sec = Math.max(1, Math.ceil(ttl / 1000));
            redis.set(`cache:${key}`, JSON.stringify(value), { EX: sec }).catch(() => {});
        });
    }

    /**
     * @param {string} key
     */
    delete(key) {
        this.store.delete(key);
        this.inflight.delete(key);
        this._redis().then((redis) => {
            if (redis) redis.del(`cache:${key}`).catch(() => {});
        });
    }

    /**
     * @param {string} key
     * @param {number} ttlMs
     * @param {() => Promise<any>} loader
     */
    async getOrSet(key, ttlMs, loader) {
        const cached = this._memGet(key);
        if (cached !== undefined) return cached;

        const redis = await this._redis();
        if (redis) {
            try {
                const raw = await redis.get(`cache:${key}`);
                if (raw) {
                    const value = JSON.parse(raw);
                    this.set(key, value, ttlMs);
                    return value;
                }
            } catch {
                /* fall through to loader */
            }
        }

        const existing = this.inflight.get(key);
        if (existing) return existing;

        const p = (async () => {
            try {
                const value = await loader();
                this.set(key, value, ttlMs);
                return value;
            } finally {
                this.inflight.delete(key);
            }
        })();
        this.inflight.set(key, p);
        return p;
    }
}

module.exports = new TtlCache();
