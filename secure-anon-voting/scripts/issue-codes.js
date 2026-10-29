// Generates one-time voter codes. Usage: node scripts/issue-codes.js <count> [--force]
//
// The codes are printed ONCE. Hand each to one verified voter through a channel
// you trust (in person, a letter, ...). Only keyed hashes are stored.
const config = require("../backend/config");
const store = require("../backend/store");
const { generateCode, hashCode } = require("../backend/codes");

const count = Number(process.argv[2]);
const force = process.argv.includes("--force");

if (!Number.isInteger(count) || count < 1 || count > 100000) {
  console.error("Usage: node scripts/issue-codes.js <count> [--force]");
  process.exit(1);
}
if (store.counts().totalCodes > 0 && !force) {
  console.error("Codes already exist. Re-issuing invalidates them all. Use --force to replace.");
  process.exit(1);
}

const codes = new Set();
while (codes.size < count) codes.add(generateCode());
store.setCodes([...codes].map((c) => hashCode(c, config.codePepper)));

console.log(`Issued ${count} one-time codes (shown only now):\n`);
for (const c of codes) console.log(c);
