const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../backend/app");
const { openDb } = require("../backend/db");
const { createMockUidai } = require("../backend/uidai-mock");
const { voterHash } = require("../backend/crypto-util");

const CONFIG = {
  trustProxy: false,
  idPepper: "p".repeat(40),
  otpSecret: "o".repeat(40),
  adminApiKey: "a".repeat(40),
  sessionTtlSeconds: 600,
};
const UID_SECRET = "u".repeat(40);
const ALICE = { aadhaar: "234567890123", phone: "9000000001" };
const BOB = { aadhaar: "345678901234", phone: "9000000002" };   // registered, NOT on the roll
const CARA = { aadhaar: "456789012345", phone: "9000000003" };
const BALLOT = "0x01" + "ab".repeat(429); // 430 bytes, version byte 0x01, like a real ballot

function setup({ chainOverrides = {}, limits = {}, clock, electionKey = null, demoOtp = false, staticDir = null, devRpcUrl = null } = {}) {
  const sms = []; // OTPs "delivered" by the mock gateway
  const citizens = [ALICE, BOB, CARA];
  const uidai = createMockUidai({ secret: UID_SECRET, citizens, ttlSeconds: 300, exposeOtp: demoOtp, deliver: (phone, otp) => sms.push({ phone, otp }), now: clock });
  const db = openDb(":memory:");
  const onRoll = (c) => db.addToRoll(voterHash(CONFIG.idPepper, uidai.uidTokenFor(c.aadhaar)));
  onRoll(ALICE);
  onRoll(CARA);

  const state = { phase: "Voting", cast: [] };
  const chain = {
    info: async () => ({ title: "t", candidates: ["A", "B"], phase: state.phase, startTime: 100, endTime: 200, chainTime: 150, eligibleVoters: 3, ballotCount: state.cast.length }),
    castBallot: async (hash, ballot) => {
      state.cast.push({ hash, ballot });
      return { txHash: "0xtx" + state.cast.length, blockNumber: 10 + state.cast.length, gasUsed: 300000 };
    },
    tokenUsed: async (hash) => state.cast.some((c) => c.hash === hash),
    results: async () => [{ name: "A", votes: 3 }, { name: "B", votes: 1 }],
    tallyProgress: async () => ({ phase: state.phase, threshold: 2, submitted: 1, leadingAgreement: 1, trustees: [{ address: "0xT1", submitted: true }, { address: "0xT2", submitted: false }] }),
    closeElection: async () => { state.phase = "Closed"; return "0xclosetx"; },
    ...chainOverrides,
  };
  const app = createApp({ config: { ...CONFIG, showDemoOtp: demoOtp }, db, uidai, chain, electionKey, staticDir, devRpcUrl, now: clock, limits: { otpPerMinute: 1000, verifyPerMinute: 1000, tokenPerMinute: 1000, castPerMinute: 1000, otpPerNumber: 100, ...limits } });
  return { app, db, sms, state, chain };
}

