// Anyone can check the official results once the trustees have published the election
// private key: this re-decrypts every ballot on the chain and compares with the
// results the contract finalised.
//
//   node scripts/verify-tally.js --key published-election-private-key.pem
const fs = require("node:fs");
const path = require("node:path");
const { fromPem, keyHash, publicKeyFromPrivate } = require("../lib/keys");
const { tallyBallots } = require("../lib/ceremony");
const { connect, readBallots, PHASES } = require("./lib/election");
const { parseArgs } = require("./lib/cli");
const live = require("./lib/live");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (live.wantsLive()) live.applyLiveEnv();
  const privateKey = fromPem(fs.readFileSync(path.resolve(args.key || "published-election-private-key.pem"), "utf8"));

  const { contract, id } = await connect();
  if (keyHash(publicKeyFromPrivate(privateKey)) !== (await contract.electionKeyHash())) {
    throw new Error("This private key does not belong to this election.");
  }
  const phase = PHASES[Number(await contract.phase())];
  if (phase !== "Finalized") throw new Error(`The election is ${phase}; there are no official results to check yet.`);

  const candidates = [...(await contract.candidates())];
  const mine = await tallyBallots({ privateKey, ballots: await readBallots(contract), id, candidateCount: candidates.length });
  const official = (await contract.results()).map(Number);

  candidates.forEach((name, i) => console.log(`  ${name}: yours ${mine.tally[i]}, official ${official[i]}`));
  console.log(`  invalid ballots: ${mine.invalid}`);
  const same = mine.tally.every((n, i) => n === official[i]);
  console.log(same ? "\nVERIFIED: your count matches the official results." : "\nMISMATCH: your count differs from the official results!");
  process.exit(same ? 0 : 2);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
