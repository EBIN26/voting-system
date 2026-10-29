// Sealed vote records: voter -> candidate + symbol, readable only by the admin, only after the election.
const { test, describe, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../backend/app");
const { openDb } = require("../backend/db");
const { createMockUidai } = require("../backend/uidai-mock");
const { voterHash } = require("../backend/crypto-util");
const { createStorage } = require("../backend/storage");
const { createRecordsExporter } = require("../backend/records-export");
const { generateElectionKey, toPem } = require("../lib/keys");
const { electionId } = require("../lib/ballot");
const { sealRecord, openRecord, protectAdminKey, unprotectAdminKey, recordsId } = require("../lib/records");

const ELECTION = electionId(31337, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
const RID = recordsId(ELECTION);
const FAST = 2 ** 10; // low scrypt cost: tests only
const CONFIG = {
  trustProxy: false, idPepper: "p".repeat(40), otpSecret: "o".repeat(40), adminApiKey: "a".repeat(40), sessionTtlSeconds: 600,
  candidateSymbols: ["Lotus", "Hand", "Sun"],
};
const ON_ROLL = ["234567890123", "345678901234"];
const OFF_ROLL = "456789012345";

let electionKey, adminKey, otherKey;
before(async () => {
  electionKey = await generateElectionKey();
  adminKey = await generateElectionKey();
  otherKey = await generateElectionKey();
});

describe("sealing a record", () => {
  const record = { voterId: "234567890123", candidate: "Ben", candidateNumber: 1, symbol: "Hand" };

  test("the admin's key opens it and gets the same data back", async () => {
    const sealed = await sealRecord(adminKey.publicKey, record, RID);
    assert.deepEqual(await openRecord(adminKey.privateKey, sealed, RID), record);
  });

  test("the sealed text reveals neither the voter ID nor the candidate", async () => {
    const sealed = await sealRecord(adminKey.publicKey, record, RID);
    // Look in the decoded bytes: random text can contain a short word like "Ben" by pure chance.
    const raw = Buffer.from(sealed, "base64").toString("latin1");
    for (const secret of ["234567890123", "voterId", "candidate", "Hand"]) assert.ok(!raw.includes(secret), secret);
    assert.ok(!sealed.includes("234567890123"));
  });

  test("equal records look different (fresh key and IV every time)", async () => {
    assert.notEqual(await sealRecord(adminKey.publicKey, record, RID), await sealRecord(adminKey.publicKey, record, RID));
  });

  test("any other key, a changed byte, or another election's id fails to open it", async () => {
    const sealed = await sealRecord(adminKey.publicKey, record, RID);
    await assert.rejects(openRecord(otherKey.privateKey, sealed, RID));
    await assert.rejects(openRecord(adminKey.privateKey, sealed, recordsId("gov-evoting:v1:1:0xabc")));
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 3] ^= 1;
    await assert.rejects(openRecord(adminKey.privateKey, bytes.toString("base64"), RID));
    await assert.rejects(openRecord(adminKey.privateKey, "AAAA", RID));
  });
});

describe("the admin's key file", () => {
  test("opens with the right passphrase only", () => {
    const file = protectAdminKey(adminKey.privateKey, "a long enough passphrase", { scryptN: FAST });
    assert.deepEqual(unprotectAdminKey(file, "a long enough passphrase"), adminKey.privateKey);
    assert.throws(() => unprotectAdminKey(file, "a different passphrase!!"), /Wrong passphrase/);
  });

  test("refuses a short passphrase, and detects a changed file", () => {
    assert.throws(() => protectAdminKey(adminKey.privateKey, "short", { scryptN: FAST }), /at least/);
    const file = protectAdminKey(adminKey.privateKey, "a long enough passphrase", { scryptN: FAST });
    const bytes = Buffer.from(file.ciphertext, "base64");
    bytes[0] ^= 1;
    assert.throws(() => unprotectAdminKey({ ...file, ciphertext: bytes.toString("base64") }, "a long enough passphrase"), /Wrong passphrase|altered/);
    assert.throws(() => unprotectAdminKey({ kind: "other" }, "a long enough passphrase"), /Not an admin/);
  });
});

let server, base, ctx, tmp;

async function boot({ withRecords = true } = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "records-"));
  const citizens = [...ON_ROLL, OFF_ROLL].map((aadhaar, i) => ({ aadhaar, phone: "900000000" + i }));
  const uidai = createMockUidai({ secret: "u".repeat(40), citizens, deliver: () => {} });
  const db = openDb(":memory:");
  const idHashOf = (id) => voterHash(CONFIG.idPepper, uidai.uidTokenFor(id));
  ON_ROLL.forEach((id) => db.addToRoll(idHashOf(id)));

  const state = { phase: "Voting", chainTime: 150, cast: [] };
  const chain = {
    address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    info: async () => ({
      title: "t", candidates: ["Ann", "Ben", "Cat"], phase: state.phase, startTime: 100, endTime: 200,
      chainTime: state.chainTime, eligibleVoters: 2, ballotCount: state.cast.length,
    }),
    castBallot: async (hash, ballot) => {
      state.cast.push({ hash, ballot });
      return { txHash: "0x" + "ab".repeat(32), blockNumber: state.cast.length + 1, gasUsed: 310000 };
    },
  };
  const simpleMode = {
    referenceFor: (id) => uidai.uidTokenFor(id),
    listVoters: () => citizens.map((c) => ({ voterId: c.aadhaar, onRoll: db.isOnRoll(idHashOf(c.aadhaar)) })),
    records: withRecords ? { adminPublicKey: adminKey.publicKey, id: RID } : null,
  };
  const app = createApp({
    config: CONFIG, db, uidai, chain, simpleMode,
    electionKey: { publicKeyPem: toPem(electionKey.publicKey, "PUBLIC KEY"), keyHash: "0x", electionId: ELECTION },
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
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  server = ctx = tmp = null;
});

