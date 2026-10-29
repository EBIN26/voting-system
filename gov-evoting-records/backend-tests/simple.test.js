// Simple mode: one button press runs verify -> token -> encrypt -> blockchain.
const { test, describe, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createApp } = require("../backend/app");
const { openDb } = require("../backend/db");
const { createMockUidai } = require("../backend/uidai-mock");
const { voterHash } = require("../backend/crypto-util");
const { generateElectionKey, toPem } = require("../lib/keys");
const { decryptBallot, electionId } = require("../lib/ballot");

const CONFIG = { trustProxy: false, idPepper: "p".repeat(40), otpSecret: "o".repeat(40), adminApiKey: "a".repeat(40), sessionTtlSeconds: 600 };
const ON_ROLL = ["234567890123", "345678901234"];
const OFF_ROLL = "456789012345";
const ID = electionId(31337, "0x5FbDB2315678afecb367f032d93F642f64180aa3");

let key; // one RSA key for the whole file (generation is slow-ish)
before(async () => { key = await generateElectionKey(); });

let server, base, ctx;

async function boot({ simple = true } = {}) {
  const citizens = [...ON_ROLL, OFF_ROLL].map((aadhaar, i) => ({ aadhaar, phone: "900000000" + i }));
  const uidai = createMockUidai({ secret: "u".repeat(40), citizens, deliver: () => {} });
  const db = openDb(":memory:");
  const idHashOf = (id) => voterHash(CONFIG.idPepper, uidai.uidTokenFor(id));
  ON_ROLL.forEach((id) => db.addToRoll(idHashOf(id)));

  const state = { phase: "Voting", chainTime: 150, cast: [] };
  const chain = {
    info: async () => ({ title: "t", candidates: ["Ann", "Ben", "Cat"], phase: state.phase, startTime: 100, endTime: 200, chainTime: state.chainTime, eligibleVoters: 2, ballotCount: state.cast.length }),
    castBallot: async (hash, ballot) => {
      await new Promise((r) => setTimeout(r, 5)); // like a real transaction, gives other requests a chance to run
      state.cast.push({ hash, ballot });
      return { txHash: "0x" + "ab".repeat(32), blockNumber: state.cast.length + 1, gasUsed: 310000 };
    },
  };
  const simpleMode = simple
    ? { referenceFor: (id) => uidai.uidTokenFor(id), listVoters: () => citizens.map((c) => ({ voterId: c.aadhaar, onRoll: db.isOnRoll(idHashOf(c.aadhaar)) })) }
    : null;
  const app = createApp({
    config: CONFIG, db, uidai, chain, simpleMode,
    electionKey: { publicKeyPem: toPem(key.publicKey, "PUBLIC KEY"), keyHash: "0x", electionId: ID },
    limits: { simplePerMinute: 1000 },
  });
  await new Promise((r) => (server = app.listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx = { app, db, chain, state };
}

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  ctx?.app.stop();
  ctx?.db.close();
  server = null;
  ctx = null;
});