let server, base, ctx;
async function boot(opts) {
  ctx = setup(opts);
  await new Promise((r) => (server = ctx.app.listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  ctx?.app.stop();
  ctx?.db.close();
  server = null;
  ctx = null; // tests that never call boot() must not reuse a closed database
});

async function call(path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function otpFlow(prefix, citizen) {
  const start = await call(`/api/${prefix}/start`, { aadhaar: citizen.aadhaar });
  assert.equal(start.status, 200);
  const sms = ctx.sms.at(-1);
  return { start, otp: sms?.otp };
}
async function register(citizen) {
  const { start, otp } = await otpFlow("register", citizen);
  return call("/api/register/verify", { txnId: start.body.txnId, otp });
}
async function login(citizen) {
  const { start, otp } = await otpFlow("auth", citizen);
  return call("/api/auth/verify", { txnId: start.body.txnId, otp });
}
const auth = (session) => ({ Authorization: "Bearer " + session });

describe("registration and authentication", () => {
  beforeEach(() => boot());

  test("registers a citizen with an OTP, then logs in with another", async () => {
    const reg = await register(ALICE);
    assert.equal(reg.status, 200);
    assert.equal(reg.body.alreadyRegistered, false);
    const log = await login(ALICE);
    assert.equal(log.status, 200);
    assert.match(log.body.session, /^0x[0-9a-f]{64}$/);
  });

  test("registering twice is harmless and reported", async () => {
    await register(ALICE);
    assert.equal((await register(ALICE)).body.alreadyRegistered, true);
    assert.equal(ctx.db.counts().registered, 1);
  });

  test("an unknown Aadhaar number looks exactly like a known one until the OTP step", async () => {
    const unknown = await call("/api/register/start", { aadhaar: "999999999999" });
    const known = await call("/api/register/start", { aadhaar: ALICE.aadhaar });
    assert.equal(unknown.status, known.status);
    assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(known.body).sort());
    assert.equal(ctx.sms.length, 1); // only the real number got an SMS
    const bad = await call("/api/register/verify", { txnId: unknown.body.txnId, otp: "123456" });
    assert.equal(bad.status, 403);
  });

  test("rejects a wrong OTP and locks the attempt after 3 tries", async () => {
    const { start, otp } = await otpFlow("register", ALICE);
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) assert.equal((await call("/api/register/verify", { txnId: start.body.txnId, otp: wrong })).status, 403);
    // The correct OTP no longer works once the attempts are used up.
    assert.equal((await call("/api/register/verify", { txnId: start.body.txnId, otp })).status, 403);
    assert.equal(ctx.db.counts().registered, 0);
  });

  test("an OTP works only once", async () => {
    const { start, otp } = await otpFlow("register", ALICE);
    assert.equal((await call("/api/register/verify", { txnId: start.body.txnId, otp })).status, 200);
    assert.equal((await call("/api/register/verify", { txnId: start.body.txnId, otp })).status, 403);
  });

  test("an unregistered person cannot log in, and gets the same message as a wrong OTP", async () => {
    const log = await login(ALICE);
    assert.equal(log.status, 403);
    const { start } = await otpFlow("auth", ALICE);
    const wrong = await call("/api/auth/verify", { txnId: start.body.txnId, otp: "000000" });
    assert.equal(log.body.error, wrong.body.error);
  });

  test("validates input formats", async () => {
    for (const aadhaar of ["12345", "123456789012", "abcdefghijkl", 234567890123, null]) {
      assert.equal((await call("/api/register/start", { aadhaar })).status, 400, String(aadhaar));
    }
    assert.equal((await call("/api/register/verify", { txnId: "nope", otp: "123456" })).status, 400);
    assert.equal((await call("/api/auth/verify", { txnId: "a".repeat(32), otp: "12" })).status, 400);
  });

  test("limits OTP requests per Aadhaar number", async () => {
    await afterEachRestart({ limits: { otpPerNumber: 2 } });
    assert.equal((await call("/api/register/start", { aadhaar: ALICE.aadhaar })).status, 200);
    assert.equal((await call("/api/register/start", { aadhaar: ALICE.aadhaar })).status, 200);
    assert.equal((await call("/api/auth/start", { aadhaar: ALICE.aadhaar })).status, 429);
    assert.equal((await call("/api/register/start", { aadhaar: CARA.aadhaar })).status, 200); // other numbers unaffected
  });
});

async function afterEachRestart(opts) {
  await new Promise((r) => server.close(r));
  ctx.app.stop();
  ctx.db.close();
  await boot(opts);
}

