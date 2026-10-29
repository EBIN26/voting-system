// Election admin commands, run by the person holding the admin key (not the server).
//   node scripts/admin.js status
//   node scripts/admin.js start <durationSeconds>
//   node scripts/admin.js end            (works once the deadline has passed)
//   node scripts/admin.js warp <seconds> (local Hardhat node only: skips time)
//
// Key: ADMIN_PRIVATE_KEY. On a local Hardhat node it defaults to account #0.
require("dotenv").config();
const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/AnonymousVoting.sol/AnonymousVoting.json");

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
  const { chainId } = await provider.getNetwork();
  let key = process.env.ADMIN_PRIVATE_KEY;
  if (!key && chainId === 31337n) key = ethers.HDNodeWallet.fromPhrase(HARDHAT_MNEMONIC, undefined, "m/44'/60'/0'/0/0").privateKey;
  if (!key) throw new Error("Set ADMIN_PRIVATE_KEY.");
  const wallet = new ethers.Wallet(key, provider);
  const voting = new ethers.Contract(process.env.CONTRACT_ADDRESS, artifact.abi, wallet);

  if (cmd === "status") {
    const phase = ["Registration", "Voting", "Ended"][Number(await voting.phase())];
    console.log({ phase, registered: Number(await voting.registeredCount()), votes: Number(await voting.totalVotes()), endsAt: Number(await voting.votingEndsAt()) });
  } else if (cmd === "start") {
    const seconds = Number(arg);
    if (!Number.isInteger(seconds) || seconds < 1) throw new Error("Give a duration in seconds.");
    await (await voting.startVoting(seconds)).wait();
    console.log(`Voting started for ${seconds}s.`);
  } else if (cmd === "end") {
    await (await voting.endElection()).wait();
    console.log("Election ended.");
  } else if (cmd === "warp") {
    if (chainId !== 31337n) throw new Error("warp works only on the local Hardhat node.");
    await provider.send("evm_increaseTime", [Number(arg)]);
    await provider.send("evm_mine", []);
    console.log(`Advanced chain time by ${arg}s.`);
  } else {
    console.log("Commands: status | start <seconds> | end | warp <seconds>");
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
