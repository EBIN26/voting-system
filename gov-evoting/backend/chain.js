const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/GovElection.sol/GovElection.json");

/** Only the submitter key lives on this server. */
function createChain(config) {
  // cacheTimeout -1 turns off ethers' 250 ms response cache. With it on, two quick
  // transactions can be given the same cached nonce and the second one fails.
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  const wallet = new ethers.Wallet(config.submitterKey, provider);
  const reader = new ethers.Contract(config.contractAddress, artifact.abi, provider);
  const writer = reader.connect(wallet);

  // One transaction at a time from this wallet, or nonces collide.
  let tail = Promise.resolve();
  const queue = (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };

  function revertName(err) {
    const data = err?.data || err?.info?.error?.data || err?.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      try { return reader.interface.parseError(data)?.name || null; } catch {}
    }
    return err?.revert?.name || null;
  }

  // Values fixed at deployment, read once.
  let fixedCache;
  const fixedDetails = () =>
    (fixedCache ||= Promise.all([
      provider.getNetwork(), reader.admin(), reader.submitter(), reader.trustees(), reader.threshold(), reader.electionKeyHash(),
    ]).then(([net, admin, submitter, trustees, threshold, keyHash]) => ({
      chainId: Number(net.chainId), admin, submitter, trustees: [...trustees], threshold: Number(threshold), electionKeyHash: keyHash,
    })).catch((e) => { fixedCache = undefined; throw e; }));

  return {
    async verifyConfiguration() {
      const submitter = await reader.submitter();
      if (submitter.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(`SUBMITTER_PRIVATE_KEY (${wallet.address}) is not the contract submitter (${submitter}).`);
      }
      const admin = await reader.admin();
      if (admin.toLowerCase() === wallet.address.toLowerCase()) throw new Error("The admin key must not be used by this server.");
    },

    electionKeyHash: () => reader.electionKeyHash(),
    tokenUsed: (hash) => reader.tokenUsed(hash),
    chainId: async () => (await provider.getNetwork()).chainId,
    address: config.contractAddress,

    /** { phase, startTime, endTime, chainTime, ... } */
    async info() {
      const [title, candidates, phase, start, end, eligible, ballots, block, fixed] = await Promise.all([
        reader.title(), reader.candidates(), reader.phase(), reader.startTime(), reader.endTime(),
        reader.eligibleVoters(), reader.ballotCount(), provider.getBlock("latest"), fixedDetails(),
      ]);
      return {
        title, candidates: [...candidates],
        phase: ["Setup", "Voting", "Closed", "Finalized"][Number(phase)],
        startTime: Number(start), endTime: Number(end),
        // The latest block can be old on a quiet chain, so never trust it alone. The
        // contract re-checks the real block time, so this is only an early filter.
        chainTime: Math.max(block.timestamp, Math.floor(Date.now() / 1000)),
        eligibleVoters: Number(eligible), ballotCount: Number(ballots),
        contract: config.contractAddress,
        ...fixed,
      };
    },

    /** Final counts, or throws a contract error (WrongPhase) before the trustees agree. */
    async results() {
      const [names, counts] = await Promise.all([reader.candidates(), reader.results()]);
      return [...names].map((name, i) => ({ name, votes: Number(counts[i]) }));
    },

    /** How many trustees have submitted a tally, and how many agree. Only counts, no tallies. */
    async tallyProgress() {
      const [threshold, trustees, phase] = await Promise.all([reader.threshold(), reader.trustees(), reader.phase()]);
      const logs = await reader.queryFilter(reader.filters.TallySubmitted(), Number(process.env.DEPLOY_BLOCK || 0));
      const latest = new Map(); // a trustee's newest submission replaces their older one
      for (const log of logs) latest.set(log.args.trustee.toLowerCase(), log.args.tallyHash);
      const agreement = new Map();
      for (const h of latest.values()) agreement.set(h, (agreement.get(h) || 0) + 1);
      return {
        phase: ["Setup", "Voting", "Closed", "Finalized"][Number(phase)],
        threshold: Number(threshold),
        submitted: latest.size,
        leadingAgreement: Math.max(0, ...agreement.values()),
        trustees: [...trustees].map((address) => ({ address, submitted: latest.has(address.toLowerCase()) })),
      };
    },

    /** Anyone may close once the window is over; the server pays the gas. */
    closeElection() {
      return queue(async () => {
        try {
          await writer.closeElection.staticCall();
          const tx = await writer.closeElection();
          await tx.wait();
          return tx.hash;
        } catch (e) {
          e.revertName = revertName(e);
          throw e;
        }
      });
    },

    /**
     * Resolves with { txHash, blockNumber, gasUsed }, or throws an Error whose
     * `.revertName` names the contract error.
     */
    castBallot(hash, ballotHex) {
      return queue(async () => {
        try {
          await writer.castBallot.staticCall(hash, ballotHex); // surfaces revert reasons before spending gas
          const tx = await writer.castBallot(hash, ballotHex);
          const receipt = await tx.wait();
          return { txHash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: Number(receipt.gasUsed) };
        } catch (e) {
          e.revertName = revertName(e);
          throw e;
        }
      });
    },
  };
}

module.exports = { createChain };
