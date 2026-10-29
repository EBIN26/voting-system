// Key ceremony: creates the election key and splits it among the trustees.
//
//   node scripts/ceremony.js --trustees 3 --threshold 2 [--out ceremony]
//
// Run this ONCE, BEFORE deploying the contract, on a dedicated offline computer with
// all trustees present. Each trustee types their own passphrase privately. Then give
// each trustee only their own share file, publish the public key and key hash, and
// delete the rest. Add --demo-passphrases for a local demo (insecure fixed passphrases).
const fs = require("node:fs");
const path = require("node:path");
const { runCeremony } = require("../lib/ceremony");
const { toPem } = require("../lib/keys");
const { MIN_PASSPHRASE } = require("../lib/shares");
const { parseArgs, askHidden, demoPassphrase } = require("./lib/cli");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const total = Number(args.trustees || 3);
  const threshold = Number(args.threshold || 2);
  const out = path.resolve(args.out || "ceremony");

  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    throw new Error(`${out} is not empty. Refusing to overwrite an existing ceremony.`);
  }

  const passphrases = [];
  for (let i = 1; i <= total; i++) {
    if (args["demo-passphrases"]) {
      passphrases.push(demoPassphrase(i));
      continue;
    }
    console.log(`\nTrustee ${i}: type your passphrase (at least ${MIN_PASSPHRASE} characters). Nobody else should see the screen.`);
    const a = await askHidden("  passphrase: ");
    const b = await askHidden("  again:      ");
    if (a !== b) throw new Error("The two entries did not match.");
    passphrases.push(a);
  }

  console.log("\nGenerating a 3072-bit key and splitting it...");
  const ceremony = await runCeremony({ passphrases, threshold });

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "election-public-key.pem"), toPem(ceremony.publicKey, "PUBLIC KEY"));
  fs.writeFileSync(path.join(out, "key-hash.txt"), ceremony.keyHash + "\n");
  ceremony.shareFiles.forEach((f, i) =>
    fs.writeFileSync(path.join(out, `trustee-${i + 1}.share.json`), JSON.stringify(f, null, 2), { mode: 0o600 })
  );

  console.log(`\nDone. Files in ${out}:`);
  console.log("  election-public-key.pem   publish this");
  console.log("  key-hash.txt              goes into the contract at deployment:", ceremony.keyHash);
  console.log(`  trustee-1..${total}.share.json   give each trustee ONLY their own file, then delete the others from this computer`);
  console.log(`\nAny ${threshold} of the ${total} trustees can decrypt after the election closes. Fewer cannot.`);
  if (args["demo-passphrases"]) console.log("\nWARNING: demo passphrases are public. This ceremony protects nothing.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
