/**
 * Generic in-memory write batcher — reduces DB write frequency under load.
 * Enable via flushIntervalMs > 0 in caller.
 */
class WriteBatcher {
    /**
     * @param {(entries: Map<string, unknown>) => Promise<void>} flushHandler
     * @param {number} flushIntervalMs
     */
    constructor(flushHandler, flushIntervalMs) {
        this.flushHandler = flushHandler;
        this.flushIntervalMs = Math.max(0, flushIntervalMs);
        /** @type {Map<string, unknown>} */
        this.pending = new Map();
        this._timer = null;
        this._flushing = false;
        if (this.flushIntervalMs > 0) {
            this._timer = setInterval(() => this.flush().catch((e) => console.error('WriteBatcher flush error:', e)), this.flushIntervalMs);
            if (this._timer.unref) this._timer.unref();
        }
    }

    /**
     * @param {string} key
     * @param {unknown} initial
     * @param {(existing: unknown, incoming: unknown) => unknown} merge
     * @param {unknown} incoming
     */
    enqueue(key, initial, merge, incoming) {
        const existing = this.pending.has(key) ? this.pending.get(key) : initial;
        this.pending.set(key, merge(existing, incoming));
    }

    async flush() {
        if (this._flushing || this.pending.size === 0) return;
        this._flushing = true;
        const batch = this.pending;
        this.pending = new Map();
        try {
            await this.flushHandler(batch);
        } catch (err) {
            for (const [k, v] of batch) {
                if (!this.pending.has(k)) this.pending.set(k, v);
            }
            throw err;
        } finally {
            this._flushing = false;
        }
    }

    shutdown() {
        if (this._timer) clearInterval(this._timer);
    }
}

module.exports = WriteBatcher;
