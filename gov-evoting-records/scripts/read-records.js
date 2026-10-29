// The ADMIN opens the sealed vote records, after the election has ended.
//
//   node scripts/read-records.js [--key records-admin/admin-private-key.json] [--storage data/cloud-storage]
//        [--file downloaded-from-oracle.json] [--csv records.csv] [--demo-passphrase]
//
// It refuses to run until the contract says the election is Closed or Finalized, then checks that the
// number of records matches the ballots on the blockchain, and (once finalized) that the per-candidate
// counts match the official results.
const fs = require("node:fs");
const path = require("node:path");
const { openRecord, unprotectAdminKey, recordsId, DEMO_ADMIN_PASSPHRASE } = require("../lib/records");
const { connect, PHASES } = require("./lib/election");
const { createStorage } = require("../backend/storage");
const { objectName } = require("../backend/records-export");
const { parseArgs, askHidden } = require("./lib/cli");
const live = require("./lib/live");

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (live.wantsLive()) live.applyLiveEnv();

  const { contract, id } = await connect();
  const phase = PHASES[Number(await contract.phase())];
  if (phase !== "Closed" && phase !== "Finalized") {
    throw new Error(`The election is ${phase}. The vote records can be opened only after it has ended.`);
  }

  const keyFile = path.resolve(typeof args.key === "string" ? args.key : "records-admin/admin-private-key.json");
  const passphrase = args["demo-passphrase"] ? DEMO_ADMIN_PASSPHRASE : await askHidden("Admin passphrase: ");
  const adminKey = unprotectAdminKey(JSON.parse(fs.readFileSync(keyFile, "utf8")), passphrase);

  const name = objectName(process.env.CONTRACT_ADDRESS);
  let text;
  if (typeof args.file === "string") {
    // The file downloaded from the Oracle bucket (console login required), or any copy of it.
    text = fs.readFileSync(path.resolve(args.file), "utf8");
  } else {
    const storage = createStorage({ type: "local", dir: typeof args.storage === "string" ? args.storage : "data/cloud-storage" });
    if (!(await storage.exists(name))) {
      throw new Error(`The records file (${name}) is not in storage yet. It appears within seconds of the election closing, if the server is running. For the Oracle bucket, download it from the console and use --file <path>.`);
    }
    text = await storage.get(name);
  }
  const bundle = JSON.parse(text);
  if (bundle.kind !== "gov-evoting-vote-records" || bundle.election !== recordsId(id)) throw new Error("This records file belongs to a different election.");

  const rows = [];
  for (const sealed of bundle.records) rows.push(await openRecord(adminKey, sealed, recordsId(id)));
  adminKey.fill(0);

  console.log(`\nElection "${bundle.title}" (${bundle.contract})\n`);
  console.log("Voter ID        Candidate  Symbol   Block   Voted at");
  for (const r of rows) {
    console.log(`${r.voterId.padEnd(15)} ${String(r.candidate).padEnd(10)} ${String(r.symbol).padEnd(8)} ${String(r.blockNumber).padEnd(7)} ${r.votedAt}`);
  }

  // Integrity checks against the blockchain.
  const onChain = Number(await contract.ballotCount());
  console.log(`\n${rows.length} records; ${onChain} ballots on the blockchain: ${rows.length === onChain ? "match." : "DO NOT MATCH."}`);
  if (phase === "Finalized") {
    const names = [...(await contract.candidates())];
    const official = [...(await contract.results())].map(Number);
    const mine = names.map((n, i) => rows.filter((r) => r.candidateNumber === i).length);
    names.forEach((n, i) => console.log(`  ${n}: records ${mine[i]}, official ${official[i]}${mine[i] === official[i] ? "" : "  <-- MISMATCH"}`));
  }

  if (args.csv) {
    const header = "voter_id,candidate,symbol,block,tx_hash,voted_at";
    const lines = rows.map((r) => [r.voterId, r.candidate, r.symbol, r.blockNumber, r.txHash, r.votedAt].map(csvCell).join(","));
    fs.writeFileSync(path.resolve(args.csv), [header, ...lines].join("\n") + "\n");
    console.log(`\nWritten to ${args.csv}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
