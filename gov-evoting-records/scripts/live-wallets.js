// Creates the wallets for a live (Sepolia) election, or shows their balances.
//
//   node scripts/live-wallets.js              create live/wallets.json (refuses to overwrite)
//   node scripts/live-wallets.js --balances   show how much test ETH each wallet holds
//
// Private keys go ONLY into live/wallets.json on your computer. They are never printed.
// Sepolia ETH is free test money with no real value; you get it from a "faucet" website.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { liveDir, wallets, rpcUrl } = require("./lib/live");
const { parseArgs } = require("./lib/cli");

const ROLES = [
  { key: "admin", label: "Admin (opens the election, deploys the contract)", need: "0.05" },
  { key: "submitter", label: "Submitter (the cloud server; pays for every ballot)", need: "0.15" },
  { key: "trustee1", label: "Trustee 1 (submits the count)", need: "0.02" },
  { key: "trustee2", label: "Trustee 2 (submits the count)", need: "0.02" },
  { key: "trustee3", label: "Trustee 3 (submits the count)", need: "0.02" },
];

function addressesOf(w) {
  return {
    admin: w.admin.address, submitter: w.submitter.address,
    trustee1: w.trustees[0].address, trustee2: w.trustees[1].address, trustee3: w.trustees[2].address,
  };
}

async function create() {
  const file = path.join(liveDir(), "wallets.json");
  if (fs.existsSync(file)) {
    throw new Error(`${file} already exists. Refusing to overwrite it: those keys may hold funds or control a deployed election.`);
  }
  const make = () => {
    const w = ethers.Wallet.createRandom();
    return { address: w.address, privateKey: w.privateKey };
  };
  const data = { admin: make(), submitter: make(), trustees: [make(), make(), make()], createdAt: new Date().toISOString().slice(0, 10) };
  fs.mkdirSync(liveDir(), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });

  const a = addressesOf(data);
  console.log(`Created ${file} (private keys stay in that file only).\n`);
  console.log("Send free Sepolia test ETH to these addresses (from any faucet):\n");
  for (const r of ROLES) console.log(`  ${a[r.key]}   ${r.label}, about ${r.need} ETH`);
  console.log("\nSearch the web for \"Sepolia faucet\". Faucets give a small amount per request, so request for several");
  console.log("addresses, or send ETH between your own wallets afterwards. Then check with:");
  console.log("  node scripts/live-wallets.js --balances");
}

async function balances() {
  const w = wallets();
  if (!w) throw new Error("No wallets yet. Run: node scripts/live-wallets.js");
  const provider = new ethers.JsonRpcProvider(rpcUrl(), undefined, { staticNetwork: true });
  const a = addressesOf(w);
  console.log(`Network: ${rpcUrl()}\n`);
  for (const r of ROLES) {
    const bal = await provider.getBalance(a[r.key]);
    const eth = Number(ethers.formatEther(bal));
    const ok = eth >= Number(r.need);
    console.log(`  ${a[r.key]}  ${eth.toFixed(4).padStart(8)} ETH  ${ok ? "ok" : `needs about ${r.need}`}   ${r.label}`);
  }
}

const args = parseArgs(process.argv.slice(2));
(args.balances ? balances() : create())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
