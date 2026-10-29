// Ballot encryption. Uses only the Web Crypto API, so the SAME code runs in Node
// (tally tooling) and in the voter's browser (encrypting before anything is sent).
//
// Hybrid scheme:
//   plaintext  = candidate index (1 byte) + 16 random bytes   (always 17 bytes)
//   AES-256-GCM encrypts the plaintext with a fresh random key and IV; the
//   election id is bound in as additional authenticated data, so a ballot cannot
//   be replayed into a different election.
//   RSA-OAEP (SHA-256) wraps the AES key with the election public key.
//
// Wire format (every ballot has identical length for a given key size, so the
// size reveals nothing):   version(1) | wrappedKey | iv(12) | ciphertext(17) | tag(16)
const VERSION = 1;
const IV_BYTES = 12;
const PLAINTEXT_BYTES = 17;
const TAG_BYTES = 16;
const MAX_CANDIDATES = 50;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

function toHex(bytes) {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  if (typeof hex !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Not a hex string.");
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

/** Identifies one election, e.g. electionId(31337, "0xAbc...") */
const electionId = (chainId, contractAddress) => `gov-evoting:v1:${chainId}:${String(contractAddress).toLowerCase()}`;

const rsaParams = { name: "RSA-OAEP", hash: "SHA-256" };

async function importPublicKey(spkiDer) {
  return subtle.importKey("spki", spkiDer, rsaParams, false, ["encrypt"]);
}
async function importPrivateKey(pkcs8Der) {
  return subtle.importKey("pkcs8", pkcs8Der, rsaParams, false, ["decrypt"]);
}

/**
 * @param {Uint8Array} spkiDer  election public key (DER, SubjectPublicKeyInfo)
 * @param {number} candidate    candidate index
 * @param {string} id           election id (see electionId)
 * @returns {Promise<string>}   0x-prefixed hex ballot
 */
async function encryptBallot(spkiDer, candidate, id) {
  if (!Number.isInteger(candidate) || candidate < 0 || candidate >= MAX_CANDIDATES) throw new Error("Invalid candidate.");
  const plaintext = new Uint8Array(PLAINTEXT_BYTES);
  plaintext[0] = candidate;
  globalThis.crypto.getRandomValues(plaintext.subarray(1)); // random padding: equal votes never look equal

  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id), tagLength: TAG_BYTES * 8 }, aesKey, plaintext)
  );
  const rawKey = await subtle.exportKey("raw", aesKey);
  const wrapped = new Uint8Array(await subtle.encrypt(rsaParams, await importPublicKey(spkiDer), rawKey));

  const out = new Uint8Array(1 + wrapped.length + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(wrapped, 1);
  out.set(iv, 1 + wrapped.length);
  out.set(sealed, 1 + wrapped.length + IV_BYTES);
  return toHex(out);
}

/**
 * Decrypts one ballot. Throws on ANY problem (wrong key, tampering, wrong
 * election, malformed). Returns the candidate index.
 */
async function decryptBallot(pkcs8Der, ballotHex, id, candidateCount) {
  const bytes = fromHex(ballotHex);
  const wrappedLen = bytes.length - 1 - IV_BYTES - PLAINTEXT_BYTES - TAG_BYTES;
  if (bytes[0] !== VERSION || wrappedLen < 128) throw new Error("Malformed ballot.");

  const wrapped = bytes.subarray(1, 1 + wrappedLen);
  const iv = bytes.subarray(1 + wrappedLen, 1 + wrappedLen + IV_BYTES);
  const sealed = bytes.subarray(1 + wrappedLen + IV_BYTES);

  const rawKey = await subtle.decrypt(rsaParams, await importPrivateKey(pkcs8Der), wrapped);
  const aesKey = await subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id), tagLength: TAG_BYTES * 8 }, aesKey, sealed)
  );
  if (plaintext.length !== PLAINTEXT_BYTES) throw new Error("Malformed ballot.");
  const candidate = plaintext[0];
  if (candidate >= candidateCount) throw new Error("Candidate out of range.");
  return candidate;
}

module.exports = { encryptBallot, decryptBallot, electionId, toHex, fromHex, MAX_CANDIDATES, PLAINTEXT_BYTES };
