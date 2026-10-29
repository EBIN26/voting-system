// A trustee submits the tally from their OWN wallet. The result becomes final once
// enough trustees submit identical counts.
//
//   TRUSTEE_PRIVATE_KEY=0x... node scripts/submit-tally.js --tally tally.json
//   node scripts/submit-tally.js --tally tally.json --local-trustee 2   (local demo: uses a public test key)
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { connect, PHASES } = require("./lib/election");
const { parseArgs } = require("./lib/cli");

const MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tally = JSON.parse(fs.readFileSync(path.resolve(args.tally || "tally.json"), "utf8"));

  let key = process.env.TRUSTEE_PRIVATE_KEY;
  if (args["local-trustee"]) {
    // Local Hardhat node only; accounts #2-#4 are the demo trustees.
    key = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${Number(args["local-trustee"])}`).privateKey;
  }
  if (!key) throw new Error("Set TRUSTEE_PRIVATE_KEY (or use --local-trustee on the local demo chain).");

  const { contract } = await connect(key);
  if (tally.contract.toLowerCase() !== process.env.CONTRACT_ADDRESS.toLowerCase()) throw new Error("This tally is for a different contract.");

  await (await contract.submitTally(tally.tally)).wait();
  console.log("Tally submitted. Election phase now:", PHASES[Number(await contract.phase())]);
  if (PHASES[Number(await contract.phase())] === "Finalized") {
    console.log("Final results:", (await contract.results()).map(Number));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
