// A trustee submits the tally from their OWN wallet. The result becomes final once
// enough trustees submit identical counts.
//
//   TRUSTEE_PRIVATE_KEY=0x... node scripts/submit-tally.js --tally tally.json
//   node scripts/submit-tally.js --tally tally.json --local-trustee 2   (local demo: uses a public test key)
//   node scripts/submit-tally.js --live --trustee 1                      (Sepolia: uses live/wallets.json)
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { connect, PHASES } = require("./lib/election");
const { parseArgs } = require("./lib/cli");
const live = require("./lib/live");

const MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (live.wantsLive()) live.applyLiveEnv();
  const tally = JSON.parse(fs.readFileSync(path.resolve(args.tally || "tally.json"), "utf8"));

  let key = process.env.TRUSTEE_PRIVATE_KEY;
  if (args["local-trustee"]) {
    // Local Hardhat node only; accounts #2-#4 are the demo trustees.
    key = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${Number(args["local-trustee"])}`).privateKey;
  }
  if (args.trustee) {
    const n = Number(args.trustee);
    const t = live.wallets()?.trustees?.[n - 1];
    if (!t) throw new Error("Trustee must be 1, 2 or 3, and live/wallets.json must exist.");
    key = t.privateKey;
  }
  if (!key) throw new Error("Set TRUSTEE_PRIVATE_KEY (or use --trustee N with --live, or --local-trustee on the local demo chain).");

  const { contract } = await connect(key);
  if (tally.contract.toLowerCase() !== process.env.CONTRACT_ADDRESS.toLowerCase()) throw new Error("This tally is for a different contract.");

  await (await contract.submitTally(tally.tally)).wait();
  console.log("Tally submitted. Election phase now:", PHASES[Number(await contract.phase())]);
  if (PHASES[Number(await contract.phase())] === "Finalized") {
    console.log("Final results:", (await contract.results()).map(Number));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
