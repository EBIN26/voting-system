const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const store = require("./store");
const { hashCode } = require("./codes");
const chain = require("./chain");

const PHASES = ["Registration", "Voting", "Ended"];
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DECIMAL = /^\d{1,78}$/;

const app = express();
app.disable("x-powered-by");
if (config.trustProxy !== false) app.set("trust proxy", config.trustProxy);

// No access log on purpose: the relayer must not keep a record of who voted when.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        workerSrc: ["'self'", "blob:"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use(express.json({ limit: "4kb" }));

const limiter = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });

// ---------- helpers ----------

const queueRelayer = chain.makeQueue();
const queueRegistrar = chain.makeQueue();

const REVERTS = {
  WrongPhase: [409, "The election is not in the right phase for this action."],
  VotingClosed: [409, "Voting has closed."],
  VotingStillOpen: [409, "Voting is still open."],
  InvalidCandidate: [400, "Invalid candidate."],
  InvalidScope: [400, "Invalid proof."],
  Semaphore__YouAreUsingTheSameNullifierTwice: [409, "This voter has already voted."],
  Semaphore__MerkleTreeRootIsNotPartOfTheGroup: [400, "Proof was not made for the registered voter group."],
  Semaphore__MerkleTreeRootIsExpired: [400, "Proof is out of date. Please try again."],
  Semaphore__InvalidProof: [400, "Invalid proof."],
  Semaphore__MerkleTreeDepthIsNotSupported: [400, "Invalid proof."],
};

function sendError(res, err, what) {
  const name = chain.revertName(err);
  if (name && REVERTS[name]) {
    const [status, message] = REVERTS[name];
    return res.status(status).json({ error: message });
  }
  console.error(`${what} failed:`, name || err.shortMessage || err.message);
  return res.status(500).json({ error: "Internal server error." });
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-api-key"];
  if (typeof key !== "string" || !safeEqual(key, config.adminApiKey)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

function parseCommitment(v) {
  if (typeof v !== "string" || !DECIMAL.test(v)) return null;
  const n = BigInt(v);
  if (n === 0n || n >= SNARK_SCALAR_FIELD) return null;
  return n.toString();
}

function parseProof(p) {
  if (!p || typeof p !== "object") return null;
  const fields = ["merkleTreeDepth", "merkleTreeRoot", "nullifier", "message", "scope"];
  for (const f of fields) if (typeof p[f] !== "string" && typeof p[f] !== "number") return null;
  if (!Array.isArray(p.points) || p.points.length !== 8) return null;
  const out = {};
  for (const f of fields) {
    const s = String(p[f]);
    if (!DECIMAL.test(s)) return null;
    out[f] = s;
  }
  out.points = [];
  for (const x of p.points) {
    const s = String(x);
    if (!DECIMAL.test(s)) return null;
    out.points.push(s);
  }
  return out;
}

// ---------- public API ----------

app.get("/api/election", async (req, res) => {
  try {
    const [title, candidates, phase, endsAt, registered, votes, groupId, now] = await Promise.all([
      chain.reader.title(),
      chain.reader.candidates(),
      chain.reader.phase(),
      chain.reader.votingEndsAt(),
      chain.reader.registeredCount(),
      chain.reader.totalVotes(),
      chain.reader.groupId(),
      chain.provider.getBlock("latest"),
    ]);
    res.json({
      title,
      candidates: [...candidates],
      phase: PHASES[Number(phase)],
      votingEndsAt: Number(endsAt),
      chainTime: now.timestamp,
      registeredCount: Number(registered),
      totalVotes: Number(votes),
      groupId: groupId.toString(),
      contract: config.contractAddress,
    });
  } catch (e) {
    sendError(res, e, "election");
  }
});

// Public group membership, read from chain events, so voters can build their proofs locally.
app.get("/api/group", async (req, res) => {
  try {
    res.json({ members: await chain.groupMembers() });
  } catch (e) {
    sendError(res, e, "group");
  }
});

app.post("/api/register", limiter(60_000, 5), async (req, res) => {
  const { code } = req.body || {};
  const commitment = parseCommitment(req.body?.commitment);
  if (typeof code !== "string" || code.length > 40 || !commitment) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    if (PHASES[Number(await chain.reader.phase())] !== "Registration") {
      return res.status(409).json({ error: "Registration is closed." });
    }
  } catch (e) {
    return sendError(res, e, "register");
  }
  const result = store.redeem(hashCode(code, config.codePepper), commitment);
  if (result === "invalid_code" || result === "used_code") {
    // Same answer for both so codes cannot be probed.
    return res.status(403).json({ error: "This code is invalid or already used." });
  }
  if (result === "duplicate_commitment") return res.status(409).json({ error: "Identity already registered." });
  res.json({ ok: true, message: "Registered. Keep your identity backup safe; you need it to vote." });
});

app.post("/api/vote", limiter(60_000, 20), async (req, res) => {
  const candidate = req.body?.candidate;
  const proof = parseProof(req.body?.proof);
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 49 || !proof) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    const txHash = await queueRelayer(async () => {
      await chain.asRelayer.vote.staticCall(candidate, proof); // cheap pre-check; surfaces the revert reason
      const tx = await chain.asRelayer.vote(candidate, proof);
      await tx.wait();
      return tx.hash;
    });
    // Deliberately not returning anything that identifies the voter.
    res.json({ ok: true, txHash });
  } catch (e) {
    sendError(res, e, "vote");
  }
});