describe("voter verification and voting tokens", () => {
  beforeEach(() => boot());

  async function sessionFor(citizen) {
    await register(citizen);
    return (await login(citizen)).body.session;
  }

  test("issues one token to an eligible registered voter and ends their session", async () => {
    const session = await sessionFor(ALICE);
    const res = await call("/api/voting/token", {}, auth(session));
    assert.equal(res.status, 200);
    assert.match(res.body.token, /^0x[0-9a-f]{64}$/);
    // The session is spent: the voter is now identified only by the token.
    assert.equal((await call("/api/voting/token", {}, auth(session))).status, 401);
  });

  test("never issues a second token to the same person", async () => {
    const first = await sessionFor(ALICE);
    assert.equal((await call("/api/voting/token", {}, auth(first))).status, 200);
    const second = (await login(ALICE)).body.session;
    const again = await call("/api/voting/token", {}, auth(second));
    assert.equal(again.status, 409);
    assert.equal(ctx.db.counts().tokensIssued, 1);
  });

  test("refuses someone who is registered but not on the electoral roll", async () => {
    const session = await sessionFor(BOB);
    const res = await call("/api/voting/token", {}, auth(session));
    assert.equal(res.status, 403);
    assert.equal(ctx.db.counts().tokensIssued, 0);
  });

  test("requires a valid session", async () => {
    assert.equal((await call("/api/voting/token", {})).status, 401);
    assert.equal((await call("/api/voting/token", {}, auth("0x" + "11".repeat(32)))).status, 401);
    assert.equal((await call("/api/voting/token", {}, auth("garbage"))).status, 401);
  });

  test("does not issue tokens while voting is closed, and does not use up the voter's chance", async () => {
    const session = await sessionFor(ALICE);
    ctx.state.phase = "Setup";
    assert.equal((await call("/api/voting/token", {}, auth(session))).status, 409);
    ctx.state.phase = "Voting";
    assert.equal((await call("/api/voting/token", {}, auth(session))).status, 200);
  });

  test("the tokens table has no link to any voter", () => {
    const cols = ctx.db.raw.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name);
    assert.deepEqual(cols, ["token_hash", "state"]);
    const voterCols = ctx.db.raw.prepare("PRAGMA table_info(voters)").all().map((c) => c.name);
    assert.deepEqual(voterCols, ["id_hash", "token_issued"]); // no time, no token reference
  });

  test("no Aadhaar number or phone is stored anywhere", async () => {
    await sessionFor(ALICE);
    for (const t of ["roll", "voters", "sessions", "tokens"]) {
      const rows = JSON.stringify(ctx.db.raw.prepare(`SELECT * FROM ${t}`).all());
      assert.ok(!rows.includes(ALICE.aadhaar) && !rows.includes(ALICE.phone), t);
    }
  });
});

describe("casting ballots with a token", () => {
  beforeEach(() => boot());

  async function newToken(citizen = ALICE) {
    await register(citizen);
    const session = (await login(citizen)).body.session;
    return (await call("/api/voting/token", {}, auth(session))).body.token;
  }

  test("relays a ballot once for a valid token", async () => {
    const token = await newToken();
    const res = await call("/api/voting/cast", { token, ballot: BALLOT });
    assert.equal(res.status, 200);
    assert.equal(ctx.state.cast.length, 1);
    assert.equal(ctx.state.cast[0].ballot, BALLOT);
    assert.equal(ctx.db.counts().tokensUsed, 1);
  });

  test("the response and the stored ballot contain nothing that identifies the voter", async () => {
    const token = await newToken();
    const res = await call("/api/voting/cast", { token, ballot: BALLOT });
    assert.deepEqual(Object.keys(res.body).sort(), ["ok", "txHash"]);
  });

  test("rejects a reused, unknown or malformed token", async () => {
    const token = await newToken();
    await call("/api/voting/cast", { token, ballot: BALLOT });
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 403);
    assert.equal((await call("/api/voting/cast", { token: "0x" + "22".repeat(32), ballot: BALLOT })).status, 403);
    assert.equal((await call("/api/voting/cast", { token: "nope", ballot: BALLOT })).status, 400);
    assert.equal(ctx.state.cast.length, 1);
  });

  test("rejects malformed, empty and oversized ballots", async () => {
    const token = await newToken();
    const wrongSize = "0x01" + "ab".repeat(300);
    const wrongVersion = "0x02" + "ab".repeat(429);
    for (const ballot of ["0x", "abcd", "0xzz", wrongSize, wrongVersion, "0x01" + "ab".repeat(1024), 123, null]) {
      assert.equal((await call("/api/voting/cast", { token, ballot })).status, 400, String(ballot).slice(0, 12));
    }
    // none of those burned the token
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 200);
  });

  test("two simultaneous requests with the same token produce exactly one ballot", async () => {
    const token = await newToken();
    const results = await Promise.all(Array.from({ length: 8 }, () => call("/api/voting/cast", { token, ballot: BALLOT })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(ctx.state.cast.length, 1);
  });

  test("gives the token back if the blockchain failed, so the voter can retry", async () => {
    const token = await newToken();
    let fail = true;
    ctx.chain.castBallot = async (hash, ballot) => {
      if (fail) throw Object.assign(new Error("rpc down"), { revertName: null });
      ctx.state.cast.push({ hash, ballot });
      return { txHash: "0xtx", blockNumber: 1, gasUsed: 1 };
    };
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 502);
    fail = false;
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 200);
  });

  test("keeps the token spent if the contract says it was already used", async () => {
    const token = await newToken();
    ctx.chain.castBallot = async () => { throw Object.assign(new Error("x"), { revertName: "TokenAlreadyUsed" }); };
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 403);
    assert.equal(ctx.db.counts().tokensUsed, 1);
  });

  test("returns the token when the contract rejects for phase or window", async () => {
    const token = await newToken();
    ctx.chain.castBallot = async () => { throw Object.assign(new Error("x"), { revertName: "OutsideVotingWindow" }); };
    assert.equal((await call("/api/voting/cast", { token, ballot: BALLOT })).status, 409);
    assert.equal(ctx.db.counts().tokensUsed, 0);
  });

  test("two different voters each get one working token", async () => {
    const a = await newToken(ALICE);
    const c = await newToken(CARA);
    assert.notEqual(a, c);
    assert.equal((await call("/api/voting/cast", { token: a, ballot: BALLOT })).status, 200);
    assert.equal((await call("/api/voting/cast", { token: c, ballot: BALLOT })).status, 200);
    assert.equal(ctx.state.cast.length, 2);
  });
});

