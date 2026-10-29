// SQLite storage using Node's built-in driver.
//
// Privacy rules baked into the schema:
//  - Voters are stored only as a keyed hash (`id_hash`). No Aadhaar number, name,
//    phone number or biometric is ever stored.
//  - `tokens` has NO column that references a voter, and no timestamps, so the
//    database cannot link a voting token (and therefore a ballot) to a person.
//    `voters.token_issued` is just a flag with no time or token reference.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS roll (
      id_hash TEXT PRIMARY KEY            -- eligible per the electoral roll
    );
    CREATE TABLE IF NOT EXISTS voters (
      id_hash TEXT PRIMARY KEY,           -- registered voter
      token_issued INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_hash TEXT PRIMARY KEY,
      id_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL         -- unix seconds
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('issued', 'used'))
    );
  `);

  const q = {
    inRoll: db.prepare("SELECT 1 FROM roll WHERE id_hash = ?"),
    addRoll: db.prepare("INSERT OR IGNORE INTO roll (id_hash) VALUES (?)"),
    getVoter: db.prepare("SELECT token_issued FROM voters WHERE id_hash = ?"),
    addVoter: db.prepare("INSERT OR IGNORE INTO voters (id_hash) VALUES (?)"),
    addSession: db.prepare("INSERT INTO sessions (session_hash, id_hash, expires_at) VALUES (?, ?, ?)"),
    getSession: db.prepare("SELECT id_hash, expires_at FROM sessions WHERE session_hash = ?"),
    delSession: db.prepare("DELETE FROM sessions WHERE session_hash = ?"),
    delExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    flagIssued: db.prepare("UPDATE voters SET token_issued = 1 WHERE id_hash = ? AND token_issued = 0"),
    addToken: db.prepare("INSERT INTO tokens (token_hash, state) VALUES (?, 'issued')"),
    useToken: db.prepare("UPDATE tokens SET state = 'used' WHERE token_hash = ? AND state = 'issued'"),
    releaseToken: db.prepare("UPDATE tokens SET state = 'issued' WHERE token_hash = ? AND state = 'used'"),
    counts: db.prepare(`SELECT
      (SELECT COUNT(*) FROM roll) AS rollSize,
      (SELECT COUNT(*) FROM voters) AS registered,
      (SELECT COUNT(*) FROM voters WHERE token_issued = 1) AS tokensIssued,
      (SELECT COUNT(*) FROM tokens WHERE state = 'used') AS tokensUsed`),
  };

  return {
    raw: db,
    close: () => db.close(),
    addToRoll: (idHash) => q.addRoll.run(idHash),
    isOnRoll: (idHash) => !!q.inRoll.get(idHash),
    isRegistered: (idHash) => !!q.getVoter.get(idHash),
    /** Returns true if newly registered, false if already registered. */
    register: (idHash) => q.addVoter.run(idHash).changes === 1,

    createSession: (sessionHash, idHash, expiresAt) => q.addSession.run(sessionHash, idHash, expiresAt),
    /** Returns the voter id for a live session, else null. */
    getSession(sessionHash, now) {
      const row = q.getSession.get(sessionHash);
      if (!row) return null;
      if (row.expires_at <= now) {
        q.delSession.run(sessionHash);
        return null;
      }
      return row.id_hash;
    },
    endSession: (sessionHash) => q.delSession.run(sessionHash),
    purgeSessions: (now) => q.delExpired.run(now),

    /**
     * Atomically: verify the voter is registered, on the roll and has no token,
     * then flag them and store the new token's hash. Returns a reason string on
     * failure, or "ok". The token is NOT stored against the voter.
     */
    issueToken(idHash, hash) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!q.getVoter.get(idHash)) { db.exec("ROLLBACK"); return "not_registered"; }
        if (!q.inRoll.get(idHash)) { db.exec("ROLLBACK"); return "not_eligible"; }
        if (q.flagIssued.run(idHash).changes !== 1) { db.exec("ROLLBACK"); return "already_issued"; }
        q.addToken.run(hash);
        db.exec("COMMIT");
        return "ok";
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
    },
    /**
     * Undoes issueToken() when the ballot never reached the blockchain, so the
     * voter can try again. Used only by simple mode, which knows both values.
     */
    revokeIssue(idHash, hash) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(hash);
        db.prepare("UPDATE voters SET token_issued = 0 WHERE id_hash = ?").run(idHash);
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
    },
    /** Marks a token used. True only for the single caller that wins the race. */
    useToken: (hash) => q.useToken.run(hash).changes === 1,
    releaseToken: (hash) => q.releaseToken.run(hash),
    counts: () => ({ ...q.counts.get() }),
  };
}

module.exports = { openDb };
