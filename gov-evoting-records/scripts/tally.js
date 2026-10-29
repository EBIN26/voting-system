// Decrypts and counts the ballots. Run by the trustees TOGETHER, after the election has closed.
//
//   node scripts/tally.js --shares ceremony/trustee-1.share.json,ceremony/trustee-3.share.json
//        [--out tally.json] [--publish-key published-election-private-key.pem] [--demo-passphrases]
//
// Each trustee types their own passphrase. Run on an offline computer if you can.
// The tool refuses to run until the contract says the election is closed.
const fs = require("node:fs");
const path = require("node:path");
const { reconstructKey } = require("../lib/shares");
const { tallyBallots } = require("../lib/ceremony");
const { toPem } = require("../lib/keys");
const { connect, readBallots, PHASES } = require("./lib/election");
const { parseArgs, askHidden, demoPassphrase } = require("./lib/cli");
const live = require("./lib/live");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (live.wantsLive()) live.applyLiveEnv();
  if (!args.shares || args.shares === true) throw new Error("Give the share files: --shares a.json,b.json");

  const { contract, id } = await connect();
  const phase = PHASES[Number(await contract.phase())];
  if (phase !== "Closed" && phase !== "Finalized") {
    throw new Error(`The election is ${phase}. Ballots may only be decrypted after it has closed.`);
  }

  const entries = [];
  for (const file of String(args.shares).split(",")) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    const who = `trustee ${parsed.trustee}`;
    const passphrase = args["demo-passphrases"]
      ? demoPassphrase(parsed.trustee)
      : await askHidden(`Passphrase for ${who}: `);
    entries.push({ file: parsed, passphrase });
  }

  const key = await reconstructKey(entries, await contract.electionKeyHash());
  const candidates = [...(await contract.candidates())];
  const ballots = await readBallots(contract);
  const result = await tallyBallots({ privateKey: key, ballots, id, candidateCount: candidates.length });

  console.log(`\nElection "${await contract.title()}": ${result.ballots} ballots on-chain, ${result.invalid} invalid.`);
  candidates.forEach((name, i) => console.log(`  ${name}: ${result.tally[i]}`));

  const out = path.resolve(args.out || "tally.json");
  fs.writeFileSync(out, JSON.stringify({ contract: process.env.CONTRACT_ADDRESS, ...result }, null, 2));
  console.log(`\nTally written to ${out} (hash ${result.tallyHash}).`);
  console.log("Each trustee now submits it from their own wallet: node scripts/submit-tally.js");

  if (args["publish-key"]) {
    // Releasing the key after the election lets ANYONE re-count the ballots and check this tally.
    // It is safe: ballots hold only a candidate number, never who cast them.
    fs.writeFileSync(path.resolve(args["publish-key"]), toPem(key, "PRIVATE KEY"), { mode: 0o600 });
    console.log(`Election private key written to ${args["publish-key"]}. Publish it so anyone can verify (scripts/verify-tally.js).`);
  }
  key.fill(0);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
