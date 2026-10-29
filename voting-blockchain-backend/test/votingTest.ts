import { expect } from "chai";
import { network } from "hardhat";
import {
  generateKeyPair,
  encryptVote,
  decryptVote,
} from "../utils/crypto.js";

describe("Secure Voting Blockchain Pipeline", function () {

  async function deployVotingContract() {
    const { ethers } = await network.create();

    const [admin, relayer, nonAdmin] =
      await ethers.getSigners();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    if (!latestBlock) {
      throw new Error("Unable to read latest block");
    }

    const currentTime =
      Number(latestBlock.timestamp);

    // Election starts 60 seconds from now
    const startTime =
      BigInt(currentTime + 60);

    // Election ends 1 hour from now
    const endTime =
      BigInt(currentTime + 3600);

    const SecureVotingFactory =
      await ethers.getContractFactory(
        "SecureVoting"
      );

    const votingContract =
      await SecureVotingFactory.deploy(
        startTime,
        endTime
      );

    await votingContract.waitForDeployment();

    return {
      ethers,
      admin,
      relayer,
      nonAdmin,
      votingContract,
      startTime,
      endTime,
    };
  }


  // --------------------------------------------------
  // TEST 1
  // --------------------------------------------------

  it(
    "Should reject voting before the election starts",
    async function () {

      const {
        ethers,
        relayer,
        votingContract,
      } = await deployVotingContract();

      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          ["VOTER-BEFORE-START"]
        );

      await expect(
        votingContract
          .connect(relayer)
          .castVote(
            "encrypted-test-payload",
            voterHash
          )
      ).to.be.revertedWith(
        "Election is not active."
      );
    }
  );


  // --------------------------------------------------
  // TEST 2
  // --------------------------------------------------

  it(
    "Should not allow the admin to start the election before startTime",
    async function () {

      const {
        votingContract,
      } = await deployVotingContract();

      await expect(
        votingContract.startElection()
      ).to.be.revertedWith(
        "Election has not started yet."
      );
    }
  );


  // --------------------------------------------------
  // TEST 3
  // --------------------------------------------------

  it(
    "Should allow voting during the election window",
    async function () {

      const {
        ethers,
        relayer,
        votingContract,
        startTime,
      } = await deployVotingContract();


      // Move blockchain time to just after startTime
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Admin activates the election
      await votingContract.startElection();


      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          ["VOTER-DURING-ELECTION"]
        );


      await votingContract
        .connect(relayer)
        .castVote(
          "encrypted-vote",
          voterHash
        );


      const totalVotes =
        await votingContract.getTotalVotes();

      expect(totalVotes).to.equal(1n);
    }
  );


  // --------------------------------------------------
  // TEST 4
  // --------------------------------------------------

  it(
    "Should reject voting after the election ends",
    async function () {

      const {
        ethers,
        relayer,
        votingContract,
        startTime,
        endTime,
      } = await deployVotingContract();


      // Move blockchain time to election start
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Start election
      await votingContract.startElection();


      // Move blockchain time beyond endTime
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(endTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          ["VOTER-AFTER-END"]
        );


      await expect(
        votingContract
          .connect(relayer)
          .castVote(
            "encrypted-vote",
            voterHash
          )
      ).to.be.revertedWith(
        "Election has ended."
      );
    }
  );


  // --------------------------------------------------
  // TEST 5
  // --------------------------------------------------

  it(
    "Should encrypt vote data, record it on-chain, and decrypt it back",
    async function () {

      const {
        ethers,
        relayer,
        votingContract,
        startTime,
      } = await deployVotingContract();


      // Move blockchain time into election period
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Start election
      await votingContract.startElection();


      // Generate RSA keys
      const {
        publicKey,
        privateKey,
      } = generateKeyPair();


      const rawVotePayload = {
        voterId: "VOTER-2026-9921",
        candidateName: "Elena Rostova",
        symbolName: "RISING_SUN",
      };


      // Encrypt vote
      const encryptedString =
        encryptVote(
          rawVotePayload,
          publicKey
        );


      // Hash voter ID
      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          [rawVotePayload.voterId]
        );


      // Submit encrypted vote
      const tx =
        await votingContract
          .connect(relayer)
          .castVote(
            encryptedString,
            voterHash
          );

      await tx.wait();


      // Verify vote count
      const totalVotes =
        await votingContract.getTotalVotes();

      expect(totalVotes).to.equal(1n);


      // Verify voter status
      const hasVotedStatus =
        await votingContract.hasVoted(
          voterHash
        );

      expect(hasVotedStatus).to.be.true;


      // Retrieve encrypted vote
      const retrievedEncryptedPayload =
        await votingContract.getVote(0);


      // Decrypt vote
      const decryptedPayload =
        decryptVote(
          retrievedEncryptedPayload,
          privateKey
        );


      // Verify decrypted data
      expect(
        decryptedPayload.voterId
      ).to.equal(
        rawVotePayload.voterId
      );

      expect(
        decryptedPayload.candidateName
      ).to.equal(
        rawVotePayload.candidateName
      );

      expect(
        decryptedPayload.symbolName
      ).to.equal(
        rawVotePayload.symbolName
      );
    }
  );


  // --------------------------------------------------
  // TEST 6
  // --------------------------------------------------

  it(
    "Should prevent a voter from voting twice",
    async function () {

      const {
        ethers,
        relayer,
        votingContract,
        startTime,
      } = await deployVotingContract();


      // Move into election period
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Start election
      await votingContract.startElection();


      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          ["VOTER-DUPLICATE-001"]
        );


      // First vote
      await votingContract
        .connect(relayer)
        .castVote(
          "encrypted-vote-1",
          voterHash
        );


      // Second vote should fail
      await expect(
        votingContract
          .connect(relayer)
          .castVote(
            "encrypted-vote-2",
            voterHash
          )
      ).to.be.revertedWith(
        "Voter has already voted."
      );
    }
  );


  // --------------------------------------------------
  // TEST 7
  // --------------------------------------------------

  it(
    "Should allow only the admin to start the election",
    async function () {

      const {
        votingContract,
        nonAdmin,
        ethers,
        startTime,
      } = await deployVotingContract();


      // Move to start time
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Non-admin cannot start
      await expect(
        votingContract
          .connect(nonAdmin)
          .startElection()
      ).to.be.revertedWith(
        "Only admin can perform this action."
      );
    }
  );


  // --------------------------------------------------
  // TEST 8
  // --------------------------------------------------

  it(
    "Should allow only the admin to end the election",
    async function () {

      const {
        votingContract,
        admin,
        nonAdmin,
        ethers,
        startTime,
      } = await deployVotingContract();


      // Move into election period
      await ethers.provider.send(
        "evm_setNextBlockTimestamp",
        [Number(startTime) + 1]
      );

      await ethers.provider.send(
        "evm_mine",
        []
      );


      // Admin starts election
      await votingContract
        .connect(admin)
        .startElection();


      // Non-admin cannot end election
      await expect(
        votingContract
          .connect(nonAdmin)
          .endElection()
      ).to.be.revertedWith(
        "Only admin can perform this action."
      );


      // Admin can end election
      await votingContract
        .connect(admin)
        .endElection();


      const state =
        await votingContract.electionState();

      expect(state).to.equal(2n);
    }
  );


  // --------------------------------------------------
  // TEST 9
  // --------------------------------------------------

  it(
    "Should reject an invalid election time range",
    async function () {

      const { ethers } =
        await network.create();


      const latestBlock =
        await ethers.provider.getBlock(
          "latest"
        );

      if (!latestBlock) {
        throw new Error(
          "Unable to read latest block"
        );
      }


      const currentTime =
        Number(latestBlock.timestamp);


      const SecureVotingFactory =
        await ethers.getContractFactory(
          "SecureVoting"
        );


      // endTime is before startTime
      await expect(
        SecureVotingFactory.deploy(
          BigInt(currentTime + 3600),
          BigInt(currentTime + 60)
        )
      ).to.be.revertedWith(
        "Start time must be before end time."
      );
    }
  );

});