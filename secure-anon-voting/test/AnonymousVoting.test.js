const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const { generateProof } = require("@semaphore-protocol/proof");
const { deploySemaphore } = require("../scripts/lib/deploySemaphore");

const Phase = { Registration: 0, Voting: 1, Ended: 2 };
const DURATION = 3600;

describe("AnonymousVoting", function () {
  // Real zk proofs: the first run downloads the circuit artifacts.
  this.timeout(600000);

  let admin, registrar, relayer, mallory;
  let voting, semaphore, groupId;
  let ids, group;

  async function proofFor(identity, candidate, g = group, scope = groupId) {
    return generateProof(identity, g, candidate, scope);
  }

  beforeEach(async () => {
    [admin, registrar, relayer, mallory] = await ethers.getSigners();

    semaphore = await deploySemaphore();
    voting = await (await ethers.getContractFactory("AnonymousVoting")).connect(admin).deploy(
      await semaphore.getAddress(),
      registrar.address,
      "Class President",
      ["Ann", "Ben", "Cat"]
    );
    groupId = await voting.groupId();

    // Voters create their identities locally; only the public commitment is shared.
    ids = [new Identity(), new Identity(), new Identity()];
    group = new Group(ids.map((i) => i.commitment));
  });

  const register = () => voting.connect(registrar).registerVoters(ids.map((i) => i.commitment));

  describe("access control and phases", () => {
    it("only the registrar can register voters", async () => {
      await expect(voting.connect(admin).registerVoters([ids[0].commitment])).to.be.revertedWithCustomError(voting, "NotRegistrar");
      await expect(voting.connect(mallory).registerVoters([ids[0].commitment])).to.be.revertedWithCustomError(voting, "NotRegistrar");
    });

    it("only the admin can start voting, and not with zero voters", async () => {
      await expect(voting.connect(admin).startVoting(DURATION)).to.be.revertedWithCustomError(voting, "NoVoters");
      await register();
      await expect(voting.connect(mallory).startVoting(DURATION)).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("closes registration once voting starts", async () => {
      await register();
      await voting.startVoting(DURATION);
      await expect(voting.connect(registrar).registerVoters([new Identity().commitment]))
        .to.be.revertedWithCustomError(voting, "WrongPhase");
    });

    it("cannot be ended early, even by the admin", async () => {
      await register();
      await voting.startVoting(DURATION);
      await expect(voting.connect(admin).endElection()).to.be.revertedWithCustomError(voting, "VotingStillOpen");
    });

    it("hides results until the election has ended", async () => {
      await expect(voting.results()).to.be.revertedWithCustomError(voting, "WrongPhase");
    });
  });

  describe("voting", () => {
    beforeEach(async () => {
      await register();
      await voting.startVoting(DURATION);
    });

    it("counts anonymous votes from registered members and publishes results", async () => {
      // A relayer (not the voters) submits every vote.
      await voting.connect(relayer).vote(0, await proofFor(ids[0], 0));
      await voting.connect(relayer).vote(2, await proofFor(ids[1], 2));
      await voting.connect(relayer).vote(2, await proofFor(ids[2], 2));

      expect(await voting.totalVotes()).to.equal(3);

      await time.increase(DURATION + 1);
      await voting.endElection();
      expect(await voting.phase()).to.equal(Phase.Ended);
      expect((await voting.results()).map(Number)).to.deep.equal([1, 0, 2]);
    });

    it("rejects a second vote from the same member", async () => {
      await voting.connect(relayer).vote(0, await proofFor(ids[0], 0));
      // Same member, different candidate: same nullifier, so it must fail.
      await expect(voting.connect(relayer).vote(1, await proofFor(ids[0], 1)))
        .to.be.revertedWithCustomError(semaphore, "Semaphore__YouAreUsingTheSameNullifierTwice");
    });

    it("rejects a vote from someone who is not registered", async () => {
      const outsider = new Identity();
      const fakeGroup = new Group([...ids.map((i) => i.commitment), outsider.commitment]);
      await expect(voting.connect(relayer).vote(0, await proofFor(outsider, 0, fakeGroup)))
        .to.be.revertedWithCustomError(semaphore, "Semaphore__MerkleTreeRootIsNotPartOfTheGroup");
    });

    it("rejects a proof whose candidate was altered in transit", async () => {
      const proof = await proofFor(ids[0], 0);
      await expect(voting.connect(relayer).vote(1, proof)).to.be.revertedWithCustomError(voting, "InvalidCandidate");
    });

    it("rejects a tampered proof", async () => {
      const proof = await proofFor(ids[0], 0);
      const bad = { ...proof, points: [...proof.points] };
      bad.points[0] = BigInt(bad.points[0]) + 1n;
      await expect(voting.connect(relayer).vote(0, bad)).to.be.reverted;
    });

    it("rejects a proof made for a different scope", async () => {
      await expect(voting.connect(relayer).vote(0, await proofFor(ids[0], 0, group, 12345)))
        .to.be.revertedWithCustomError(voting, "InvalidScope");
    });

    it("rejects an out-of-range candidate", async () => {
      await expect(voting.connect(relayer).vote(3, await proofFor(ids[0], 3)))
        .to.be.revertedWithCustomError(voting, "InvalidCandidate");
    });

    it("rejects votes after the deadline", async () => {
      const proof = await proofFor(ids[0], 0);
      await time.increase(DURATION + 1);
      await expect(voting.connect(relayer).vote(0, proof)).to.be.revertedWithCustomError(voting, "VotingClosed");
    });
  });
});
