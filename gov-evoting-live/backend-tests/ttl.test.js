const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createTtlCache, queryLogsChunked } = require("../backend/ttl");

describe("createTtlCache", () => {
  test("loads once and serves the cached value until it expires", async () => {
    let clock = 0, loads = 0;
    const cache = createTtlCache(async () => ++loads, 3000, () => clock);
    assert.equal(await cache.get(), 1);
    clock = 2999;
    assert.equal(await cache.get(), 1);
    clock = 3000;
    assert.equal(await cache.get(), 2);
    assert.equal(loads, 2);
  });

  test("many simultaneous callers share one blockchain read", async () => {
    let loads = 0;
    const cache = createTtlCache(async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return "state"; }, 3000);
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get()));
    assert.equal(loads, 1);
    assert.ok(results.every((r) => r === "state"));
  });

  test("invalidate forces a fresh read, so a vote shows up at once", async () => {
    let n = 0;
    const cache = createTtlCache(async () => ++n, 60_000);
    assert.equal(await cache.get(), 1);
    cache.invalidate();
    assert.equal(await cache.get(), 2);
  });

  test("a failed read is not cached, and the next call tries again", async () => {
    let calls = 0;
    const cache = createTtlCache(async () => { if (++calls === 1) throw new Error("rpc down"); return "ok"; }, 60_000);
    await assert.rejects(cache.get(), /rpc down/);
    assert.equal(await cache.get(), "ok");
  });
});

describe("queryLogsChunked", () => {
  test("splits a long range into ranges no longer than the step, covering every block once", async () => {
    const seen = [];
    const out = await queryLogsChunked(async (from, to) => { seen.push([from, to]); return [{ from, to }]; }, 100, 5099, 2000);
    assert.deepEqual(seen, [[100, 2099], [2100, 4099], [4100, 5099]]);
    assert.equal(out.length, 3);
  });

  test("handles a single block, an exact multiple, and an empty range", async () => {
    const run = async (a, b, s) => { const r = []; await queryLogsChunked(async (f, t) => { r.push([f, t]); return []; }, a, b, s); return r; };
    assert.deepEqual(await run(7, 7, 2000), [[7, 7]]);
    assert.deepEqual(await run(0, 3999, 2000), [[0, 1999], [2000, 3999]]);
    assert.deepEqual(await run(10, 9, 2000), []);
  });

  test("keeps the logs in order and rejects a bad step", async () => {
    const out = await queryLogsChunked(async (f) => [f], 0, 5, 2);
    assert.deepEqual(out, [0, 2, 4]);
    await assert.rejects(queryLogsChunked(async () => [], 0, 5, 0), /positive integer/);
  });
});