// Anyone may finalise once the deadline has passed.
app.post("/api/election/end", limiter(60_000, 5), async (req, res) => {
  try {
    const txHash = await queueRelayer(async () => {
      const tx = await chain.asRelayer.endElection();
      await tx.wait();
      return tx.hash;
    });
    res.json({ ok: true, txHash });
  } catch (e) {
    sendError(res, e, "end");
  }
});

app.get("/api/results", async (req, res) => {
  try {
    const [names, counts] = await Promise.all([chain.reader.candidates(), chain.reader.results()]);
    res.json({ results: [...names].map((name, i) => ({ name, votes: Number(counts[i]) })) });
  } catch (e) {
    sendError(res, e, "results");
  }
});

// ---------- admin API (registration only; election admin key stays offline) ----------

app.get("/api/admin/status", requireAdmin, async (req, res) => {
  res.json(store.counts());
});

app.post("/api/admin/registration/commit", requireAdmin, limiter(60_000, 5), async (req, res) => {
  try {
    if (PHASES[Number(await chain.reader.phase())] !== "Registration") {
      return res.status(409).json({ error: "Registration is closed." });
    }
    const pending = store.pending();
    const alreadyOnChain = Number(await chain.reader.registeredCount());
    if (pending.length + alreadyOnChain < config.minVoters) {
      return res.status(409).json({
        error: `At least ${config.minVoters} voters are needed for a meaningful anonymity set; have ${pending.length + alreadyOnChain}.`,
      });
    }
    // Shuffle so on-chain order reveals nothing about when each voter registered.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    let sent = 0;
    for (let i = 0; i < pending.length; i += 50) {
      const batch = pending.slice(i, i + 50);
      await queueRegistrar(async () => {
        const tx = await chain.asRegistrar.registerVoters(batch);
        await tx.wait();
      });
      store.markCommitted(batch);
      sent += batch.length;
    }
    res.json({ ok: true, committed: sent, totalRegistered: Number(await chain.reader.registeredCount()) });
  } catch (e) {
    sendError(res, e, "commit");
  }
});

// ---------- zk circuit artifacts (served locally so no third party sees voters) ----------

// Must match the circuit version used by @semaphore-protocol/proof (see its dist/index.node.js).
const SNARK_ARTIFACT_VERSION = "4.13.0";
const ARTIFACT_DIR = path.resolve(__dirname, "..", "data", "snark-artifacts");
const artifactJobs = new Map();

async function ensureArtifacts(depth) {
  const wasm = path.join(ARTIFACT_DIR, `semaphore-${depth}.wasm`);
  const zkey = path.join(ARTIFACT_DIR, `semaphore-${depth}.zkey`);
  if (fs.existsSync(wasm) && fs.existsSync(zkey)) return { wasm, zkey };
  if (!artifactJobs.has(depth)) {
    artifactJobs.set(
      depth,
      (async () => {
        const { maybeGetSnarkArtifacts, Project } = await import("@zk-kit/artifacts");
        const got = await maybeGetSnarkArtifacts(Project.SEMAPHORE, { parameters: [depth], version: SNARK_ARTIFACT_VERSION });
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        fs.copyFileSync(got.wasm, wasm);
        fs.copyFileSync(got.zkey, zkey);
        return { wasm, zkey };
      })().finally(() => artifactJobs.delete(depth))
    );
  }
  return artifactJobs.get(depth);
}

// The version is part of the URL so a browser can never reuse circuit files from another version.
app.get("/artifacts/:version/:file", async (req, res) => {
  if (req.params.version !== `v${SNARK_ARTIFACT_VERSION}`) return res.status(404).json({ error: "Not found." });
  const m = /^semaphore-(\d{1,2})\.(wasm|zkey)$/.exec(req.params.file);
  const depth = m ? Number(m[1]) : 0;
  if (!m || depth < 1 || depth > 32) return res.status(404).json({ error: "Not found." });
  try {
    const files = await ensureArtifacts(depth);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(files[m[2]]);
  } catch (e) {
    console.error("artifact error:", e.message);
    res.status(502).json({ error: "Circuit files unavailable." });
  }
});

// ---------- frontend ----------

app.use(express.static(path.resolve(__dirname, "..", "frontend", "public"), { index: "index.html" }));

app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ error: "Invalid request." });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error." });
});

(async () => {
  await chain.init();
  app.listen(config.port, config.host, () => {
    console.log(`Voting server on http://${config.host}:${config.port}`);
    console.log("Contract:", config.contractAddress);
  });
})().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});

module.exports = app;