describe("results, closing and the admin page", () => {
  beforeEach(() => boot());

  test("results are refused until the trustees have agreed, then published with totals", async () => {
    ctx.state.phase = "Voting";
    assert.equal((await call("/api/public/results")).status, 409);
    ctx.state.phase = "Closed";
    assert.equal((await call("/api/public/results")).status, 409);
    ctx.state.phase = "Finalized";
    const res = await call("/api/public/results");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, [{ name: "A", votes: 3 }, { name: "B", votes: 1 }]);
    assert.equal(res.body.counted, 4);
    assert.equal(res.body.notCounted, res.body.ballots - 4);
  });

  test("tally progress shows counts of trustees, not tallies", async () => {
    const res = await call("/api/public/tally-progress");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["leadingAgreement", "phase", "submitted", "threshold", "trustees"]);
  });

  test("closing works for anyone once the contract allows it, and not before", async () => {
    assert.equal((await call("/api/election/close", {})).status, 200);
    assert.equal(ctx.state.phase, "Closed");
    for (const [name, status] of [["VotingNotOver", 409], ["WrongPhase", 409]]) {
      ctx.chain.closeElection = async () => { throw Object.assign(new Error(name), { revertName: name }); };
      assert.equal((await call("/api/election/close", {})).status, status, name);
    }
    ctx.chain.closeElection = async () => { throw Object.assign(new Error("rpc down"), { revertName: null }); };
    assert.equal((await call("/api/election/close", {})).status, 502);
  });

  test("closing is rate limited", async () => {
    await afterEachRestart({ limits: { closePerMinute: 2 } });
    await call("/api/election/close", {});
    await call("/api/election/close", {});
    assert.equal((await call("/api/election/close", {})).status, 429);
  });

  test("the development RPC proxy does not exist unless explicitly enabled", async () => {
    assert.equal((await call("/dev/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })).status, 404);
  });

  test("the development RPC proxy forwards only eth_* calls", async () => {
    const http = require("node:http");
    const seen = [];
    const upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { seen.push(JSON.parse(body).method); res.setHeader("Content-Type", "application/json"); res.end('{"jsonrpc":"2.0","id":1,"result":"0x7a69"}'); });
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    await afterEachRestart({ devRpcUrl: `http://127.0.0.1:${upstream.address().port}` });
    try {
      const ok = await call("/dev/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.result, "0x7a69");
      for (const method of ["hardhat_setBalance", "evm_mine", "debug_traceCall"]) {
        assert.equal((await call("/dev/rpc", { jsonrpc: "2.0", id: 1, method, params: [] })).status, 400, method);
      }
      assert.equal((await call("/dev/rpc", [{ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, { jsonrpc: "2.0", id: 2, method: "hardhat_reset" }])).status, 400);
      assert.deepEqual(seen, ["eth_chainId"]);
    } finally {
      await new Promise((r) => upstream.close(r));
    }
  });

  test("the admin page is served with the strict policy and has no inline code or external resources", async () => {
    const path = require("node:path");
    const dir = path.resolve(__dirname, "..", "frontend", "public");
    await afterEachRestart({ staticDir: dir });
    const res = await fetch(base + "/admin.html");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "inline <script>");
    assert.ok(!/\sstyle=/i.test(html), "inline style attribute");
    assert.ok(!/\son\w+=/i.test(html), "inline event handler");
    assert.ok(!/(src|href)=["']https?:/i.test(html), "external resource");
    assert.match(html, /name="robots" content="noindex/);
  });
});

describe("sessions and admin", () => {
  test("a session expires", async () => {
    let t = 1_000_000_000_000;
    await boot({ clock: () => t });
    await register(ALICE);
    const session = (await login(ALICE)).body.session;
    t += (CONFIG.sessionTtlSeconds + 1) * 1000;
    assert.equal((await call("/api/voting/token", {}, auth(session))).status, 401);
  });

  test("admin stats need the admin key and show only counts", async () => {
    await boot();
    await register(ALICE);
    assert.equal((await call("/api/admin/stats")).status, 401);
    assert.equal((await call("/api/admin/stats", undefined, { "x-admin-api-key": "wrong" })).status, 401);
    const ok = await call("/api/admin/stats", undefined, { "x-admin-api-key": CONFIG.adminApiKey });
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ["registered", "rollSize", "tokensIssued", "tokensUsed"]);
  });

  test("the OTP is never in the response unless demo mode is switched on", async () => {
    await boot();
    const normal = await call("/api/register/start", { aadhaar: ALICE.aadhaar });
    assert.equal("demoOtp" in normal.body, false);
    await afterEachRestart({ demoOtp: true });
    const demo = await call("/api/register/start", { aadhaar: ALICE.aadhaar });
    assert.match(demo.body.demoOtp, /^\d{6}$/);
    assert.equal(demo.body.demoOtp, ctx.sms.at(-1).otp);
    // an unknown number still gets no OTP, in either mode
    const unknown = await call("/api/register/start", { aadhaar: "999999999999" });
    assert.equal("demoOtp" in unknown.body, false);
  });

  test("production configuration refuses demo mode and the mock Aadhaar service", () => {
    const { loadConfig } = require("../backend/config");
    const base = {
      NODE_ENV: "production", ID_PEPPER: "x".repeat(40), OTP_SECRET: "y".repeat(40), ADMIN_API_KEY: "z".repeat(40),
      RPC_URL: "http://x", CONTRACT_ADDRESS: "0x1", SUBMITTER_PRIVATE_KEY: "0x2",
    };
    assert.doesNotThrow(() => loadConfig(base));
    assert.throws(() => loadConfig({ ...base, MOCK_UIDAI_SECRET: "m".repeat(40) }), /production/);
    assert.throws(() => loadConfig({ ...base, SHOW_DEMO_OTP: "1" }), /production|only works/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: "development", SHOW_DEMO_OTP: "1" }), /only works with the mock/);
  });

  test("receipt lookup reports whether a ballot for a token hash is on-chain", async () => {
    await boot();
    await register(ALICE);
    const session = (await login(ALICE)).body.session;
    const { token } = (await call("/api/voting/token", {}, auth(session))).body;
    const { tokenHash } = require("../backend/crypto-util");
    const hash = tokenHash(token);
    assert.deepEqual((await call("/api/receipt/" + hash)).body, { recorded: false });
    await call("/api/voting/cast", { token, ballot: BALLOT });
    assert.deepEqual((await call("/api/receipt/" + hash)).body, { recorded: true });
    assert.equal((await call("/api/receipt/not-a-hash")).status, 400);
  });

  test("serves the web app with a strict content security policy", async () => {
    const dir = require("node:path").resolve(__dirname, "..", "frontend", "public");
    await boot({ staticDir: dir });
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Online Voting<\/title>/);
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), csp);
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("the web app page has no inline scripts, styles or third-party resources", () => {
    const html = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "..", "frontend", "public", "index.html"), "utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "inline <script>");
    assert.ok(!/\sstyle=/i.test(html), "inline style attribute");
    assert.ok(!/\son\w+=/i.test(html), "inline event handler");
    assert.ok(!/(src|href)=["']https?:/i.test(html), "external resource");
  });

  test("serves the election public key only when one is configured", async () => {
    await boot();
    assert.equal((await call("/api/election-key")).status, 503);
    await afterEachRestart({ electionKey: { publicKeyPem: "PEM", keyHash: "0x" + "ab".repeat(32), electionId: "gov-evoting:v1:1:0xabc" } });
    const res = await call("/api/election-key");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["electionId", "keyHash", "publicKeyPem"]);
  });

  test("endpoints are rate limited per IP", async () => {
    await boot({ limits: { castPerMinute: 2 } });
    const t = "0x" + "33".repeat(32);
    await call("/api/voting/cast", { token: t, ballot: BALLOT });
    await call("/api/voting/cast", { token: t, ballot: BALLOT });
    assert.equal((await call("/api/voting/cast", { token: t, ballot: BALLOT })).status, 429);
  });
});
