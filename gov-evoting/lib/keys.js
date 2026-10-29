// Election key generation (Node only; the voter's browser never needs these).
const crypto = require("node:crypto");
const { ethers } = require("ethers");

const MODULUS_BITS = 3072;

/** A fresh RSA-OAEP key pair, as DER bytes. The private key exists only in memory. */
async function generateElectionKey() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: MODULUS_BITS, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  return {
    publicKey: new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey)),
    privateKey: new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  };
}

/** The value stored on-chain as `electionKeyHash`: keccak256 of the public key's DER bytes. */
const keyHash = (spkiDer) => ethers.keccak256(spkiDer);

/** Recomputes the public key from a private key, to check a reconstructed key is genuine. */
function publicKeyFromPrivate(pkcs8Der) {
  const priv = crypto.createPrivateKey({ key: Buffer.from(pkcs8Der), format: "der", type: "pkcs8" });
  return new Uint8Array(crypto.createPublicKey(priv).export({ format: "der", type: "spki" }));
}

const toPem = (der, label) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;

function fromPem(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(b64, "base64"));
}

module.exports = { generateElectionKey, keyHash, publicKeyFromPrivate, toPem, fromPem, MODULUS_BITS };
