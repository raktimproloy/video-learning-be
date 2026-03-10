/**
 * Tiny in-memory TTL cache with in-flight de-duplication.
 *
 * Notes:
 * - Great for single-instance deployments.
 * - If you run multiple Node instances, prefer Redis so caches are shared.
 */

class TtlCache {
    constructor() {
        /** @type {Map<string, { value: any, expiresAt: number }>} */
        this.store = new Map();
        /** @type {Map<string, Promise<any>>} */
        this.inflight = new Map();
    }

    /**
     * @param {string} key
     * @returns {any | undefined}
     */
    get(key) {
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
     * @param {any} value
     * @param {number} ttlMs
     */
    set(key, value, ttlMs) {
        const ttl = Math.max(0, Number(ttlMs) || 0);
        this.store.set(key, { value, expiresAt: Date.now() + ttl });
    }

    /**
     * @param {string} key
     */
    delete(key) {
        this.store.delete(key);
        this.inflight.delete(key);
    }

    /**
     * @param {string} key
     * @param {number} ttlMs
     * @param {() => Promise<any>} loader
     */
    async getOrSet(key, ttlMs, loader) {
        const cached = this.get(key);
        if (cached !== undefined) return cached;

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

