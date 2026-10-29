const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ethers } = require("ethers");
const { voterHash, hmac } = require("../backend/crypto-util");

const SECRET = "s".repeat(40);
const REF = "a".repeat(64); // stands in for UIDAI's identity reference

describe("voter hash = Keccak-256( HMAC-SHA-256( secret, 'voter:' + reference ) )", () => {
  test("has the shape of a Keccak-256 value: 0x plus 64 hex digits", () => {
    assert.match(voterHash(SECRET, REF), /^0x[0-9a-f]{64}$/);
  });

  test("is exactly Keccak-256 applied to an HMAC-SHA-256, computed independently", () => {
    const mac = crypto.createHmac("sha256", SECRET).update("voter:" + REF).digest();
    assert.equal(voterHash(SECRET, REF), ethers.keccak256(mac));
  });

  test("uses Ethereum's Keccak-256, not NIST SHA3-256 (they differ by padding)", () => {
    const mac = crypto.createHmac("sha256", SECRET).update("voter:" + REF).digest();
    const nist = "0x" + crypto.createHash("sha3-256").update(mac).digest("hex");
    assert.notEqual(voterHash(SECRET, REF), nist);
    // the standard Keccak-256 test vector for empty input
    assert.equal(ethers.keccak256("0x"), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  test("is deterministic, and changes with the secret or the identity", () => {
    assert.equal(voterHash(SECRET, REF), voterHash(SECRET, REF));
    assert.notEqual(voterHash(SECRET, REF), voterHash("t".repeat(40), REF));
    assert.notEqual(voterHash(SECRET, REF), voterHash(SECRET, REF + "b"));
  });

  test("cannot be recomputed from the identity alone (the secret is what protects it)", () => {
    const guesses = [
      ethers.keccak256(ethers.toUtf8Bytes(REF)),
      ethers.keccak256(ethers.toUtf8Bytes("voter:" + REF)),
      "0x" + crypto.createHash("sha256").update(REF).digest("hex"),
      "0x" + hmac("", "voter:" + REF),
    ];
    for (const g of guesses) assert.notEqual(g, voterHash(SECRET, REF));
  });

  test("is not the same value as the on-chain token hash of the same bytes (separate domains)", () => {
    // A voter hash and a token hash must never be interchangeable.
    const token = "0x" + "11".repeat(32);
    assert.notEqual(voterHash(SECRET, token), ethers.keccak256(token));
  });
});
