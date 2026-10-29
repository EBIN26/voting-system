// Persistent state: one-time voter codes and commitments waiting to be put on-chain.
//
// Privacy by design: a used code and a pending commitment are stored in two
// separate collections, with no timestamps and no order, so the stored data
// cannot link a person (code) to an anonymous identity (commitment).
const fs = require("node:fs");
const path = require("node:path");

const FILE = process.env.STATE_FILE || path.resolve(__dirname, "..", "data", "state.json");

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { codes: s.codes || {}, pending: s.pending || [], committed: s.committed || [] };
  } catch (e) {
    if (e.code === "ENOENT") return { codes: {}, pending: [], committed: [] };
    throw e;
  }
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, FILE); // atomic replace: a crash never leaves a half-written file
}

module.exports = {
  /** Replace the full set of valid codes (hashes only). */
  setCodes(hashes) {
    state.codes = Object.fromEntries(hashes.map((h) => [h, false]));
    state.pending = [];
    state.committed = [];
    save();
  },

  /**
   * Redeem a code and queue a commitment atomically (Node is single-threaded,
   * so there is no await between the check and the write).
   * Returns "ok" | "invalid_code" | "used_code" | "duplicate_commitment".
   */
  redeem(codeHash, commitment) {
    if (!(codeHash in state.codes)) return "invalid_code";
    if (state.codes[codeHash]) return "used_code";
    if (state.pending.includes(commitment) || state.committed.includes(commitment)) {
      return "duplicate_commitment";
    }
    state.codes[codeHash] = true;
    state.pending.push(commitment);
    save();
    return "ok";
  },

  counts() {
    const total = Object.keys(state.codes).length;
    const used = Object.values(state.codes).filter(Boolean).length;
    return { totalCodes: total, redeemedCodes: used, pending: state.pending.length, committed: state.committed.length };
  },

  pending() {
    return [...state.pending];
  },

  markCommitted(commitments) {
    const done = new Set(commitments);
    state.pending = state.pending.filter((c) => !done.has(c));
    state.committed.push(...commitments);
    save();
  },
};
