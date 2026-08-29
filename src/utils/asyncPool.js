/**
 * Bounded-concurrency async task runner with fail-fast semantics.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  if (!err) return false;
  const code = err.code || err.name || '';
  const status = err.$metadata?.httpStatusCode || err.statusCode;
  if (status === 429 || status === 503 || status === 502 || status === 500) return true;
  return ['TimeoutError', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'NetworkingError'].includes(code);
}

/**
 * Retry an async function on transient network / rate-limit errors.
 */
async function withRetry(fn, options = {}) {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 400);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isRetryableError(err)) {
        throw err;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

/**
 * Run iterator over items with at most `concurrency` in flight.
 * Stops scheduling new work after the first failure.
 */
async function asyncPool(concurrency, items, iterator) {
  if (!items.length) return;

  const limit = Math.max(1, concurrency);
  let nextIndex = 0;
  let failed = false;
  let firstError = null;

  async function worker() {
    while (!failed) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) break;

      try {
        await iterator(items[current], current);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
        break;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);

  if (firstError) throw firstError;
}

module.exports = {
  asyncPool,
  withRetry,
  isRetryableError,
};
