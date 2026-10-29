const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { sha256, voterHash, safeEqual, randomToken, tokenHash } = require("./crypto-util");
const { mountSimpleVoting } = require("./simple");

const AADHAAR = /^[2-9]\d{11}$/;
const TXN = /^[0-9a-f]{32}$/;
const OTP = /^\d{6}$/;
const TOKEN = /^0x[0-9a-f]{64}$/;
const BALLOT = /^0x(?:[0-9a-f]{2}){1,1024}$/;
// RSA-3072 ballots are always exactly 430 bytes and start with version byte 0x01
// (see lib/ballot.js). Anything else is not a ballot, so it is refused before it costs gas.
const BALLOT_BYTES = 430;

/**
 * @param {object} deps
 * @param {object} deps.config   from loadConfig()
 * @param {object} deps.db       from openDb()
 * @param {object} deps.uidai    Aadhaar OTP service (mock or real adapter)
 * @param {object} deps.chain    from createChain() (or a stub in tests)
 * @param {object} [deps.electionKey] { publicKeyPem, keyHash, electionId } served to voters
 * @param {object} [deps.simpleMode] { referenceFor, listVoters } enables the demo one-click page
 * @param {object} [deps.limits] override rate limits (tests)
 * @param {() => number} [deps.now] unix-ms clock (tests)
 */
