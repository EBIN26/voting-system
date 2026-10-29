// High-level key ceremony and tally logic, used by the command-line scripts and the tests.
const { ethers } = require("ethers");
const { generateElectionKey, keyHash } = require("./keys");
const { splitKey, protectShare } = require("./shares");
const { decryptBallot } = require("./ballot");

/**
 * Generates the election key, splits it, and returns ONLY what may leave this
 * function: the public key, its hash, and one passphrase-protected file per trustee.
 * The private key and the raw shares are wiped from memory before returning.
 *
 * @param {object} opts
 * @param {string[]} opts.passphrases  one per trustee, in order
 * @param {number} opts.threshold      shares needed to reconstruct (>= 2)
 */
async function runCeremony({ passphrases, threshold, scryptN }) {
  const total = passphrases.length;
  if (new Set(passphrases).size !== total) throw new Error("Each trustee needs a different passphrase.");

  const { publicKey, privateKey } = await generateElectionKey();
  const hash = keyHash(publicKey);
  const shares = await splitKey(privateKey, total, threshold);
  const shareFiles = shares.map((share, i) =>
    protectShare(share, passphrases[i], { keyHash: hash, threshold, total, trustee: i + 1 }, { scryptN })
  );

  // Best-effort wipe: JavaScript cannot guarantee this, which is one reason the
  // ceremony should run on a dedicated offline machine.
  privateKey.fill(0);
  shares.forEach((s) => s.fill(0));

  return { publicKey, keyHash: hash, shareFiles };
}

/** keccak256(abi.encode(uint256[])): the same value the contract uses to compare tallies. */
const tallyHashOf = (counts) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [counts]));

/**
 * Decrypts every ballot and counts. Ballots that cannot be decrypted (garbage,
 * wrong election, tampered, impossible candidate) are counted as invalid, never
 * as a vote for anyone.
 */
async function tallyBallots({ privateKey, ballots, id, candidateCount }) {
  const counts = new Array(candidateCount).fill(0);
  let invalid = 0;
  for (const ballot of ballots) {
    try {
      counts[await decryptBallot(privateKey, ballot, id, candidateCount)]++;
    } catch {
      invalid++;
    }
  }
  return { tally: counts, invalid, ballots: ballots.length, tallyHash: tallyHashOf(counts) };
}

module.exports = { runCeremony, tallyBallots, tallyHashOf };
