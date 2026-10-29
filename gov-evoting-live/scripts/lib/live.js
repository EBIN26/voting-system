// Shared helpers for running against a real network (Sepolia). Everything secret lives in
// the `live/` folder, which is never committed and never copied to the cloud server.
//
//   live/wallets.json     all role keys: admin, submitter, 3 trustees  (stays on YOUR computer)
//   live/deployment.json  contract address, deploy block, network    (public information)
//   live/server.env       settings for the cloud server: holds only the submitter key
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const liveDir = () => path.resolve(process.env.LIVE_DIR || path.join(__dirname, "..", "..", "live"));

function readJson(name) {
  const file = path.join(liveDir(), name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const wallets = () => readJson("wallets.json");
const deployment = () => readJson("deployment.json");
const rpcUrl = () => process.env.SEPOLIA_RPC_URL || DEFAULT_RPC;

/** True when the command line (or LIVE=1) asks to use the live deployment. */
const wantsLive = (argv = process.argv) => argv.includes("--live") || process.env.LIVE === "1";

/**
 * Points the tally and admin tools at the live deployment by setting the same variables
 * they already read (RPC_URL, CONTRACT_ADDRESS, DEPLOY_BLOCK).
 */
function applyLiveEnv() {
  const d = deployment();
  if (!d) throw new Error(`No live deployment found in ${liveDir()}. Run: npm run live:deploy`);
  process.env.RPC_URL = d.rpcUrl || rpcUrl();
  process.env.CONTRACT_ADDRESS = d.contract;
  process.env.DEPLOY_BLOCK = String(d.deployBlock);
  return d;
}

const explorer = (chainId, address) =>
  chainId === 11155111 ? `https://sepolia.etherscan.io/address/${address}` : null;

module.exports = { liveDir, readJson, wallets, deployment, rpcUrl, wantsLive, applyLiveEnv, explorer, DEFAULT_RPC };