function createApp({ config, db, uidai, chain, electionKey = null, staticDir = null, devRpcUrl = null, simpleMode = null, limits = {}, now = () => Date.now() }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy !== false) app.set("trust proxy", config.trustProxy);

  // No access log on purpose: this server must not keep a record of who voted when.
  app.use(
    helmet({
      referrerPolicy: { policy: "no-referrer" },
      contentSecurityPolicy: {
        directives: {
          // Only our own files: no inline scripts or styles, no third-party hosts.
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  app.use(express.json({ limit: "8kb" }));

  const rl = (windowMs, limit) =>
    rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });
  const ipOtp = rl(60_000, limits.otpPerMinute ?? 5);
  const ipVerify = rl(60_000, limits.verifyPerMinute ?? 10);
  const ipToken = rl(60_000, limits.tokenPerMinute ?? 10);
  const ipCast = rl(60_000, limits.castPerMinute ?? 20);

  // Per-Aadhaar budget so one number cannot be used to spam a phone with OTPs.
  const budget = new Map();
  const OTP_BUDGET = limits.otpPerNumber ?? 3;
  const OTP_WINDOW_MS = 10 * 60_000;
  function otpBudgetOk(aadhaar) {
    const key = sha256(aadhaar);
    const t = now();
    const b = budget.get(key);
    if (!b || b.reset <= t) {
      budget.set(key, { count: 1, reset: t + OTP_WINDOW_MS });
      return true;
    }
    return ++b.count <= OTP_BUDGET;
  }
  const sweeper = setInterval(() => {
    const t = now();
    for (const [k, b] of budget) if (b.reset <= t) budget.delete(k);
    db.purgeSessions(Math.floor(t / 1000));
  }, 60_000);
  sweeper.unref();

  const idHashOf = (uidToken) => voterHash(config.idPepper, uidToken);

  function bearer(req) {
    const h = req.headers.authorization;
    return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
  }

  function requireSession(req, res, next) {
    const token = bearer(req);
    const idHash = token && /^0x[0-9a-f]{64}$/.test(token) ? db.getSession(sha256(token), Math.floor(now() / 1000)) : null;
    if (!idHash) return res.status(401).json({ error: "Please log in again." });
    req.idHash = idHash;
    req.sessionHash = sha256(token);
    next();
  }

  function requireAdmin(req, res, next) {
    const key = req.headers["x-admin-api-key"];
    if (typeof key !== "string" || !safeEqual(key, config.adminApiKey)) return res.status(401).json({ error: "Unauthorized." });
    next();
  }

  async function startOtp(req, res) {
    const aadhaar = req.body?.aadhaar;
    if (typeof aadhaar !== "string" || !AADHAAR.test(aadhaar)) return res.status(400).json({ error: "Enter a valid 12-digit Aadhaar number." });
    if (!otpBudgetOk(aadhaar)) return res.status(429).json({ error: "Too many OTP requests for this number. Try again later." });
    try {
      const { txnId, demoOtp } = await uidai.sendOtp(aadhaar);
      // The same answer whether or not the number exists (except in demo mode, see config).
      const body = { txnId, message: "If the number is valid, an OTP was sent to the linked phone." };
      if (config.showDemoOtp && demoOtp) body.demoOtp = demoOtp;
      res.json(body);
    } catch (e) {
      console.error("OTP start failed:", e.message);
      res.status(502).json({ error: "Aadhaar service unavailable." });
    }
  }

  function checkOtpBody(req, res) {
    const { txnId, otp } = req.body || {};
    if (typeof txnId !== "string" || !TXN.test(txnId) || typeof otp !== "string" || !OTP.test(otp)) {
      res.status(400).json({ error: "Invalid request." });
      return null;
    }
    return { txnId, otp };
  }

  // ---------- Module 1: registration ----------

  app.post("/api/register/start", ipOtp, startOtp);

  app.post("/api/register/verify", ipVerify, async (req, res) => {
    const body = checkOtpBody(req, res);
    if (!body) return;
    try {
      const r = await uidai.verifyOtp(body.txnId, body.otp);
      if (!r.ok) return res.status(403).json({ error: "Invalid or expired OTP." });
      const created = db.register(idHashOf(r.uidToken));
      res.json({ ok: true, alreadyRegistered: !created, message: "Registered. You can now log in to vote." });
    } catch (e) {
      console.error("Registration failed:", e.message);
      res.status(502).json({ error: "Aadhaar service unavailable." });
    }
  });

  // ---------- Module 2: authentication ----------

  app.post("/api/auth/start", ipOtp, startOtp);

  app.post("/api/auth/verify", ipVerify, async (req, res) => {
    const body = checkOtpBody(req, res);
    if (!body) return;
    try {
      const r = await uidai.verifyOtp(body.txnId, body.otp);
      const idHash = r.ok ? idHashOf(r.uidToken) : null;
      // One message for a bad OTP and for an unregistered person.
      if (!idHash || !db.isRegistered(idHash)) return res.status(403).json({ error: "Invalid OTP, or you are not registered." });
      const session = randomToken();
      const expiresAt = Math.floor(now() / 1000) + config.sessionTtlSeconds;
      db.createSession(sha256(session), idHash, expiresAt);
      res.json({ session, expiresInSeconds: config.sessionTtlSeconds });
    } catch (e) {
      console.error("Login failed:", e.message);
      res.status(502).json({ error: "Aadhaar service unavailable." });
    }
  });

  app.post("/api/auth/logout", requireSession, (req, res) => {
    db.endSession(req.sessionHash);
    res.json({ ok: true });
  });

  // ---------- Module 3: voter verification and single-use token ----------

  app.get("/api/election", async (req, res) => {
    try {
      res.json(await chain.info());
    } catch (e) {
      console.error("Election info failed:", e.message);
      res.status(503).json({ error: "Blockchain unavailable." });
    }
  });

  // The election public key voters encrypt to. Checked against the on-chain hash at startup
  // (see server.js), and voters can re-check it themselves against the contract.
  app.get("/api/election-key", (req, res) => {
    if (!electionKey) return res.status(503).json({ error: "Election key not configured." });
    res.json(electionKey);
  });

  app.post("/api/voting/token", ipToken, requireSession, async (req, res) => {
    let info;
    try {
      info = await chain.info();
    } catch (e) {
      console.error("Chain unavailable:", e.message);
      return res.status(503).json({ error: "Blockchain unavailable." });
    }
    if (info.phase !== "Voting" || info.chainTime < info.startTime || info.chainTime > info.endTime) {
      return res.status(409).json({ error: "Voting is not open." });
    }

    const token = randomToken();
    const result = db.issueToken(req.idHash, tokenHash(token));
    if (result === "not_eligible") return res.status(403).json({ error: "You are not on the electoral roll." });
    if (result === "already_issued") return res.status(409).json({ error: "A voting token was already issued to you." });
    if (result !== "ok") return res.status(403).json({ error: "You are not registered." });

    // The session ends here: from now on the voter is identified only by the token.
    db.endSession(req.sessionHash);
    res.json({
      token,
      message: "Keep this token safe. It is shown once and cannot be re-issued; it is your only way to vote.",
    });
  });

  // ---------- Relay to the blockchain (identity-free: no session needed) ----------

  app.post("/api/voting/cast", ipCast, async (req, res) => {
    const { token, ballot } = req.body || {};
    if (
      typeof token !== "string" || !TOKEN.test(token) ||
      typeof ballot !== "string" || !BALLOT.test(ballot) ||
      ballot.length !== 2 + BALLOT_BYTES * 2 || !ballot.startsWith("0x01")
    ) {
      return res.status(400).json({ error: "Invalid request." });
    }
    const hash = tokenHash(token);
    // Only one request can win this atomic switch, so a token cannot be raced.
    if (!db.useToken(hash)) return res.status(403).json({ error: "This voting token is invalid or already used." });

    try {
      const { txHash } = await chain.castBallot(hash, ballot);
      res.json({ ok: true, txHash });
    } catch (e) {
      if (e.revertName === "TokenAlreadyUsed") return res.status(403).json({ error: "This voting token is invalid or already used." });
      // The contract did not record the ballot: give the voter their token back to retry.
      db.releaseToken(hash);
      const known = {
        WrongPhase: [409, "Voting is not open."],
        OutsideVotingWindow: [409, "Voting is not open."],
        BallotCapReached: [409, "The ballot limit has been reached."],
        InvalidBallot: [400, "Invalid ballot."],
      }[e.revertName];
      if (known) return res.status(known[0]).json({ error: known[1] });
      console.error("Cast failed:", e.revertName || e.shortMessage || e.message);
      res.status(502).json({ error: "Could not record the ballot. Please try again." });
    }
  });

  // A voter can check that the ballot for their token reached the blockchain. The token
  // hash is already public on-chain, so this reveals nothing new.
  app.get("/api/receipt/:tokenHash", rl(60_000, limits.receiptPerMinute ?? 30), async (req, res) => {
    if (!/^0x[0-9a-f]{64}$/.test(req.params.tokenHash)) return res.status(400).json({ error: "Invalid request." });
    try {
      res.json({ recorded: await chain.tokenUsed(req.params.tokenHash) });
    } catch (e) {
      console.error("Receipt check failed:", e.message);
      res.status(503).json({ error: "Blockchain unavailable." });
    }
  });

  // ---------- Public results and the closing step ----------

  // Final results exist only once enough trustees agreed on the same tally.
  app.get("/api/public/results", async (req, res) => {
    try {
      const info = await chain.info();
      if (info.phase !== "Finalized") return res.status(409).json({ error: "Results are not final yet." });
      const results = await chain.results();
      const counted = results.reduce((n, r) => n + r.votes, 0);
      res.json({ results, counted, ballots: info.ballotCount, notCounted: info.ballotCount - counted, eligibleVoters: info.eligibleVoters });
    } catch (e) {
      console.error("Results failed:", e.revertName || e.message);
      res.status(503).json({ error: "Blockchain unavailable." });
    }
  });

  app.get("/api/public/tally-progress", async (req, res) => {
    try {
      res.json(await chain.tallyProgress());
    } catch (e) {
      console.error("Tally progress failed:", e.message);
      res.status(503).json({ error: "Blockchain unavailable." });
    }
  });

  // Closing is open to anyone once the voting window is over (the contract enforces it),
  // so this endpoint grants no power: it only saves people paying gas.
  app.post("/api/election/close", rl(60_000, limits.closePerMinute ?? 5), async (req, res) => {
    try {
      res.json({ ok: true, txHash: await chain.closeElection() });
    } catch (e) {
      const known = {
        VotingNotOver: [409, "The voting period is not over yet."],
        WrongPhase: [409, "The election cannot be closed in its current state."],
      }[e.revertName];
      if (known) return res.status(known[0]).json({ error: known[1] });
      console.error("Close failed:", e.revertName || e.shortMessage || e.message);
      res.status(502).json({ error: "Could not close the election. Please try again." });
    }
  });

  // ---------- Admin ----------

  app.get("/api/admin/stats", requireAdmin, (req, res) => res.json(db.counts()));

  // Local development only (see server.js): forwards wallet requests to the local test chain,
  // whose accounts are unlocked, so the admin page can be exercised without a browser wallet.
  if (devRpcUrl) {
    app.post("/dev/rpc", async (req, res) => {
      const calls = Array.isArray(req.body) ? req.body : [req.body];
      if (!calls.every((c) => typeof c?.method === "string" && c.method.startsWith("eth_"))) {
        return res.status(400).json({ error: "Only eth_* methods are allowed." });
      }
      const upstream = await fetch(devRpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
      res.status(upstream.status).type("json").send(await upstream.text());
    });
  }

  // ---------- Simple mode (demo only: one-click voting, see simple.js) ----------

  if (simpleMode) {
    mountSimpleVoting(app, { config, db, chain, electionKey, limitPerMinute: limits.simplePerMinute ?? 60, ...simpleMode });
  }

  // ---------- Voter web app ----------

  if (staticDir) app.use(express.static(staticDir, { index: "index.html", maxAge: 0 }));

  app.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") return res.status(400).json({ error: "Invalid request." });
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  });

  app.stop = () => clearInterval(sweeper);
  return app;
}

module.exports = { createApp };
