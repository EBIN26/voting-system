// The whole trust chain on a real (local) chain: ceremony -> contract -> encrypted
// ballots -> close -> trustees decrypt -> trustees submit -> results final -> anyone verifies.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { runCeremony, tallyBallots } = require("../lib/ceremony");
const { encryptBallot, electionId } = require("../lib/ballot");
const { reconstructKey } = require("../lib/shares");
const { keyHash, publicKeyFromPrivate } = require("../lib/keys");

describe("key ceremony with the contract", function () {
  this.timeout(120000);
  const PASS = ["first trustee passphrase", "second trustee passphrase", "third trustee passphrase"];

  it("ballots encrypted to the election key are counted correctly and finalised by the trustees", async () => {
    const [admin, submitter, t1, t2, t3] = await ethers.getSigners();
    const ceremony = await runCeremony({ passphrases: PASS, threshold: 2, scryptN: 2 ** 10 });

    const F = await ethers.getContractFactory("GovElection");
    const election = await F.connect(admin).deploy(
      submitter.address, "Test", ["Ann", "Ben", "Cat"], [t1.address, t2.address, t3.address], 2, ceremony.keyHash
    );
    expect(await election.electionKeyHash()).to.equal(ceremony.keyHash);

    const now = await time.latest();
    await election.openElection(10, now + 10, now + 1000);
    await time.increaseTo(now + 11);

    const { chainId } = await ethers.provider.getNetwork();
    const id = electionId(chainId, await election.getAddress());
    const votes = [0, 2, 2, 1, 2];
    for (const [i, v] of votes.entries()) {
      const ballot = await encryptBallot(ceremony.publicKey, v, id);
      await election.connect(submitter).castBallot(ethers.id("token" + i), ballot); // real ballots fit the 1024-byte limit
    }

    // Trustees cannot decrypt "early" through the contract: results are not final yet.
    await expect(election.results()).to.be.revertedWithCustomError(election, "WrongPhase");

    await time.increaseTo(now + 1001);
    await election.closeElection();

    // Trustees 1 and 3 reconstruct the key together and count.
    const key = await reconstructKey(
      [{ file: ceremony.shareFiles[0], passphrase: PASS[0] }, { file: ceremony.shareFiles[2], passphrase: PASS[2] }],
      await election.electionKeyHash()
    );
    const ballots = [];
    for (let i = 0; i < Number(await election.ballotCount()); i++) ballots.push(ethers.hexlify(await election.getBallot(i)));
    const result = await tallyBallots({ privateKey: key, ballots, id, candidateCount: 3 });
    expect(result.tally).to.deep.equal([1, 1, 3]);
    expect(result.invalid).to.equal(0);

    // Two trustees submit identical tallies: the contract finalises.
    await election.connect(t1).submitTally(result.tally);
    expect(await election.phase()).to.equal(2);
    await election.connect(t3).submitTally(result.tally);
    expect((await election.results()).map(Number)).to.deep.equal([1, 1, 3]);

    // Anyone given the published key reproduces the same count from the public chain data.
    expect(keyHash(publicKeyFromPrivate(key))).to.equal(await election.electionKeyHash());
    const again = await tallyBallots({ privateKey: key, ballots, id, candidateCount: 3 });
    expect(again.tallyHash).to.equal(result.tallyHash);
  });

  it("a ballot copied into another election is not counted there", async () => {
    const [admin, submitter, t1, t2] = await ethers.getSigners();
    const ceremony = await runCeremony({ passphrases: PASS.slice(0, 2), threshold: 2, scryptN: 2 ** 10 });
    const F = await ethers.getContractFactory("GovElection");
    const a = await F.connect(admin).deploy(submitter.address, "A", ["X", "Y"], [t1.address, t2.address], 2, ceremony.keyHash);
    const b = await F.connect(admin).deploy(submitter.address, "B", ["X", "Y"], [t1.address, t2.address], 2, ceremony.keyHash);
    const { chainId } = await ethers.provider.getNetwork();
    const idA = electionId(chainId, await a.getAddress());
    const idB = electionId(chainId, await b.getAddress());
    const ballot = await encryptBallot(ceremony.publicKey, 0, idA);

    const key = await reconstructKey(
      [{ file: ceremony.shareFiles[0], passphrase: PASS[0] }, { file: ceremony.shareFiles[1], passphrase: PASS[1] }],
      ceremony.keyHash
    );
    expect((await tallyBallots({ privateKey: key, ballots: [ballot], id: idA, candidateCount: 2 })).tally).to.deep.equal([1, 0]);
    const replay = await tallyBallots({ privateKey: key, ballots: [ballot], id: idB, candidateCount: 2 });
    expect(replay.tally).to.deep.equal([0, 0]);
    expect(replay.invalid).to.equal(1);
  });
});
