// Gives the live wallets free play-money on your LOCAL test chain, for rehearsing the live steps.
//   node scripts/fund-local.js        (start the chain first: npm run node)
// It refuses to run against any network other than the local one (chain id 31337).
const { ethers } = require("ethers");
const { wallets } = require("./lib/live");

async function main() {
  const w = wallets();
  if (!w) throw new Error("No wallets yet. Run: npm run live:wallets");
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", undefined, { staticNetwork: true });
  const { chainId } = await provider.getNetwork().catch(() => { throw new Error("The local chain is not running. Start it with: npm run node"); });
  if (chainId !== 31337n) throw new Error("This is only for the local test chain (chain id 31337).");
  const amount = "0x" + ethers.parseEther("5").toString(16);
  for (const a of [w.admin, w.submitter, ...w.trustees]) await provider.send("hardhat_setBalance", [a.address, amount]);
  console.log("Gave 5 test ETH to each of the 5 live wallets on the local chain.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