async function vote(voterId, candidate) {
  const res = await fetch(base + "/api/simple/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voterId, candidate }) });
  return { status: res.status, body: await res.json() };
}

describe("simple mode", () => {
  test("is not available unless switched on", async () => {
    await boot({ simple: false });
    assert.equal((await vote(ON_ROLL[0], 0)).status, 404);
    assert.equal((await fetch(base + "/api/simple/voters")).status, 404);
  });

  describe("when on", () => {
    beforeEach(() => boot());

    test("one press runs all five steps and puts an encrypted ballot on the chain", async () => {
      const r = await vote(ON_ROLL[0], 1);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.steps.map((s) => s.name), [
        "Check the request", "Verify the voter", "Issue a one-time voting token", "Encrypt the ballot", "Record on the blockchain",
      ]);
      assert.ok(r.body.steps.every((s) => s.ok && typeof s.ms === "number" && typeof s.detail === "string"));
      assert.match(r.body.receipt.confirmationCode, /^0x[0-9a-f]{64}$/);
      assert.equal(ctx.state.cast.length, 1);
      assert.equal(ctx.state.cast[0].hash, r.body.receipt.confirmationCode);
      // What reached the chain is ciphertext, and it decrypts to the candidate that was pressed.
      const onChain = ctx.state.cast[0].ballot;
      assert.equal((onChain.length - 2) / 2, 430);
      assert.equal(await decryptBallot(key.privateKey, onChain, ID, 3), 1);
    });

    test("the same voter cannot vote twice", async () => {
      assert.equal((await vote(ON_ROLL[0], 0)).status, 200);
      const again = await vote(ON_ROLL[0], 2);
      assert.equal(again.status, 409);
      assert.equal(again.body.steps.at(-1).name, "Issue a one-time voting token");
      assert.match(again.body.error, /already voted/);
      assert.equal(ctx.state.cast.length, 1);
    });

    test("pressing many times at once still records exactly one ballot", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => vote(ON_ROLL[1], 0)));
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(ctx.state.cast.length, 1);
    });

    test("a voter who is not on the roll is refused before any token exists", async () => {
      const r = await vote(OFF_ROLL, 0);
      assert.equal(r.status, 403);
      assert.equal(r.body.steps.at(-1).name, "Verify the voter");
      assert.equal(ctx.db.counts().tokensIssued, 0);
      assert.equal(ctx.state.cast.length, 0);
    });

    test("bad input and a closed election stop at the first step", async () => {
      for (const [id, c] of [["123", 0], [ON_ROLL[0], 3], [ON_ROLL[0], -1], [ON_ROLL[0], "1"], [null, 0]]) {
        const r = await vote(id, c);
        assert.equal(r.status, 400, `${id} ${c}`);
        assert.equal(r.body.steps.length, 1);
      }
      ctx.state.chainTime = 250;
      const closed = await vote(ON_ROLL[0], 0);
      assert.equal(closed.status, 409);
      assert.match(closed.body.error, /not open/);
    });

    test("if the contract rejects the ballot, the token is withdrawn and the voter can try again", async () => {
      const real = ctx.chain.castBallot;
      ctx.chain.castBallot = async () => { throw Object.assign(new Error("x"), { revertName: "OutsideVotingWindow" }); };
      const r = await vote(ON_ROLL[0], 0);
      assert.equal(r.status, 409);
      assert.equal(ctx.db.counts().tokensIssued, 0);
      ctx.chain.castBallot = real;
      assert.equal((await vote(ON_ROLL[0], 0)).status, 200);
      assert.equal(ctx.state.cast.length, 1);
    });

    test("if the blockchain result is unknown, the voter stays marked so a second ballot is impossible", async () => {
      ctx.chain.castBallot = async () => { throw Object.assign(new Error("timeout"), { revertName: null }); };
      const r = await vote(ON_ROLL[0], 0);
      assert.equal(r.status, 502);
      assert.equal(ctx.db.counts().tokensIssued, 1);
      assert.equal((await vote(ON_ROLL[0], 0)).status, 409);
    });

    test("lists the dummy voters with their roll status", async () => {
      const r = await (await fetch(base + "/api/simple/voters")).json();
      assert.deepEqual(r.voters.map((v) => v.onRoll), [true, true, false]);
    });
  });

  test("production refuses simple mode, and it needs the mock Aadhaar service", () => {
    const { loadConfig } = require("../backend/config");
    const base = { ID_PEPPER: "x".repeat(40), OTP_SECRET: "y".repeat(40), ADMIN_API_KEY: "z".repeat(40), RPC_URL: "http://x", CONTRACT_ADDRESS: "0x1", SUBMITTER_PRIVATE_KEY: "0x2" };
    assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", SIMPLE_VOTING: "1" }), /production/);
    assert.throws(() => loadConfig({ ...base, SIMPLE_VOTING: "1" }), /only works with the mock/);
    assert.doesNotThrow(() => loadConfig({ ...base, SIMPLE_VOTING: "1", MOCK_UIDAI_SECRET: "m".repeat(40) }));
  });

  test("the demo page has no inline code or external resources", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "..", "frontend", "public", "simple.html"), "utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "inline <script>");
    assert.ok(!/\sstyle=/i.test(html), "inline style attribute");
    assert.ok(!/\son\w+=/i.test(html), "inline event handler");
    assert.ok(!/(src|href)=["']https?:/i.test(html), "external resource");
  });
});
