const { ethers } = require("hardhat");

// Deploys the Semaphore stack: PoseidonT3 library -> verifier -> Semaphore.
async function deploySemaphore() {
  const poseidon = await (await ethers.getContractFactory("PoseidonT3")).deploy();
  const verifier = await (await ethers.getContractFactory("SemaphoreVerifier")).deploy();
  const Semaphore = await ethers.getContractFactory("Semaphore", {
    libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": await poseidon.getAddress() },
  });
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  await semaphore.waitForDeployment();
  return semaphore;
}

module.exports = { deploySemaphore };
