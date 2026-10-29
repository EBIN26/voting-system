// Vote records: "voter -> candidate + symbol", readable ONLY by the admin, and only after the election.
//
// This is a deliberate trade-off requested for this version: unlike the ballots on the blockchain
// (which carry no voter identity), these records DO link a voter to a choice. To limit the harm:
//   * Each record is sealed with the ADMIN'S PUBLIC KEY the moment it is created, so the server
//     only ever holds locked records and nobody (not even the server's operator) can read them.
//   * The sealed records are copied to cloud storage only after the contract says the election
//     is closed (see backend/records-export.js).
//   * The admin's private key lives in a passphrase-protected file that never goes to the server.
//
// Same hybrid scheme as the ballots: AES-256-GCM seals the record, RSA-OAEP-3072 wraps the AES key.
// Uses only the Web Crypto API, so it runs in Node.
const crypto = require("node:crypto");

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_PASSPHRASE = 12;
const DEFAULT_SCRYPT_N = 2 ** 17;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const rsaParams = { name: "RSA-OAEP", hash: "SHA-256" };

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** Binds a record to one election, so it cannot be moved into another election's file. */
const recordsId = (electionId) => `gov-evoting-records:v1:${electionId}`;

/**
 * Seals one record for the admin. Returns a base64 string.
 * @param {Uint8Array} adminSpkiDer admin public key (DER)
 * @param {object} record           plain JSON data
 * @param {string} id               see recordsId
 */
async function sealRecord(adminSpkiDer, record, id) {
  const plaintext = enc.encode(JSON.stringify(record));
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id), tagLength: TAG_BYTES * 8 }, aesKey, plaintext)
  );
  const rawKey = await subtle.exportKey("raw", aesKey);
  const pub = await subtle.importKey("spki", adminSpkiDer, rsaParams, false, ["encrypt"]);
  const wrapped = new Uint8Array(await subtle.encrypt(rsaParams, pub, rawKey));

  const out = new Uint8Array(1 + 2 + wrapped.length + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out[1] = (wrapped.length >> 8) & 0xff;
  out[2] = wrapped.length & 0xff;
  out.set(wrapped, 3);
  out.set(iv, 3 + wrapped.length);
  out.set(sealed, 3 + wrapped.length + IV_BYTES);
  return b64(out);
}

/** Opens one record. Throws on ANY problem (wrong key, tampering, wrong election). */
async function openRecord(adminPkcs8Der, sealedB64, id) {
  const bytes = unb64(sealedB64);
  if (bytes[0] !== VERSION || bytes.length < 3 + 128 + IV_BYTES + TAG_BYTES) throw new Error("Malformed record.");
  const wrappedLen = (bytes[1] << 8) | bytes[2];
  const wrapped = bytes.subarray(3, 3 + wrappedLen);
  const iv = bytes.subarray(3 + wrappedLen, 3 + wrappedLen + IV_BYTES);
  const sealed = bytes.subarray(3 + wrappedLen + IV_BYTES);
  if (sealed.length < TAG_BYTES) throw new Error("Malformed record.");

  const priv = await subtle.importKey("pkcs8", adminPkcs8Der, rsaParams, false, ["decrypt"]);
  const rawKey = await subtle.decrypt(rsaParams, priv, wrapped);
  const aesKey = await subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id), tagLength: TAG_BYTES * 8 }, aesKey, sealed);
  return JSON.parse(dec.decode(plaintext));
}

/**
 * Protects the admin's private key (DER) with a passphrase, for storing in a file.
 * scrypt derives the key; AES-256-GCM seals it, with the file's public details bound in.
 */
function protectAdminKey(pkcs8Der, passphrase, { scryptN = DEFAULT_SCRYPT_N } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: scryptN, r: 8, p: 1, maxmem: 512 * 1024 * 1024 });
  const aad = Buffer.from("gov-evoting-admin-records-key:v1");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(pkcs8Der), cipher.final()]);
  return {
    version: 1,
    kind: "gov-evoting-admin-records-key",
    kdf: { name: "scrypt", N: scryptN, r: 8, p: 1, salt: b64(salt) },
    cipher: { name: "aes-256-gcm", iv: b64(iv), tag: b64(cipher.getAuthTag()) },
    ciphertext: b64(ciphertext),
  };
}

/** Throws if the passphrase is wrong or the file was altered. */
function unprotectAdminKey(file, passphrase) {
  if (file?.kind !== "gov-evoting-admin-records-key" || file.version !== 1) throw new Error("Not an admin records key file.");
  const { N, r, p } = file.kdf;
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20) throw new Error("Unsupported key file.");
  try {
    const key = crypto.scryptSync(passphrase, unb64(file.kdf.salt), 32, { N, r, p, maxmem: 1024 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64(file.cipher.iv));
    decipher.setAAD(Buffer.from("gov-evoting-admin-records-key:v1"));
    decipher.setAuthTag(unb64(file.cipher.tag));
    return new Uint8Array(Buffer.concat([decipher.update(unb64(file.ciphertext)), decipher.final()]));
  } catch {
    throw new Error("Wrong passphrase, or the key file was altered.");
  }
}

/** Fixed passphrase for local demos only. Anyone can guess it, so never use it for real. */
const DEMO_ADMIN_PASSPHRASE = "demo passphrase for the admin";

module.exports = { sealRecord, openRecord, protectAdminKey, unprotectAdminKey, recordsId, DEMO_ADMIN_PASSPHRASE, MIN_PASSPHRASE };
