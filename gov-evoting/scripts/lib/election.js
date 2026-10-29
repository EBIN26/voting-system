// Reads an election from the chain for the tally tools.
require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");
const artifact = require("../../artifacts/contracts/GovElection.sol/GovElection.json");
const { electionId } = require("../../lib/ballot");

const PHASES = ["Setup", "Voting", "Closed", "Finalized"];

async function connect(signerKey) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545", undefined, { cacheTimeout: -1 });
  const base = new ethers.Contract(process.env.CONTRACT_ADDRESS, artifact.abi, provider);
  const contract = signerKey ? base.connect(new ethers.Wallet(signerKey, provider)) : base;
  const { chainId } = await provider.getNetwork();
  return { provider, contract, id: electionId(chainId, process.env.CONTRACT_ADDRESS) };
}

async function readBallots(contract) {
  const count = Number(await contract.ballotCount());
  const ballots = [];
  for (let i = 0; i < count; i++) ballots.push(ethers.hexlify(await contract.getBallot(i)));
  return ballots;
}

module.exports = { connect, readBallots, PHASES };
