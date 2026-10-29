const { ethers } = require("ethers");
const config = require("./config");

const votingArtifact = require("../artifacts/contracts/AnonymousVoting.sol/AnonymousVoting.json");
const semaphoreArtifact = require("../artifacts/@semaphore-protocol/contracts/Semaphore.sol/Semaphore.json");

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const registrar = new ethers.Wallet(config.registrarKey, provider);
const relayer = new ethers.Wallet(config.relayerKey, provider);

const reader = new ethers.Contract(config.contractAddress, votingArtifact.abi, provider);
const asRegistrar = reader.connect(registrar);
const asRelayer = reader.connect(relayer);

let semaphore; // resolved at startup from voting.semaphore()
const semaphoreInterface = new ethers.Interface(semaphoreArtifact.abi);

async function init() {
  const semaphoreAddress = await reader.semaphore();
  semaphore = new ethers.Contract(semaphoreAddress, semaphoreArtifact.abi, provider);

  const registrarAddr = await reader.registrar();
  if (registrarAddr.toLowerCase() !== registrar.address.toLowerCase()) {
    throw new Error(`REGISTRAR_PRIVATE_KEY (${registrar.address}) is not the contract registrar (${registrarAddr}).`);
  }
  const admin = await reader.admin();
  if (admin.toLowerCase() === relayer.address.toLowerCase() || admin.toLowerCase() === registrar.address.toLowerCase()) {
    throw new Error("The election admin key must not be used by this server.");
  }
}

/** Every commitment in the voting group, in on-chain order (public data). */
async function groupMembers() {
  const groupId = await reader.groupId();
  const events = await semaphore.queryFilter(semaphore.filters.MembersAdded(groupId));
  const members = [];
  for (const ev of events) for (const c of ev.args.identityCommitments) members.push(c.toString());
  return members;
}

/** Decode a revert into a custom-error name from either contract. */
function revertName(err) {
  const data = err?.data || err?.info?.error?.data || err?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    for (const iface of [reader.interface, semaphoreInterface]) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) return parsed.name;
      } catch {}
    }
  }
  return err?.revert?.name || null;
}

// Transactions from one wallet must be sent one at a time, or nonces collide.
function makeQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

module.exports = {
  provider, registrar, relayer, reader, asRegistrar, asRelayer,
  init, groupMembers, revertName, makeQueue,
  semaphore: () => semaphore,
};
