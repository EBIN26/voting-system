// Checks that your Oracle write link works, BEFORE the election.
//
//   STORAGE_PAR_URL="https://objectstorage...../o/..." node scripts/test-oracle-upload.js
//
// It uploads a tiny test file. Look for it in the bucket in the Oracle console. If your link is for
// one exact object, the test file is written under that name and the real records file will simply
// replace it when the election ends.
require("dotenv").config({ quiet: true });
const { createStorage } = require("../backend/storage");

async function main() {
  const parUrl = process.env.STORAGE_PAR_URL;
  if (!parUrl) throw new Error("Set STORAGE_PAR_URL first (the write link from your Oracle bucket).");
  const storage = createStorage({ type: "oracle", parUrl });
  const name = storage.fixedObject || "upload-test.json";
  await storage.put(name, JSON.stringify({ kind: "gov-evoting-upload-test", at: new Date().toISOString(), note: "If you can see this in the bucket, the link works." }, null, 2));
  console.log(`Uploaded "${name}". Open the bucket in the Oracle console and check that it is there.`);
  console.log("The server could not read it back with this link: that is intended.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
