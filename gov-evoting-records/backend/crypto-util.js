const crypto = require("node:crypto");
const { ethers } = require("ethers");

const hmac = (secret, value) => crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

/**
 * The voter hash: the only form in which a voter is ever stored.
 *
 *   voterHash = Keccak-256( HMAC-SHA-256( secret, "voter:" + identityReference ) )
 *
 * The HMAC step mixes in the server's secret, so IDs cannot be guessed and checked
 * offline (a 12-digit ID has only ~10^11 possibilities, which a plain hash would not survive).
 * The Keccak-256 step makes the final unique voter hash a Keccak-256 value, the same
 * hash the blockchain uses for token hashes. Hashing the output of a secure keyed hash
 * cannot weaken it. Returns a 0x-prefixed 64-hex-digit string.
 */
const voterHash = (secret, identityReference) => ethers.keccak256("0x" + hmac(secret, "voter:" + identityReference));

/** Constant-time string comparison that does not leak length. */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 32 random bytes as 0x-prefixed hex. */
const randomToken = () => "0x" + crypto.randomBytes(32).toString("hex");

/** keccak256 of the token bytes: this is what the contract stores as `tokenHash`. */
const tokenHash = (token) => ethers.keccak256(token);

const sixDigitOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

module.exports = { hmac, sha256, voterHash, safeEqual, randomToken, tokenHash, sixDigitOtp };
