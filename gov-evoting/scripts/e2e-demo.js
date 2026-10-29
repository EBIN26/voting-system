// End-to-end walk-through against a RUNNING local setup (node + server). Development only:
// it reads OTPs from the mock SMS lines in data/server.log.
//   node scripts/e2e-demo.js
const fs = require("node:fs");
const path = require("node:path");
const { encryptBallot } = require("../lib/ballot");
const { fromPem } = require("../lib/keys");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const LOG = path.resolve(__dirname, "..", "data", "server.log");
const citizens = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "data", "mock-uidai.json"), "utf8"));

async function api(p, body, token) {
  const res = await fetch(BASE + p, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const lastOtp = () => {
  const lines = fs.readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes("[mock SMS"));
  return lines.at(-1).match(/OTP is (\d{6})/)[1];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function otp(kind, aadhaar) {
  const start = await api(`/api/${kind}/start`, { aadhaar });
  await sleep(200);
  return api(`/api/${kind}/verify`, { txnId: start.data.txnId, otp: lastOtp() });
}

async function main() {
  const tokens = [];
  for (const [i, c] of citizens.entries()) {
    const reg = await otp("register", c.aadhaar);
    const login = await otp("auth", c.aadhaar);
    const tok = await api("/api/voting/token", {}, login.data.session);
    console.log(`citizen ${i}: register ${reg.status}, login ${login.status}, token ${tok.status}${tok.data.error ? " (" + tok.data.error + ")" : ""}`);
    if (tok.status === 200) tokens.push(tok.data.token);
  }

  // A quiet local chain's clock lags until a block is mined; refresh it before casting.
  await fetch("http://127.0.0.1:8545", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }),
  });

  // Voters fetch the election key and encrypt on their own device; the server never sees a plain vote.
  const key = (await api("/api/election-key")).data;
  const choices = [0, 2, 2, 1];
  for (const [i, token] of tokens.entries()) {
    const ballot = await encryptBallot(fromPem(key.publicKeyPem), choices[i], key.electionId);
    const r = await api("/api/voting/cast", { token, ballot });
    console.log(`voter ${i}: cast ${r.status}${r.data.error ? " (" + r.data.error + ")" : ""}`);
    if (i === 0) {
      const again = await api("/api/voting/cast", { token, ballot });
      console.log(`voter 0 reusing the token: ${again.status} (${again.data.error})`);
    }
  }

  const info = await api("/api/election");
  console.log("on-chain:", { phase: info.data.phase, eligible: info.data.eligibleVoters, ballots: info.data.ballotCount });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
