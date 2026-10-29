// Local development deployment: npx hardhat run scripts/deploy-local.js --network localhost
//
// Roles on the local Hardhat node (public test keys, never use them anywhere real):
//   #0 admin      opens the election (never given to the server)
//   #1 submitter  the backend
//   #2-#4         trustees (2 of 3 must agree on the results)
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const MNEMONIC = "test test test test test test test test test test test junk";
const walletAt = (i) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) throw new Error("deploy-local.js only works on the local Hardhat node (chainId 31337).");

  const [admin] = await ethers.getSigners();
  const submitter = walletAt(1);
  const trustees = [2, 3, 4].map((i) => walletAt(i).address);

  // The key ceremony (scripts/ceremony.js) must run first: the contract fixes its hash forever.
  const hashFile = path.resolve(__dirname, "..", "ceremony", "key-hash.txt");
  if (!fs.existsSync(hashFile)) {
    throw new Error("Run the key ceremony first: node scripts/ceremony.js --demo-passphrases (local demo)");
  }
  const keyHash = fs.readFileSync(hashFile, "utf8").trim();

  const F = await ethers.getContractFactory("GovElection");
  const election = await F.connect(admin).deploy(
    submitter.address,
    process.env.ELECTION_TITLE || "General Election (demo)",
    (process.env.CANDIDATES || "Ann,Ben,Cat").split(",").map((s) => s.trim()),
    trustees,
    2,
    keyHash
  );
  await election.waitForDeployment();
  const address = await election.getAddress();

  const envPath = path.resolve(__dirname, "..", ".env");
  const old = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const get = (k) => old.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1];
  const rand = () => crypto.randomBytes(32).toString("hex");
  const env = {
    RPC_URL: "http://127.0.0.1:8545",
    CONTRACT_ADDRESS: address,
    SUBMITTER_PRIVATE_KEY: submitter.privateKey,
    ID_PEPPER: get("ID_PEPPER") || rand(),
    OTP_SECRET: get("OTP_SECRET") || rand(),
    ADMIN_API_KEY: get("ADMIN_API_KEY") || rand(),
    MOCK_UIDAI_SECRET: get("MOCK_UIDAI_SECRET") || rand(),
  };
  fs.writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });

  console.log("GovElection deployed to", address);
  console.log(".env written (local test keys only).");
}

main().catch((e) => { console.error(e); process.exit(1); });
