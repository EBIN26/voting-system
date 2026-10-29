const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const signers = await ethers.getSigners();
  const F = await ethers.getContractFactory("Voting");
  const voting = await F.deploy("Class President", ["Ann", "Ben", "Cat"]);
  await voting.waitForDeployment();
  const address = await voting.getAddress();

  // Register the first 5 non-admin accounts as eligible voters (demo only).
  await (await voting.registerVoters(signers.slice(1, 6).map((s) => s.address))).wait();

  const artifact = require("../artifacts/contracts/Voting.sol/Voting.json");
  fs.mkdirSync("frontend", { recursive: true });
  fs.writeFileSync("frontend/config.json", JSON.stringify({ address, abi: artifact.abi }, null, 2));
  console.log("Voting deployed to", address);
}

main().catch((e) => { console.error(e); process.exit(1); });
