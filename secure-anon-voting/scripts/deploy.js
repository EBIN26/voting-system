// Local-development deployment. Run with: npx hardhat run scripts/deploy.js --network localhost
//
// Account roles on the local Hardhat node:
//   #0 election admin (starts voting; never given to the server)
//   #1 registrar      (server: adds voter commitments)
//   #2 relayer        (server: submits votes and pays gas)
// For any real network, deploy with your own keys and set .env by hand.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");
const { deploySemaphore } = require("./lib/deploySemaphore");

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const walletAt = (i) => ethers.HDNodeWallet.fromPhrase(HARDHAT_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) {
    throw new Error("deploy.js only auto-configures the local Hardhat network (chainId 31337).");
  }
  const [admin] = await ethers.getSigners();
  const registrar = walletAt(1);
  const relayer = walletAt(2);

  const semaphore = await deploySemaphore();
  const Voting = await ethers.getContractFactory("AnonymousVoting");
  const voting = await Voting.connect(admin).deploy(
    await semaphore.getAddress(),
    registrar.address,
    process.env.ELECTION_TITLE || "Student Council Election",
    (process.env.CANDIDATES || "Ann,Ben,Cat").split(",").map((s) => s.trim())
  );
  await voting.waitForDeployment();
  const address = await voting.getAddress();

  const envPath = path.resolve(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const get = (k) => existing.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1];
  const env = {
    RPC_URL: "http://127.0.0.1:8545",
    CONTRACT_ADDRESS: address,
    REGISTRAR_PRIVATE_KEY: registrar.privateKey,
    RELAYER_PRIVATE_KEY: relayer.privateKey,
    ADMIN_API_KEY: get("ADMIN_API_KEY") || crypto.randomBytes(32).toString("hex"),
    CODE_PEPPER: get("CODE_PEPPER") || crypto.randomBytes(32).toString("hex"),
    MIN_VOTERS: get("MIN_VOTERS") || "3",
  };
  fs.writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });

  // The relayer needs gas; the node pre-funds accounts but this makes it explicit.
  console.log("Voting contract:", address);
  console.log("Semaphore:      ", await semaphore.getAddress());
  console.log("Group id:       ", (await voting.groupId()).toString());
  console.log(".env written (local test keys only).");
}

main().catch((e) => { console.error(e); process.exit(1); });
