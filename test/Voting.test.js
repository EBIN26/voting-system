const { expect } = require("chai");
const { ethers } = require("hardhat");

const Phase = { Registration: 0, Commit: 1, Reveal: 2, Ended: 3 };

describe("Voting", () => {
  let voting, admin, alice, bob, carol, mallory;
  const salt = (n) => ethers.id("salt-" + n);

  beforeEach(async () => {
    [admin, alice, bob, carol, mallory] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Voting");
    voting = await F.deploy("Class President", ["Ann", "Ben", "Cat"]);
    await voting.registerVoters([alice.address, bob.address, carol.address]);
  });

  const commit = async (signer, cand, s) => {
    const c = await voting.computeCommitment(cand, s, signer.address);
    return voting.connect(signer).commitVote(c);
  };

  it("only admin can register voters or change phase", async () => {
    await expect(voting.connect(mallory).registerVoters([mallory.address])).to.be.revertedWithCustomError(voting, "NotAdmin");
    await expect(voting.connect(mallory).startCommit()).to.be.revertedWithCustomError(voting, "NotAdmin");
  });

  it("rejects duplicate registration", async () => {
    await expect(voting.registerVoters([alice.address])).to.be.revertedWithCustomError(voting, "AlreadyRegistered");
  });

  it("blocks unregistered voters and double commits", async () => {
    await voting.startCommit();
    await expect(commit(mallory, 0, salt(9))).to.be.revertedWithCustomError(voting, "NotRegistered");
    await commit(alice, 0, salt(1));
    await expect(commit(alice, 1, salt(1))).to.be.revertedWithCustomError(voting, "AlreadyCommitted");
  });

  it("enforces phase order", async () => {
    await expect(commit(alice, 0, salt(1))).to.be.revertedWithCustomError(voting, "WrongPhase");
    await voting.startCommit();
    await expect(voting.connect(alice).revealVote(0, salt(1))).to.be.revertedWithCustomError(voting, "WrongPhase");
    await expect(voting.results()).to.be.revertedWithCustomError(voting, "WrongPhase");
  });

  it("rejects a reveal that does not match the commitment", async () => {
    await voting.startCommit();
    await commit(alice, 0, salt(1));
    await voting.startReveal();
    await expect(voting.connect(alice).revealVote(1, salt(1))).to.be.revertedWithCustomError(voting, "InvalidReveal");
    await expect(voting.connect(alice).revealVote(0, salt(2))).to.be.revertedWithCustomError(voting, "InvalidReveal");
  });

  it("rejects reveal without commit and double reveal", async () => {
    await voting.startCommit();
    await commit(alice, 0, salt(1));
    await voting.startReveal();
    await expect(voting.connect(bob).revealVote(0, salt(1))).to.be.revertedWithCustomError(voting, "NotCommitted");
    await voting.connect(alice).revealVote(0, salt(1));
    await expect(voting.connect(alice).revealVote(0, salt(1))).to.be.revertedWithCustomError(voting, "AlreadyRevealed");
  });

  it("a commitment cannot be copied by another voter", async () => {
    await voting.startCommit();
    const c = await voting.computeCommitment(0, salt(1), alice.address);
    await voting.connect(alice).commitVote(c);
    await voting.connect(bob).commitVote(c); // bob copies alice's hash
    await voting.startReveal();
    await expect(voting.connect(bob).revealVote(0, salt(1))).to.be.revertedWithCustomError(voting, "InvalidReveal");
  });

  it("runs a full election and tallies correctly", async () => {
    await voting.startCommit();
    await commit(alice, 0, salt(1));
    await commit(bob, 2, salt(2));
    await commit(carol, 2, salt(3));
    await voting.startReveal();
    await voting.connect(alice).revealVote(0, salt(1));
    await voting.connect(bob).revealVote(2, salt(2));
    await voting.connect(carol).revealVote(2, salt(3));
    await voting.endElection();
    expect(await voting.phase()).to.equal(Phase.Ended);
    expect((await voting.results()).map(Number)).to.deep.equal([1, 0, 2]);
    expect(await voting.revealedCount()).to.equal(3);
  });

  it("cannot go backwards or skip phases", async () => {
    await expect(voting.startReveal()).to.be.revertedWithCustomError(voting, "WrongPhase");
    await voting.startCommit();
    await expect(voting.registerVoters([mallory.address])).to.be.revertedWithCustomError(voting, "WrongPhase");
  });
});
