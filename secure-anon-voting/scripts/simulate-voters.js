// Dev/test helper that plays the role of voters against a running server.
//   node scripts/simulate-voters.js register <code> [<code> ...]
//   node scripts/simulate-voters.js vote <candidateIndex> [<candidateIndex> ...]
// Identities are kept in data/sim-identities.json (test use only).
const fs = require("node:fs");
const path = require("node:path");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const { generateProof } = require("@semaphore-protocol/proof");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const FILE = path.resolve(__dirname, "..", "data", "sim-identities.json");

async function api(p, body) {
  const res = await fetch(BASE + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const saved = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];

  if (cmd === "register") {
    for (const code of args) {
      const id = new Identity();
      const r = await api("/api/register", { code, commitment: id.commitment.toString() });
      console.log(code, "->", r.status, r.data.error || "ok");
      if (r.status === 200) saved.push({ identity: id.export(), voted: false });
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(saved));
  } else if (cmd === "vote") {
    const election = (await api("/api/election")).data;
    const members = (await api("/api/group")).data.members;
    const group = new Group(members.map(BigInt));
    const depth = Math.max(1, group.depth);
    const { wasm, zkey } = await (async () => {
      const { maybeGetSnarkArtifacts, Project } = await import("@zk-kit/artifacts");
      return maybeGetSnarkArtifacts(Project.SEMAPHORE, { parameters: [depth], version: "4.13.0" });
    })();
    const todo = saved.filter((s) => !s.voted);
    for (let i = 0; i < args.length && i < todo.length; i++) {
      const candidate = Number(args[i]);
      const id = Identity.import(todo[i].identity);
      const proof = await generateProof(id, group, candidate, election.groupId, depth, { wasm, zkey });
      const r = await api("/api/vote", {
        candidate,
        proof: {
          merkleTreeDepth: String(proof.merkleTreeDepth), merkleTreeRoot: String(proof.merkleTreeRoot),
          nullifier: String(proof.nullifier), message: String(proof.message), scope: String(proof.scope),
          points: proof.points.map(String),
        },
      });
      console.log(`voter ${i} candidate ${candidate} ->`, r.status, r.data.error || "ok");
      if (r.status === 200) todo[i].voted = true;
      // second attempt by the same identity must be rejected
      if (r.status === 200 && process.env.TRY_DOUBLE) {
        const again = await api("/api/vote", { candidate, proof: { merkleTreeDepth: String(proof.merkleTreeDepth), merkleTreeRoot: String(proof.merkleTreeRoot), nullifier: String(proof.nullifier), message: String(proof.message), scope: String(proof.scope), points: proof.points.map(String) } });
        console.log("  double vote ->", again.status, again.data.error);
      }
    }
    fs.writeFileSync(FILE, JSON.stringify(saved));
  } else {
    console.log("Usage: register <codes...> | vote <candidates...>");
  }
}

// snarkjs leaves worker threads open, so exit explicitly once finished.
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
