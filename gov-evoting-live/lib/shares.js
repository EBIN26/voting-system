// Splitting the election private key among trustees (Shamir secret sharing),
// and protecting each share with its trustee's own passphrase.
//
// Any `threshold` shares reconstruct the key; fewer reveal nothing about it.
const crypto = require("node:crypto");
const { keyHash, publicKeyFromPrivate } = require("./keys");

const MIN_PASSPHRASE = 12;
const DEFAULT_SCRYPT_N = 2 ** 17;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function shamir() {
  return import("shamir-secret-sharing"); // ESM-only package
}

async function splitKey(pkcs8Der, total, threshold) {
  if (!Number.isInteger(total) || !Number.isInteger(threshold) || threshold < 2 || threshold > total || total > 20) {
    throw new Error("Need 2 <= threshold <= total <= 20.");
  }
  const { split } = await shamir();
  return split(pkcs8Der, total, threshold);
}

async function combineShares(shares) {
  const { combine } = await shamir();
  return combine(shares);
}

function aadFor(meta) {
  // Binds the public details to the encrypted share, so they cannot be swapped.
  return Buffer.from(JSON.stringify([meta.version, meta.keyHash, meta.threshold, meta.total, meta.trustee]));
}

/** Encrypts one share under a passphrase. `meta` = { keyHash, threshold, total, trustee }. */
function protectShare(share, passphrase, meta, { scryptN = DEFAULT_SCRYPT_N } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  const full = { version: 1, kind: "gov-evoting-key-share", ...meta };
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: scryptN, r: 8, p: 1, maxmem: 512 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(full));
  const ciphertext = Buffer.concat([cipher.update(share), cipher.final()]);
  return {
    ...full,
    kdf: { name: "scrypt", N: scryptN, r: 8, p: 1, salt: b64(salt) },
    cipher: { name: "aes-256-gcm", iv: b64(iv), tag: b64(cipher.getAuthTag()) },
    ciphertext: b64(ciphertext),
  };
}

/** Throws if the passphrase is wrong or the file was altered. */
function unprotectShare(file, passphrase) {
  if (file?.kind !== "gov-evoting-key-share" || file.version !== 1) throw new Error("Not a key share file.");
  const { N, r, p } = file.kdf;
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20) throw new Error("Unsupported key share file.");
  try {
    const key = crypto.scryptSync(passphrase, unb64(file.kdf.salt), 32, { N, r, p, maxmem: 1024 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64(file.cipher.iv));
    decipher.setAAD(aadFor(file));
    decipher.setAuthTag(unb64(file.cipher.tag));
    return new Uint8Array(Buffer.concat([decipher.update(unb64(file.ciphertext)), decipher.final()]));
  } catch {
    throw new Error("Wrong passphrase, or the share file was altered.");
  }
}

/**
 * Reconstructs the private key from share files + passphrases and PROVES it is the
 * right key by checking it against the key hash that is on the blockchain.
 * (Combining too few or mismatched shares silently produces garbage, so this check
 * is essential.)
 * @param {Array<{file: object, passphrase: string}>} entries
 * @param {string} expectedKeyHash the on-chain `electionKeyHash`
 */
async function reconstructKey(entries, expectedKeyHash) {
  if (entries.length < 2) throw new Error("At least 2 shares are needed.");
  const hashes = new Set(entries.map((e) => e.file.keyHash));
  if (hashes.size !== 1 || !hashes.has(expectedKeyHash)) throw new Error("These shares belong to a different election key.");
  const trustees = new Set(entries.map((e) => e.file.trustee));
  if (trustees.size !== entries.length) throw new Error("The same trustee's share was supplied twice.");
  const threshold = entries[0].file.threshold;
  if (entries.length < threshold) throw new Error(`Need ${threshold} shares, got ${entries.length}.`);

  const shares = entries.map((e) => unprotectShare(e.file, e.passphrase));
  let key;
  try {
    key = await combineShares(shares);
    if (keyHash(publicKeyFromPrivate(key)) !== expectedKeyHash) throw new Error("mismatch");
  } catch {
    throw new Error("The shares did not reconstruct the election key.");
  }
  return key;
}

module.exports = { splitKey, combineShares, protectShare, unprotectShare, reconstructKey, MIN_PASSPHRASE };
