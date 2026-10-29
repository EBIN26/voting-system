const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { keyHash, fromPem } = require("../lib/keys");
const { electionId } = require("../lib/ballot");
const { voterHash } = require("./crypto-util");
const { openDb } = require("./db");
const { createMockUidai, loadCitizens } = require("./uidai-mock");
const { createChain } = require("./chain");
const { createApp } = require("./app");

async function main() {
  const config = loadConfig();
  if (!config.mockUidaiSecret) {
    throw new Error("No real UIDAI adapter is configured yet. Set MOCK_UIDAI_SECRET to run with the mock (development only).");
  }

  const db = openDb(config.dbFile);
  const citizens = loadCitizens(config.mockUidaiFile);
  const uidai = createMockUidai({
    secret: config.mockUidaiSecret,
    citizens,
    ttlSeconds: config.otpTtlSeconds,
    exposeOtp: config.showDemoOtp,
    // Stands in for the SMS gateway. Never do this with real OTPs.
    deliver: (phone, otp) => console.log(`[mock SMS to ******${phone.slice(-4)}] Your OTP is ${otp}`),
  });
  const chain = createChain(config);
  await chain.verifyConfiguration();

  // The election public key must match the hash fixed in the contract at deployment,
  // so a swapped key (which would let someone read ballots) is caught at startup.
  let electionKey = null;
  const keyFile = path.resolve(process.env.ELECTION_PUBLIC_KEY_FILE || "ceremony/election-public-key.pem");
  if (fs.existsSync(keyFile)) {
    const pem = fs.readFileSync(keyFile, "utf8");
    const hash = keyHash(fromPem(pem));
    const onChain = await chain.electionKeyHash();
    if (hash !== onChain) throw new Error(`${keyFile} does not match the contract's electionKeyHash. Refusing to start.`);
    electionKey = { publicKeyPem: pem, keyHash: hash, electionId: electionId(await chain.chainId(), chain.address) };
    console.log("Election public key verified against the contract.");
  } else {
    console.warn(`WARNING: ${keyFile} not found; voters cannot fetch the election key. Run the key ceremony first.`);
  }

  // Per-IP limits. Raise them if many voters share one address (e.g. a polling centre).
  const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
  const limits = {
    otpPerMinute: num("OTP_PER_MINUTE", 5),
    verifyPerMinute: num("VERIFY_PER_MINUTE", 10),
    tokenPerMinute: num("TOKEN_PER_MINUTE", 10),
    castPerMinute: num("CAST_PER_MINUTE", 20),
  };
  const staticDir = path.resolve(__dirname, "..", "frontend", "public");

  // Local development only: lets the admin page send transactions through the test chain's
  // unlocked accounts. Refused in production and on any chain other than the local one.
  let devRpcUrl = null;
  if (process.env.DEV_RPC_PROXY === "1") {
    if (config.production || (await chain.chainId()) !== 31337n) {
      throw new Error("DEV_RPC_PROXY is only allowed on the local test chain (chainId 31337), never in production.");
    }
    devRpcUrl = config.rpcUrl;
    console.warn("WARNING: DEV_RPC_PROXY is on. Anyone who can reach this server can use the local test accounts.");
  }

  // Demo only: one-click voting page (simple.html). The dummy voter IDs are the mock citizens.
  let simpleMode = null;
  if (config.simpleVoting) {
    const idHashOf = (id) => voterHash(config.idPepper, uidai.uidTokenFor(id));
    simpleMode = {
      referenceFor: (id) => uidai.uidTokenFor(id),
      listVoters: () => citizens.map((c) => ({ voterId: c.aadhaar, onRoll: db.isOnRoll(idHashOf(c.aadhaar)) })),
    };
    limits.simplePerMinute = num("SIMPLE_PER_MINUTE", 60);
    console.warn("WARNING: SIMPLE_VOTING is on. Votes skip registration and OTP login. Demo only.");
  }

  const app = createApp({ config, db, uidai, chain, electionKey, staticDir, devRpcUrl, simpleMode, limits });
  if (config.showDemoOtp) console.warn("WARNING: SHOW_DEMO_OTP is on. OTPs are returned to the browser. Demo only.");
  app.listen(config.port, config.host, () => {
    console.log(`E-voting backend on http://${config.host}:${config.port} (MOCK Aadhaar, development only)`);
  });
}

main().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
