// Election admin commands, run by the admin (the key never goes on the server).
//   node scripts/admin.js open <eligibleVoters> <startInSeconds> <durationSeconds>
//   node scripts/admin.js status
//   node scripts/admin.js close          (works once the window is over; anyone can do it)
//   node scripts/admin.js tick           (local Hardhat node only: mine a block to refresh its clock)
//   node scripts/admin.js warp <seconds> (local Hardhat node only)
require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/GovElection.sol/GovElection.json");

const MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
  const { chainId } = await provider.getNetwork();
  let key = process.env.ADMIN_PRIVATE_KEY;
  if (!key && chainId === 31337n) key = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/0").privateKey;
  if (!key) throw new Error("Set ADMIN_PRIVATE_KEY.");
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, artifact.abi, new ethers.Wallet(key, provider));

  if (cmd === "open") {
    // The window must be measured on the chain's clock, which is what the contract checks.
    // A quiet local chain's latest block can be hours old and its clock can run a few
    // seconds behind this computer's, so on the local chain mine a fresh block first and
    // read the time from it. A real chain makes blocks constantly, so its latest block is current.
    if (chainId === 31337n) await provider.send("evm_mine", []);
    const latest = (await provider.getBlock("latest")).timestamp;
    const now = chainId === 31337n ? latest : Math.max(latest, Math.floor(Date.now() / 1000));
    const start = now + Number(b), end = start + Number(c);
    await (await contract.openElection(Number(a), start, end)).wait();
    console.log(`Election opened: ${a} eligible voters, voting ${start}..${end} (chain time).`);
  } else if (cmd === "status") {
    console.log({
      phase: ["Setup", "Voting", "Closed", "Finalized"][Number(await contract.phase())],
      eligible: Number(await contract.eligibleVoters()), ballots: Number(await contract.ballotCount()),
      start: Number(await contract.startTime()), end: Number(await contract.endTime()),
    });
  } else if (cmd === "close") {
    await (await contract.closeElection()).wait();
    console.log("Election closed.");
  } else if (cmd === "tick") {
    // A quiet local chain only mines a block when a transaction arrives, so its
    // "latest" time can lag behind the clock. Mining one block refreshes it.
    if (chainId !== 31337n) throw new Error("tick works only on the local Hardhat node.");
    await provider.send("evm_mine", []);
    console.log("Mined one block.");
  } else if (cmd === "warp") {
    if (chainId !== 31337n) throw new Error("warp works only on the local Hardhat node.");
    await provider.send("evm_increaseTime", [Number(a)]);
    await provider.send("evm_mine", []);
    console.log(`Advanced chain time by ${a}s.`);
  } else {
    console.log("Commands: open <eligible> <startIn> <duration> | status | close | warp <seconds>");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
