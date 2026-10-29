// Deploys the election to Sepolia:   npm run live:deploy
//
// Before this: (1) node scripts/live-wallets.js, (2) fund the admin wallet with Sepolia test ETH,
// (3) the key ceremony, node scripts/ceremony.js (creates ceremony/key-hash.txt).
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");
const { deployLive } = require("./lib/deployLive");
const { liveDir, wallets, rpcUrl } = require("./lib/live");

async function main() {
  const w = wallets();
  if (!w) throw new Error("No wallets yet. Run: node scripts/live-wallets.js");

  // Safety: this script is for the live test network. Rehearsals on a local chain must say so explicitly.
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 11155111 && process.env.ALLOW_ANY_CHAIN !== "1") {
    throw new Error(`Connected to chain ${chainId}, not Sepolia (11155111). Run with: --network sepolia`);
  }

  const hashFile = path.resolve(__dirname, "..", "ceremony", "key-hash.txt");
  if (!fs.existsSync(hashFile)) throw new Error("Run the key ceremony first: node scripts/ceremony.js");
  const keyHash = fs.readFileSync(hashFile, "utf8").trim();

  const [admin] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("GovElection", admin);
  const record = await deployLive({
    factory, wallets: w, keyHash,
    title: process.env.ELECTION_TITLE || "General Election (Sepolia test)",
    candidates: (process.env.CANDIDATES || "Ann,Ben,Cat").split(",").map((s) => s.trim()),
    threshold: 2,
    confirmations: chainId === 11155111 ? 2 : 1,
    rpcUrl: network.config.url || rpcUrl(),
    liveDir: liveDir(),
    log: console.log,
  });

  console.log("\nSaved to", liveDir());
  console.log("  deployment.json   public record of the deployment");
  console.log("  server.env        settings for the cloud server (holds the submitter key)");
  if (record.explorer) {
    console.log("\nView it:", record.explorer);
    console.log("Publish the source (optional, needs a free ETHERSCAN_API_KEY):");
    console.log(`  npx hardhat verify --network sepolia --constructor-args live/verify-args.js ${record.contract}`);
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
