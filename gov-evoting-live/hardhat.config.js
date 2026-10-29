require("@nomicfoundation/hardhat-toolbox");
const fs = require("node:fs");
const path = require("node:path");

// The live-network wallets are created by `node scripts/live-wallets.js`. Only the
// ADMIN key is given to Hardhat: it deploys the contract and nothing else.
function liveAdminKey() {
  try {
    const file = path.resolve(process.env.LIVE_DIR || "live", "wallets.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).admin.privateKey;
  } catch {
    return null;
  }
}
const adminKey = liveAdminKey();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    // Ethereum's Proof of Stake test network. The default RPC is a free public node (no account
    // needed); set SEPOLIA_RPC_URL to your own provider's URL for better reliability.
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: adminKey ? [adminKey] : [],
    },
    // A full dry run of the live steps on your own local test chain (`npm run node`), using the
    // same admin wallet. Costs nothing and finds mistakes before anything goes to Sepolia.
    rehearsal: {
      url: "http://127.0.0.1:8545",
      accounts: adminKey ? [adminKey] : [],
    },
  },
  // Optional: publishes the contract source on Etherscan so anyone can read it.
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || "" },
};