async function vote(voterId, candidate) {
  const res = await fetch(base + "/api/simple/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voterId, candidate }) });
  return { status: res.status, body: await res.json() };
}

describe("voting with records on", () => {
  beforeEach(() => boot());

  test("a vote adds a sixth step and a sealed record only the admin can open", async () => {
    const r = await vote(ON_ROLL[0], 1);
    assert.equal(r.status, 200);
    assert.equal(r.body.recordSaved, true);
    assert.equal(r.body.steps.length, 6);
    assert.equal(r.body.steps[5].name, "Save a sealed record for the admin");
    assert.equal(ctx.db.recordCount(), 1);

    const [sealed] = ctx.db.allRecords();
    const rec = await openRecord(adminKey.privateKey, sealed, RID);
    assert.equal(rec.voterId, ON_ROLL[0]);
    assert.equal(rec.candidate, "Ben");
    assert.equal(rec.candidateNumber, 1);
    assert.equal(rec.symbol, "Hand");
    assert.equal(rec.txHash, r.body.receipt.txHash);
    await assert.rejects(openRecord(otherKey.privateKey, sealed, RID), "the server's own key material cannot open it");
  });

  test("the database holds no readable voter ID or choice", async () => {
    await vote(ON_ROLL[0], 2);
    const stored = ctx.db.raw.prepare("SELECT * FROM vote_records").all();
    assert.deepEqual(Object.keys(stored[0]), ["id", "sealed"], "only an opaque sealed value is stored");
    const raw = Buffer.from(stored[0].sealed, "base64").toString("latin1");
    assert.ok(!stored[0].sealed.includes(ON_ROLL[0]));
    for (const word of ["voterId", "candidate", "Sun", ON_ROLL[0]]) assert.ok(!raw.includes(word), word);
  });

  test("refused votes leave no record", async () => {
    assert.equal((await vote(OFF_ROLL, 0)).status, 403);
    assert.equal((await vote(ON_ROLL[0], 0)).status, 200);
    assert.equal((await vote(ON_ROLL[0], 1)).status, 409);
    assert.equal(ctx.db.recordCount(), 1);
  });

  test("if sealing fails the vote still stands and the failure is reported", async () => {
    const real = ctx.db.addRecord;
    ctx.db.addRecord = () => { throw new Error("disk full"); };
    const r = await vote(ON_ROLL[1], 0);
    assert.equal(r.status, 200);
    assert.equal(r.body.recordSaved, false);
    assert.equal(r.body.steps.at(-1).ok, false);
    assert.equal(ctx.state.cast.length, 1);
    ctx.db.addRecord = real;
  });

  test("the page can fetch candidates with their symbols", async () => {
    const r = await (await fetch(base + "/api/simple/candidates")).json();
    assert.deepEqual(r.candidates, [{ name: "Ann", symbol: "Lotus" }, { name: "Ben", symbol: "Hand" }, { name: "Cat", symbol: "Sun" }]);
    assert.equal(r.recordsEnabled, true);
  });
});

describe("voting with records off", () => {
  beforeEach(() => boot({ withRecords: false }));

  test("behaves as before: five steps and no record", async () => {
    const r = await vote(ON_ROLL[0], 0);
    assert.equal(r.status, 200);
    assert.equal(r.body.steps.length, 5);
    assert.equal(r.body.recordSaved, null);
    assert.equal(ctx.db.recordCount(), 0);
    assert.equal((await (await fetch(base + "/api/simple/candidates")).json()).recordsEnabled, false);
  });
});

describe("exporting to storage only after the election ends", () => {
  beforeEach(() => boot());

  const exporterFor = () => createRecordsExporter({
    db: ctx.db, chain: ctx.chain, storage: createStorage({ type: "local", dir: path.join(tmp, "bucket") }), electionId: RID,
    candidates: (info) => info.candidates.map((name, i) => ({ name, symbol: CONFIG.candidateSymbols[i] })),
    log: { log() {}, error() {} },
  });

  test("nothing reaches storage while voting is open", async () => {
    await vote(ON_ROLL[0], 0);
    const ex = exporterFor();
    const r = await ex.check();
    assert.equal(r.exported, false);
    assert.match(r.reason, /Voting/);
    assert.equal(fs.existsSync(path.join(tmp, "bucket")), false);
  });

  test("once the election is Closed the sealed records are written, and only once", async () => {
    await vote(ON_ROLL[0], 1);
    await vote(ON_ROLL[1], 2);
    ctx.state.phase = "Closed";
    const ex = exporterFor();
    const first = await ex.check();
    assert.equal(first.exported, true);
    assert.equal(first.count, 2);
    assert.equal((await ex.check()).reason, "already exported");

    const file = path.join(tmp, "bucket", ex.objectName(ctx.chain.address));
    const text = fs.readFileSync(file, "utf8");
    const bundle = JSON.parse(text);
    assert.equal(bundle.count, 2);
    assert.equal(bundle.ballotsOnChain, 2);
    assert.deepEqual(bundle.candidates[1], { name: "Ben", symbol: "Hand" });
    for (const secret of ON_ROLL) assert.ok(!text.includes(secret), "no voter ID in the stored file");

    // The admin can open every record; each is correct.
    const rows = [];
    for (const s of bundle.records) rows.push(await openRecord(adminKey.privateKey, s, RID));
    assert.deepEqual(rows.map((r) => [r.voterId, r.candidate, r.symbol]), [[ON_ROLL[0], "Ben", "Hand"], [ON_ROLL[1], "Cat", "Sun"]]);
  });

  test("the Finalized phase also exports", async () => {
    ctx.state.phase = "Finalized";
    assert.equal((await exporterFor().check()).exported, true);
  });

  test("storage refuses unsafe object names", async () => {
    const storage = createStorage({ type: "local", dir: path.join(tmp, "bucket") });
    for (const bad of ["../x", "a/b", "a\\b", "", ".."]) await assert.rejects(storage.put(bad, "x"), /Invalid/);
    assert.throws(() => createStorage({ type: "ftp" }), /Unknown storage/);
  });
});

describe("Oracle Object Storage through a write-only link", () => {
  const http = require("node:http");
  const SECRET = "SECRETTOKEN123";
  let fake, fakeBase, seen, respondWith;

  beforeEach(async () => {
    seen = [];
    respondWith = 200;
    fake = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
        res.statusCode = respondWith;
        res.end("{}");
      });
    });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    fakeBase = `http://127.0.0.1:${fake.address().port}/p/${SECRET}/n/mynamespace/b/election-records/o/`;
  });
  afterEach(async () => {
    await new Promise((r) => fake.close(r));
  });

  const oracle = (extra = {}) => createStorage({ type: "oracle", parUrl: fakeBase, allowAnyHost: true, ...extra });

  test("uploads with a plain PUT to the bucket link, and sends no login", async () => {
    await oracle().put("vote-records-0xabc.json", '{"hello":1}');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "PUT");
    assert.equal(seen[0].url, `/p/${SECRET}/n/mynamespace/b/election-records/o/vote-records-0xabc.json`);
    assert.equal(seen[0].body, '{"hello":1}');
    assert.equal(seen[0].auth, null);
  });

  test("a link for ONE object writes only that file, to that exact address", async () => {
    const one = createStorage({ type: "oracle", parUrl: fakeBase + "vote-records-0xabc.json", allowAnyHost: true });
    await one.put("vote-records-0xabc.json", "data");
    assert.equal(seen[0].url, `/p/${SECRET}/n/mynamespace/b/election-records/o/vote-records-0xabc.json`);
    await assert.rejects(one.put("vote-records-0xdef.json", "data"), /only allows writing/);
    assert.equal(seen.length, 1, "nothing was sent for the wrong file name");
  });

  test("it cannot read: there is no get or exists", () => {
    const s = oracle();
    assert.equal(s.get, undefined);
    assert.equal(s.exists, undefined);
  });

  test("rejects a link that is not a bucket write link on oraclecloud.com", () => {
    const good = "https://objectstorage.ap-mumbai-1.oraclecloud.com/p/tok/n/ns/b/bk/o/";
    assert.doesNotThrow(() => createStorage({ type: "oracle", parUrl: good }));
    assert.throws(() => createStorage({ type: "oracle", parUrl: "not a url" }), /valid web address/);
    assert.throws(() => createStorage({ type: "oracle", parUrl: good.replace("https", "http") }), /https/);
    assert.throws(() => createStorage({ type: "oracle", parUrl: "https://evil.example.com/p/tok/n/ns/b/bk/o/" }), /oraclecloud\.com/);
    assert.doesNotThrow(() => createStorage({ type: "oracle", parUrl: "https://objectstorage.x.oraclecloud.com/p/tok/n/ns/b/bk/o/file.json" }));
    assert.throws(() => createStorage({ type: "oracle", parUrl: "https://objectstorage.x.oraclecloud.com/n/ns/b/bk/o/" }), /write link/);
  });

  test("a refusal or an unreachable server is reported without revealing the secret link", async () => {
    respondWith = 403;
    const refused = await oracle().put("a.json", "x").then(() => null, (e) => e);
    assert.match(refused.message, /HTTP 403/);
    assert.ok(!refused.message.includes(SECRET));

    const down = createStorage({ type: "oracle", parUrl: "http://127.0.0.1:1/p/" + SECRET + "/n/ns/b/bk/o/", allowAnyHost: true });
    const err = await down.put("a.json", "x").then(() => null, (e) => e);
    assert.match(err.message, /Could not reach/);
    assert.ok(!err.message.includes(SECRET));
  });

  test("the exporter uploads once the election closes, retries after a failure, and never uploads twice", async () => {
    await boot();
    await vote(ON_ROLL[0], 1);
    ctx.state.phase = "Closed";
    const ex = createRecordsExporter({
      db: ctx.db, chain: ctx.chain, storage: oracle(), electionId: RID,
      candidates: (info) => info.candidates.map((name, i) => ({ name, symbol: CONFIG.candidateSymbols[i] })),
      log: { log() {}, error() {} },
    });

    respondWith = 500;
    await assert.rejects(ex.check(), /HTTP 500/);
    assert.equal(ctx.db.getMeta(`records-exported:${ex.objectName(ctx.chain.address)}`), null, "a failed upload is not marked done");

    respondWith = 200;
    const ok = await ex.check();
    assert.equal(ok.exported, true);
    assert.equal((await ex.check()).reason, "already exported");
    assert.equal(seen.filter((r) => r.body && r.body.includes("gov-evoting-vote-records")).length, 2, "one failed try and one good one");

    const uploaded = JSON.parse(seen.at(-1).body);
    assert.equal(uploaded.count, 1);
    assert.ok(!seen.at(-1).body.includes(ON_ROLL[0]), "no voter ID in what leaves the server");
    const row = await openRecord(adminKey.privateKey, uploaded.records[0], RID);
    assert.equal(row.voterId, ON_ROLL[0]);
  });

  test("the settings refuse oracle storage without a link", () => {
    const { loadConfig } = require("../backend/config");
    const base = { ID_PEPPER: "x".repeat(40), OTP_SECRET: "y".repeat(40), ADMIN_API_KEY: "z".repeat(40), RPC_URL: "http://x", CONTRACT_ADDRESS: "0x1", SUBMITTER_PRIVATE_KEY: "0x2" };
    assert.throws(() => loadConfig({ ...base, STORAGE_TYPE: "oracle" }), /STORAGE_PAR_URL/);
    assert.throws(() => loadConfig({ ...base, STORAGE_TYPE: "ftp" }), /must be/);
    assert.doesNotThrow(() => loadConfig({ ...base, STORAGE_TYPE: "oracle", STORAGE_PAR_URL: "https://x" }));
    assert.doesNotThrow(() => loadConfig(base));
  });
});
