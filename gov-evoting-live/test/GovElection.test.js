const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const Phase = { Setup: 0, Voting: 1, Closed: 2, Finalized: 3 };
const KEY_HASH = ethers.id("election-public-key");
const token = (n) => ethers.keccak256(ethers.toUtf8Bytes("token-" + n));
const ballot = (n) => ethers.hexlify(ethers.randomBytes(300 + n));

describe("GovElection", () => {
  let admin, submitter, t1, t2, t3, outsider;
  let election, start, end;

  async function deploy(threshold = 2, trustees) {
    const F = await ethers.getContractFactory("GovElection");
    return F.connect(admin).deploy(
      submitter.address,
      "General Election",
      ["Ann", "Ben", "Cat"],
      trustees || [t1.address, t2.address, t3.address],
      threshold,
      KEY_HASH
    );
  }

  beforeEach(async () => {
    [admin, submitter, t1, t2, t3, outsider] = await ethers.getSigners();
    election = await deploy();
    const now = await time.latest();
    start = now + 100;
    end = now + 1100;
  });

  const open = (eligible = 10) => election.connect(admin).openElection(eligible, start, end);
  const startVoting = async () => { await open(); await time.increaseTo(start + 1); };
  const closeNow = async () => { await time.increaseTo(end + 1); await election.closeElection(); };

  describe("setup", () => {
    it("rejects a bad configuration", async () => {
      const F = await ethers.getContractFactory("GovElection");
      const base = [submitter.address, "x", ["A", "B"], [t1.address, t2.address], 2, KEY_HASH];
      const bad = (i, v) => { const a = [...base]; a[i] = v; return F.deploy(...a); };
      await expect(bad(2, ["only one"])).to.be.revertedWithCustomError(F, "BadSetup");
      await expect(bad(4, 1)).to.be.revertedWithCustomError(F, "BadSetup");          // threshold < 2
      await expect(bad(4, 3)).to.be.revertedWithCustomError(F, "BadSetup");          // threshold > trustees
      await expect(bad(5, ethers.ZeroHash)).to.be.revertedWithCustomError(F, "BadSetup");
      await expect(bad(3, [t1.address, t1.address])).to.be.revertedWithCustomError(F, "BadSetup"); // duplicate
      await expect(bad(3, [t1.address, admin.address])).to.be.revertedWithCustomError(F, "BadSetup"); // admin is trustee
      await expect(bad(3, [t1.address, submitter.address])).to.be.revertedWithCustomError(F, "BadSetup"); // submitter is trustee
      await expect(bad(0, admin.address)).to.be.revertedWithCustomError(F, "BadSetup"); // submitter is admin
    });

    it("only the admin can open the election, and only once", async () => {
      await expect(election.connect(outsider).openElection(10, start, end)).to.be.revertedWithCustomError(election, "NotAdmin");
      await expect(election.connect(submitter).openElection(10, start, end)).to.be.revertedWithCustomError(election, "NotAdmin");
      await open();
      await expect(open()).to.be.revertedWithCustomError(election, "WrongPhase");
    });

    it("rejects invalid windows and a zero voter cap", async () => {
      await expect(election.openElection(0, start, end)).to.be.revertedWithCustomError(election, "BadSetup");
      await expect(election.openElection(10, end, start)).to.be.revertedWithCustomError(election, "BadSetup");
      await expect(election.openElection(10, (await time.latest()) - 5, end)).to.be.revertedWithCustomError(election, "BadSetup");
    });
  });

  describe("casting ballots", () => {
    beforeEach(startVoting);

    it("accepts a ballot from the submitter and records it", async () => {
      await expect(election.connect(submitter).castBallot(token(1), ballot(1))).to.emit(election, "BallotCast");
      expect(await election.ballotCount()).to.equal(1);
      expect(await election.tokenUsed(token(1))).to.equal(true);
    });

    it("only the submitter can cast, not even the admin", async () => {
      await expect(election.connect(admin).castBallot(token(1), ballot(1))).to.be.revertedWithCustomError(election, "NotSubmitter");
      await expect(election.connect(t1).castBallot(token(1), ballot(1))).to.be.revertedWithCustomError(election, "NotSubmitter");
      await expect(election.connect(outsider).castBallot(token(1), ballot(1))).to.be.revertedWithCustomError(election, "NotSubmitter");
    });

    it("rejects a reused token (double vote)", async () => {
      await election.connect(submitter).castBallot(token(1), ballot(1));
      await expect(election.connect(submitter).castBallot(token(1), ballot(2))).to.be.revertedWithCustomError(election, "TokenAlreadyUsed");
    });

    it("rejects an empty token and empty or oversized ballots", async () => {
      await expect(election.connect(submitter).castBallot(ethers.ZeroHash, ballot(1))).to.be.revertedWithCustomError(election, "InvalidToken");
      await expect(election.connect(submitter).castBallot(token(1), "0x")).to.be.revertedWithCustomError(election, "InvalidBallot");
      await expect(election.connect(submitter).castBallot(token(1), ethers.hexlify(ethers.randomBytes(1025)))).to.be.revertedWithCustomError(election, "InvalidBallot");
    });

    it("never accepts more ballots than eligible voters", async () => {
      const small = await deploy();
      await small.openElection(2, (await time.latest()) + 10, (await time.latest()) + 1000);
      await time.increase(20);
      await small.connect(submitter).castBallot(token(1), ballot(1));
      await small.connect(submitter).castBallot(token(2), ballot(2));
      await expect(small.connect(submitter).castBallot(token(3), ballot(3))).to.be.revertedWithCustomError(small, "BallotCapReached");
    });

    it("rejects ballots after the window ends", async () => {
      await time.increaseTo(end + 1);
      await expect(election.connect(submitter).castBallot(token(1), ballot(1))).to.be.revertedWithCustomError(election, "OutsideVotingWindow");
    });
  });

  it("rejects ballots before the window starts", async () => {
    await open();
    await expect(election.connect(submitter).castBallot(token(1), ballot(1))).to.be.revertedWithCustomError(election, "OutsideVotingWindow");
  });

  describe("closing", () => {
    beforeEach(startVoting);

    it("cannot be closed early by anyone, including the admin", async () => {
      await expect(election.connect(admin).closeElection()).to.be.revertedWithCustomError(election, "VotingNotOver");
    });

    it("anyone can close it once the window is over", async () => {
      await time.increaseTo(end + 1);
      await election.connect(outsider).closeElection();
      expect(await election.phase()).to.equal(Phase.Closed);
    });
  });

  describe("trustee-verified results", () => {
    beforeEach(async () => {
      await startVoting();
      for (let i = 1; i <= 4; i++) await election.connect(submitter).castBallot(token(i), ballot(i));
      await closeNow();
    });

    it("only trustees can submit a tally", async () => {
      await expect(election.connect(admin).submitTally([1, 1, 2])).to.be.revertedWithCustomError(election, "NotTrustee");
      await expect(election.connect(submitter).submitTally([1, 1, 2])).to.be.revertedWithCustomError(election, "NotTrustee");
      await expect(election.connect(outsider).submitTally([1, 1, 2])).to.be.revertedWithCustomError(election, "NotTrustee");
    });

    it("rejects a tally with the wrong length or more votes than ballots", async () => {
      await expect(election.connect(t1).submitTally([4, 0])).to.be.revertedWithCustomError(election, "BadTally");
      await expect(election.connect(t1).submitTally([3, 2, 0])).to.be.revertedWithCustomError(election, "BadTally");
    });

    it("finalises only when the threshold of trustees agree", async () => {
      await election.connect(t1).submitTally([1, 1, 2]);
      expect(await election.phase()).to.equal(Phase.Closed);
      await expect(election.results()).to.be.revertedWithCustomError(election, "WrongPhase");

      await election.connect(t2).submitTally([2, 1, 1]); // disagrees, so no result
      expect(await election.phase()).to.equal(Phase.Closed);

      await election.connect(t3).submitTally([1, 1, 2]); // second matching tally
      expect(await election.phase()).to.equal(Phase.Finalized);
      expect((await election.results()).map(Number)).to.deep.equal([1, 1, 2]);
    });

    it("lets a trustee correct a mistake, and counts them only once", async () => {
      await election.connect(t1).submitTally([1, 1, 2]);
      await election.connect(t1).submitTally([1, 1, 2]); // resubmitting the same tally adds no weight
      expect(await election.phase()).to.equal(Phase.Closed);

      await election.connect(t2).submitTally([4, 0, 0]);
      await election.connect(t2).submitTally([1, 1, 2]); // fixes their typo
      expect(await election.phase()).to.equal(Phase.Finalized);
      expect((await election.results()).map(Number)).to.deep.equal([1, 1, 2]);
    });

    it("rejects further tallies once final", async () => {
      await election.connect(t1).submitTally([1, 1, 2]);
      await election.connect(t2).submitTally([1, 1, 2]);
      await expect(election.connect(t3).submitTally([0, 0, 4])).to.be.revertedWithCustomError(election, "WrongPhase");
    });
  });

  it("lets anyone read the stored ballots for the audit", async () => {
    await startVoting();
    const b = ballot(7);
    await election.connect(submitter).castBallot(token(1), b);
    expect(await election.getBallot(0)).to.equal(b);
  });
});
