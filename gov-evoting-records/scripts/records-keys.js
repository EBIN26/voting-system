// Creates the ADMIN'S key pair for the sealed vote records.   node scripts/records-keys.js [--demo-passphrase]
//
//   records/admin-public-key.pem        goes to the server (it can only LOCK records with it)
//   records-admin/admin-private-key.json  stays with the admin ONLY, protected by their passphrase
//
// The admin's private key must never be copied to the server or the cloud. If it is lost, the sealed
// records can never be opened. Refuses to overwrite an existing key.
const fs = require("node:fs");
const path = require("node:path");
const { generateElectionKey, toPem } = require("../lib/keys");
const { protectAdminKey, DEMO_ADMIN_PASSPHRASE } = require("../lib/records");
const { parseArgs, askHidden } = require("./lib/cli");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const pubFile = path.join(root, "records", "admin-public-key.pem");
  const privFile = path.join(root, "records-admin", "admin-private-key.json");
  if (fs.existsSync(pubFile) || fs.existsSync(privFile)) {
    throw new Error("An admin records key already exists. Refusing to overwrite it (delete the records and records-admin folders only if no election used it).");
  }

  let passphrase;
  if (args["demo-passphrase"]) {
    passphrase = DEMO_ADMIN_PASSPHRASE;
    console.warn("WARNING: the demo passphrase is public. This protects nothing.");
  } else {
    passphrase = await askHidden("Choose the admin passphrase (at least 12 characters): ");
    if (passphrase !== (await askHidden("Type it again: "))) throw new Error("The two passphrases differ.");
  }

  console.log("Generating a 3072-bit admin key...");
  const key = await generateElectionKey();
  const protectedKey = protectAdminKey(key.privateKey, passphrase);
  key.privateKey.fill(0);

  fs.mkdirSync(path.dirname(pubFile), { recursive: true });
  fs.mkdirSync(path.dirname(privFile), { recursive: true });
  fs.writeFileSync(pubFile, toPem(key.publicKey, "PUBLIC KEY"));
  fs.writeFileSync(privFile, JSON.stringify(protectedKey, null, 2), { mode: 0o600 });

  console.log(`\nDone.\n  ${path.relative(root, pubFile)}   give this to the server\n  ${path.relative(root, privFile)}   keep this ONLY with the admin; never put it on the server or in the cloud`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
