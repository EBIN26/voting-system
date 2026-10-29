// Creates MOCK citizens for the fake Aadhaar service and loads the electoral roll.
//   node scripts/seed-mock.js <citizens> <onRoll>
// Example: 6 citizens, the first 5 on the electoral roll (the 6th shows the "not eligible" path).
// All numbers are random test data and belong to no real person.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../backend/config");
const { openDb } = require("../backend/db");
const { createMockUidai } = require("../backend/uidai-mock");
const { voterHash } = require("../backend/crypto-util");

const total = Number(process.argv[2] || 6);
const onRoll = Number(process.argv[3] || total);
if (!Number.isInteger(total) || total < 1 || !Number.isInteger(onRoll) || onRoll < 0 || onRoll > total) {
  console.error("Usage: node scripts/seed-mock.js <citizens> <onRoll>");
  process.exit(1);
}

const config = loadConfig();
if (!config.mockUidaiSecret) throw new Error("Set MOCK_UIDAI_SECRET to use mock data.");

const citizens = [];
const seen = new Set();
while (citizens.length < total) {
  const aadhaar = String(crypto.randomInt(2, 10)) + String(crypto.randomInt(0, 1e11)).padStart(11, "0");
  if (seen.has(aadhaar)) continue;
  seen.add(aadhaar);
  citizens.push({ aadhaar, phone: "9" + String(crypto.randomInt(0, 1e9)).padStart(9, "0") });
}

const file = path.resolve(config.mockUidaiFile);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(citizens, null, 2));

const uidai = createMockUidai({ secret: config.mockUidaiSecret, citizens, deliver: () => {} });
const db = openDb(config.dbFile);
citizens.forEach((c, i) => {
  if (i < onRoll) db.addToRoll(voterHash(config.idPepper, uidai.uidTokenFor(c.aadhaar)));
});
db.close();

console.log(`Mock citizens written to ${config.mockUidaiFile}; ${onRoll} placed on the electoral roll.\n`);
citizens.forEach((c, i) => console.log(`${c.aadhaar}  phone ending ${c.phone.slice(-4)}  ${i < onRoll ? "on roll" : "NOT on roll"}`));
