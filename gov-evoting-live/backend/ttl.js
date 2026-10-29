// Two small helpers that keep the server friendly to a real network and its rate-limited RPC providers.

/**
 * Caches one async value for `ttlMs`, and shares an in-flight request between callers, so a
 * page refreshing every few seconds across many visitors makes one blockchain read, not hundreds.
 * `invalidate()` drops the cached value (call it after a transaction that changes the state).
 */
function createTtlCache(load, ttlMs, now = () => Date.now()) {
  let value;
  let expires = 0;
  let inflight = null;
  return {
    async get() {
      if (value !== undefined && now() < expires) return value;
      if (!inflight) {
        inflight = Promise.resolve()
          .then(load)
          .then((v) => {
            value = v;
            expires = now() + ttlMs;
            return v;
          })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    invalidate() {
      value = undefined;
      expires = 0;
    },
  };
}

/**
 * Reads event logs in block ranges of at most `step` blocks. Many providers refuse a single
 * request that spans a large range, and a live chain adds a block every few seconds.
 * @param {(from: number, to: number) => Promise<any[]>} query  fetches logs for one range
 */
async function queryLogsChunked(query, fromBlock, toBlock, step = 2000) {
  if (!Number.isInteger(step) || step < 1) throw new Error("step must be a positive integer");
  const out = [];
  for (let from = fromBlock; from <= toBlock; from += step) {
    out.push(...(await query(from, Math.min(from + step - 1, toBlock))));
  }
  return out;
}

module.exports = { createTtlCache, queryLogsChunked };
