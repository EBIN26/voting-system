const crypto = require("node:crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid typos

/** 16 random characters (80 bits), shown as XXXX-XXXX-XXXX-XXXX. */
function generateCode() {
  let raw = "";
  for (let i = 0; i < 16; i++) raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return raw.match(/.{4}/g).join("-");
}

function normalise(code) {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Only this keyed hash is stored, so a stolen state file cannot be used to vote. */
function hashCode(code, pepper) {
  return crypto.createHmac("sha256", pepper).update(normalise(code)).digest("hex");
}

module.exports = { generateCode, hashCode, normalise };
