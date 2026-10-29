// SIMPLE MODE (demo only): one button press runs the whole backend pipeline.
//
//   1. Check the request and that voting is open
//   2. Verify the voter: Keccak-256 voter hash (over an HMAC-SHA-256), electoral roll
//   3. Issue a single-use voting token (stored with no link to the voter)
//   4. Encrypt the ballot to the election public key (RSA-OAEP + AES-256-GCM)
//   5. Record the encrypted ballot on the blockchain
//
// Each step is timed and reported back so the page can show what happened.
// Unlike the full system, the server sees the voter and their choice together in
// this one request, and it skips registration and OTP login. Never enable it for a
// real election (config.js refuses it in production).
const { performance } = require("node:perf_hooks");
const rateLimit = require("express-rate-limit");
const { voterHash, randomToken, tokenHash } = require("./crypto-util");
const { encryptBallot } = require("../lib/ballot");
const { fromPem } = require("../lib/keys");

const VOTER_ID = /^[2-9]\d{11}$/;
const short = (h) => h.slice(0, 10) + "…" + h.slice(-6);

class StepError extends Error {
  /** @param {boolean} undo whether the issued token may be withdrawn so the voter can retry */
  constructor(status, message, undo = true) {
    super(message);
    this.status = status;
    this.undo = undo;
  }
}

/**
 * @param {import("express").Express} app
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.db
 * @param {object} deps.chain
 * @param {object} deps.electionKey  { publicKeyPem, electionId }
 * @param {(voterId: string) => string} deps.referenceFor  identity reference for a dummy voter ID
 * @param {() => Array<{voterId: string, onRoll: boolean}>} deps.listVoters
 */
function mountSimpleVoting(app, { config, db, chain, electionKey, referenceFor, listVoters, limitPerMinute = 60 }) {
  const publicKey = electionKey ? fromPem(electionKey.publicKeyPem) : null;
  const idHashOf = (voterId) => voterHash(config.idPepper, referenceFor(voterId));

  // Dummy voter IDs so the page can offer a list (fake data only).
  app.get("/api/simple/voters", (req, res) => res.json({ voters: listVoters() }));

  app.post(
    "/api/simple/vote",
    rateLimit({ windowMs: 60_000, limit: limitPerMinute, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } }),
    async (req, res) => {
      const steps = [];
      /** Runs one step. `fn` returns { detail, value }; the detail is shown on the page. */
      const step = async (name, fn) => {
        const t = performance.now();
        try {
          const { detail, value } = await fn();
          steps.push({ name, ok: true, ms: Math.round(performance.now() - t), detail });
          return value;
        } catch (e) {
          steps.push({ name, ok: false, ms: Math.round(performance.now() - t), detail: e instanceof StepError ? e.message : "Unexpected error." });
          throw e;
        }
      };

      let idHash = null;
      let hash = null;
      try {
        const { voterId, candidate } = req.body || {};

        // 1. Request and election state
        await step("Check the request", async () => {
          if (typeof voterId !== "string" || !VOTER_ID.test(voterId)) throw new StepError(400, "Enter a valid 12-digit voter ID.");
          if (!publicKey) throw new StepError(503, "The election key is not configured.");
          let info;
          try {
            info = await chain.info();
          } catch {
            throw new StepError(503, "The blockchain is not reachable.");
          }
          if (!Number.isInteger(candidate) || candidate < 0 || candidate >= info.candidates.length) throw new StepError(400, "Unknown candidate.");
          if (info.phase !== "Voting" || info.chainTime < info.startTime || info.chainTime > info.endTime) {
            throw new StepError(409, "Voting is not open.");
          }
          return { detail: `Voter ID ••••••••${voterId.slice(-4)} chose "${info.candidates[candidate]}". Voting is open.` };
        });

        // 2. Voter verification
        await step("Verify the voter", async () => {
          const h = idHashOf(voterId);
          if (!db.isOnRoll(h)) throw new StepError(403, `Voter hash ${short(h)} is not on the electoral roll.`);
          db.register(h); // simple mode skips the separate registration step
          return { detail: `Voter hash ${short(h)} (Keccak-256) is on the electoral roll.`, value: h };
        }).then((h) => (idHash = h));

        // 3. Single-use token. issueToken refuses a voter who already has one, which is
        // what stops double voting.
        await step("Issue a one-time voting token", async () => {
          const h = tokenHash(randomToken());
          const r = db.issueToken(idHash, h);
          if (r === "already_issued") throw new StepError(409, "This voter has already voted.");
          if (r !== "ok") throw new StepError(403, "This voter cannot vote.");
          hash = h;
          return { detail: `Token hash ${short(h)} stored with no link to the voter. The voter is marked as voted.` };
        });

        // 4. Encryption
        const ballot = await step("Encrypt the ballot", async () => {
          const b = await encryptBallot(publicKey, candidate, electionKey.electionId);
          return {
            detail: `${(b.length - 2) / 2}-byte ciphertext ${b.slice(0, 18)}… (RSA-OAEP-3072 + AES-256-GCM). Only the trustees together can decrypt it.`,
            value: b,
          };
        });

        // 5. Blockchain
        const receipt = await step("Record on the blockchain", async () => {
          if (!db.useToken(hash)) throw new StepError(409, "The token was already used.");
          try {
            const r = await chain.castBallot(hash, ballot);
            return { detail: `Transaction ${short(r.txHash)} in block ${r.blockNumber}, gas used ${r.gasUsed.toLocaleString("en-IN")}.`, value: r };
          } catch (e) {
            db.releaseToken(hash);
            // A contract rejection (found by the pre-check) means nothing was recorded: safe to retry.
            if (e.revertName === "BallotCapReached") throw new StepError(409, "The ballot limit has been reached.");
            if (e.revertName === "OutsideVotingWindow" || e.revertName === "WrongPhase") throw new StepError(409, "Voting is not open.");
            // Anything else (a timeout, a dropped connection) might have been recorded after all,
            // so the voter stays marked as voted rather than risk a second ballot.
            console.error("Simple vote failed:", e.revertName || e.shortMessage || e.message);
            throw new StepError(502, "The blockchain did not confirm the ballot. Check the ballot count before trying again.", false);
          }
        });

        const after = await chain.info().catch(() => null);
        res.json({
          ok: true,
          steps,
          receipt: { confirmationCode: hash, txHash: receipt.txHash, blockNumber: receipt.blockNumber },
          ballotCount: after?.ballotCount ?? null,
          eligibleVoters: after?.eligibleVoters ?? null,
        });
      } catch (e) {
        // A token was issued but the ballot certainly never reached the chain: withdraw it.
        const undo = e instanceof StepError ? e.undo : true;
        if (hash && undo) {
          try { db.revokeIssue(idHash, hash); } catch (err) { console.error("Could not withdraw token:", err.message); }
        }
        if (!(e instanceof StepError)) console.error("Simple vote error:", e.message);
        res.status(e instanceof StepError ? e.status : 500).json({ ok: false, error: steps.at(-1)?.detail || "Unexpected error.", steps });
      }
    }
  );
}

module.exports = { mountSimpleVoting };
