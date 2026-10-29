const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { encryptBallot, decryptBallot, electionId, fromHex, toHex } = require("../lib/ballot");
const { generateElectionKey, keyHash, publicKeyFromPrivate, toPem, fromPem } = require("../lib/keys");
const { splitKey, combineShares, protectShare, unprotectShare, reconstructKey } = require("../lib/shares");
const { runCeremony, tallyBallots, tallyHashOf } = require("../lib/ceremony");

const ID = electionId(31337, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
const FAST = 2 ** 10; // low scrypt cost: tests only
const PASS = ["correct horse battery", "staple wrong answer!", "third trustee phrase"];

describe("ballot encryption", () => {
  let key;
  test("setup", async () => { key = await generateElectionKey(); });

  test("round-trips every candidate", async () => {
    for (const c of [0, 1, 2, 7, 49]) {
      assert.equal(await decryptBallot(key.privateKey, await encryptBallot(key.publicKey, c, ID), ID, 50), c);
    }
  });

  test("every ballot has the same length, and equal votes look different", async () => {
    const a = await encryptBallot(key.publicKey, 1, ID);
    const b = await encryptBallot(key.publicKey, 1, ID);
    const c = await encryptBallot(key.publicKey, 2, ID);
    assert.equal(a.length, b.length);
    assert.equal(a.length, c.length);
    assert.notEqual(a, b);
    assert.ok(fromHex(a).length <= 1024, "must fit the contract's 1024-byte limit");
  });

  test("a ballot cannot be moved into another election", async () => {
    const ballot = await encryptBallot(key.publicKey, 1, ID);
    await assert.rejects(decryptBallot(key.privateKey, ballot, electionId(31337, "0x" + "11".repeat(20)), 3));
    await assert.rejects(decryptBallot(key.privateKey, ballot, electionId(1, "0x5FbDB2315678afecb367f032d93F642f64180aa3"), 3));
  });

  test("tampering with any byte is detected", async () => {
    const bytes = fromHex(await encryptBallot(key.publicKey, 1, ID));
    for (const pos of [0, 5, 200, bytes.length - 20, bytes.length - 1]) {
      const copy = bytes.slice();
      copy[pos] ^= 1;
      await assert.rejects(decryptBallot(key.privateKey, toHex(copy), ID, 3), `byte ${pos}`);
    }
  });

  test("the wrong key, truncated data and garbage are rejected", async () => {
    const other = await generateElectionKey();
    const ballot = await encryptBallot(key.publicKey, 1, ID);
    await assert.rejects(decryptBallot(other.privateKey, ballot, ID, 3));
    await assert.rejects(decryptBallot(key.privateKey, ballot.slice(0, 100), ID, 3));
    await assert.rejects(decryptBallot(key.privateKey, "0x", ID, 3));
    await assert.rejects(decryptBallot(key.privateKey, "not hex", ID, 3));
  });

  test("an out-of-range candidate is rejected on decrypt and on encrypt", async () => {
    const ballot = await encryptBallot(key.publicKey, 5, ID);
    await assert.rejects(decryptBallot(key.privateKey, ballot, ID, 3));
    await assert.rejects(encryptBallot(key.publicKey, -1, ID));
    await assert.rejects(encryptBallot(key.publicKey, 50, ID));
    await assert.rejects(encryptBallot(key.publicKey, 1.5, ID));
  });
});

describe("keys and PEM", () => {
  test("the public key can be recomputed from the private key, and PEM round-trips", async () => {
    const { publicKey, privateKey } = await generateElectionKey();
    assert.deepEqual(publicKeyFromPrivate(privateKey), publicKey);
    assert.deepEqual(fromPem(toPem(publicKey, "PUBLIC KEY")), publicKey);
    assert.match(keyHash(publicKey), /^0x[0-9a-f]{64}$/);
  });
});

describe("key splitting", () => {
  test("any threshold-sized subset reconstructs the key; fewer do not", async () => {
    const { privateKey } = await generateElectionKey();
    const shares = await splitKey(privateKey, 5, 3);
    for (const subset of [[0, 1, 2], [4, 2, 0], [1, 3, 4]]) {
      assert.deepEqual(await combineShares(subset.map((i) => shares[i])), privateKey);
    }
    assert.notDeepEqual(await combineShares([shares[0], shares[1]]), privateKey); // 2 of 3 needed: garbage
  });

  test("rejects invalid parameters", async () => {
    const k = new Uint8Array(100);
    await assert.rejects(splitKey(k, 3, 1));
    await assert.rejects(splitKey(k, 3, 4));
    await assert.rejects(splitKey(k, 21, 3));
  });

  test("a protected share needs its own passphrase and detects tampering", () => {
    const share = new Uint8Array([1, 2, 3, 4, 5]);
    const meta = { keyHash: "0x" + "ab".repeat(32), threshold: 2, total: 3, trustee: 1 };
    const file = protectShare(share, PASS[0], meta, { scryptN: FAST });
    assert.deepEqual(unprotectShare(file, PASS[0]), share);
    assert.throws(() => unprotectShare(file, PASS[1]), /Wrong passphrase/);
    assert.throws(() => unprotectShare({ ...file, threshold: 3 }, PASS[0]), /Wrong passphrase|altered/); // metadata is authenticated
    assert.throws(() => unprotectShare({ ...file, trustee: 2 }, PASS[0]), /altered|Wrong/);
    const bad = Buffer.from(file.ciphertext, "base64");
    bad[0] ^= 1;
    assert.throws(() => unprotectShare({ ...file, ciphertext: bad.toString("base64") }, PASS[0]), /altered|Wrong/);
  });

  test("short passphrases are refused", () => {
    assert.throws(() => protectShare(new Uint8Array(3), "short", { keyHash: "0x", threshold: 2, total: 3, trustee: 1 }, { scryptN: FAST }), /at least/);
  });
});

describe("full ceremony and tally", () => {
  test("generates a key, splits it, and trustees decrypt and count the ballots together", async () => {
    const c = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: FAST });
    assert.equal(c.shareFiles.length, 3);
    // Nothing secret appears in what leaves the ceremony.
    assert.ok(!JSON.stringify(c.shareFiles).includes("PRIVATE"));

    const votes = [0, 1, 1, 2, 2, 2, 0];
    const ballots = [];
    for (const v of votes) ballots.push(await encryptBallot(c.publicKey, v, ID));
    ballots.push("0x" + "00".repeat(430)); // garbage a faulty submitter might relay

    // Trustees 1 and 3 come together.
    const key = await reconstructKey(
      [{ file: c.shareFiles[0], passphrase: PASS[0] }, { file: c.shareFiles[2], passphrase: PASS[2] }],
      c.keyHash
    );
    const result = await tallyBallots({ privateKey: key, ballots, id: ID, candidateCount: 3 });
    assert.deepEqual(result.tally, [2, 2, 3]);
    assert.equal(result.invalid, 1);
    assert.equal(result.tallyHash, tallyHashOf([2, 2, 3]));
  });

  test("one share is not enough, and a repeated share does not help", async () => {
    const c = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: FAST });
    const e = (i) => ({ file: c.shareFiles[i], passphrase: PASS[i] });
    await assert.rejects(reconstructKey([e(0)], c.keyHash), /At least 2/);
    await assert.rejects(reconstructKey([e(0), e(0)], c.keyHash), /twice/);
  });

  test("shares from a different ceremony are refused", async () => {
    const a = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: FAST });
    const b = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: FAST });
    await assert.rejects(
      reconstructKey([{ file: a.shareFiles[0], passphrase: PASS[0] }, { file: b.shareFiles[1], passphrase: PASS[1] }], a.keyHash),
      /different election key/
    );
  });

  test("a higher threshold is enforced from the share files", async () => {
    const c = await runCeremony({ passphrases: [...PASS, "fourth trustee phrase"], threshold: 3, scryptN: FAST });
    const e = (i, p) => ({ file: c.shareFiles[i], passphrase: p });
    await assert.rejects(reconstructKey([e(0, PASS[0]), e(1, PASS[1])], c.keyHash), /Need 3/);
    const key = await reconstructKey([e(0, PASS[0]), e(1, PASS[1]), e(2, PASS[2])], c.keyHash);
    assert.equal(key.length > 1000, true);
  });

  test("duplicate trustee passphrases are refused", async () => {
    await assert.rejects(runCeremony({ passphrases: [PASS[0], PASS[0], PASS[1]], threshold: 2, scryptN: FAST }), /different passphrase/);
  });

  test("ballots for another election count as invalid, not as votes", async () => {
    const c = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: FAST });
    const other = electionId(31337, "0x" + "22".repeat(20));
    const ballots = [await encryptBallot(c.publicKey, 0, ID), await encryptBallot(c.publicKey, 0, other)];
    const key = await reconstructKey(
      [{ file: c.shareFiles[0], passphrase: PASS[0] }, { file: c.shareFiles[1], passphrase: PASS[1] }], c.keyHash);
    const r = await tallyBallots({ privateKey: key, ballots, id: ID, candidateCount: 3 });
    assert.deepEqual(r.tally, [1, 0, 0]);
    assert.equal(r.invalid, 1);
  });
});
