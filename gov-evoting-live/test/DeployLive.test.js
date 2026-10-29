// Rehearses the live deployment on the in-process test chain, so mistakes are found before
// anything is sent to Sepolia.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { deployLive, parseEnv } = require("../scripts/lib/deployLive");

const KEY_HASH = ethers.id("election-public-key");
const root = path.resolve(__dirname, "..");

function makeWallets(dir) {
  const r = spawnSync(process.execPath, ["scripts/live-wallets.js"], { cwd: root, env: { ...process.env, LIVE_DIR: dir }, encoding: "utf8" });
  return { r, wallets: fs.existsSync(path.join(dir, "wallets.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "wallets.json"), "utf8")) : null };
}

async function fund(address, eth = "10") {
  await ethers.provider.send("hardhat_setBalance", [address, "0x" + ethers.parseEther(eth).toString(16)]);
}

describe("live deployment (rehearsal)", function () {
  this.timeout(120000);
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function factoryFor(wallets) {
    const signer = new ethers.Wallet(wallets.admin.privateKey, ethers.provider);
    return ethers.getContractFactory("GovElection", signer);
  }
  const params = (factory, wallets, extra = {}) => ({
    factory, wallets, keyHash: KEY_HASH, title: "Test election", candidates: ["A", "B", "C"],
    threshold: 2, confirmations: 1, rpcUrl: "http://example.invalid", liveDir: dir, ...extra,
  });

  it("creates five different wallets, keeps keys in one file, and never overwrites it", () => {
    const first = makeWallets(dir);
    expect(first.r.status).to.equal(0);
    const w = first.wallets;
    const addresses = [w.admin.address, w.submitter.address, ...w.trustees.map((t) => t.address)];
    expect(new Set(addresses).size).to.equal(5);
    for (const wal of [w.admin, w.submitter, ...w.trustees]) expect(new ethers.Wallet(wal.privateKey).address).to.equal(wal.address);
    // the printed output lists addresses, never keys
    for (const wal of [w.admin, w.submitter, ...w.trustees]) expect(first.r.stdout + first.r.stderr).to.not.include(wal.privateKey);
    const second = makeWallets(dir);
    expect(second.r.status).to.equal(1);
    expect(second.r.stderr).to.match(/already exists/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "wallets.json"), "utf8")).admin.privateKey).to.equal(w.admin.privateKey);
  });

  it("deploys with the right roles and records the deployment", async () => {
    const { wallets } = makeWallets(dir);
    await fund(wallets.admin.address);
    const factory = await factoryFor(wallets);
    const rec = await deployLive(params(factory, wallets));

    const c = await ethers.getContractAt("GovElection", rec.contract);
    expect(await c.admin()).to.equal(wallets.admin.address);
    expect(await c.submitter()).to.equal(wallets.submitter.address);
    expect(await c.electionKeyHash()).to.equal(KEY_HASH);
    expect(Number(await c.threshold())).to.equal(2);
    expect([...(await c.trustees())]).to.deep.equal(wallets.trustees.map((t) => t.address));
    expect(rec.deployBlock).to.be.greaterThan(0);

    const saved = JSON.parse(fs.readFileSync(path.join(dir, "deployment.json"), "utf8"));
    expect(saved.contract).to.equal(rec.contract);
    expect(fs.readFileSync(path.join(dir, "verify-args.js"), "utf8")).to.include(KEY_HASH);
  });

  it("gives the server only the submitter key, never the admin or trustee keys", async () => {
    const { wallets } = makeWallets(dir);
    await fund(wallets.admin.address);
    await deployLive(params(await factoryFor(wallets), wallets));
    const text = fs.readFileSync(path.join(dir, "server.env"), "utf8");
    const env = parseEnv(text);
    expect(env.SUBMITTER_PRIVATE_KEY).to.equal(wallets.submitter.privateKey);
    for (const k of [wallets.admin.privateKey, ...wallets.trustees.map((t) => t.privateKey)]) expect(text).to.not.include(k.slice(2));
    for (const name of ["ID_PEPPER", "OTP_SECRET", "ADMIN_API_KEY", "MOCK_UIDAI_SECRET"]) expect(env[name]).to.match(/^[0-9a-f]{64}$/);
    expect(env.HOST).to.equal("0.0.0.0");
    expect(env.TRUST_PROXY).to.equal("1");
    expect(env.DEPLOY_BLOCK).to.match(/^\d+$/);
    expect(env.NODE_ENV).to.equal(undefined); // the demo-only mock service refuses NODE_ENV=production
  });

  it("a re-deploy keeps the server's secrets, so its database stays valid", async () => {
    const { wallets } = makeWallets(dir);
    await fund(wallets.admin.address);
    const factory = await factoryFor(wallets);
    await deployLive(params(factory, wallets));
    const before = parseEnv(fs.readFileSync(path.join(dir, "server.env"), "utf8"));
    const second = await deployLive(params(factory, wallets));
    const after = parseEnv(fs.readFileSync(path.join(dir, "server.env"), "utf8"));
    expect(after.ID_PEPPER).to.equal(before.ID_PEPPER);
    expect(after.ADMIN_API_KEY).to.equal(before.ADMIN_API_KEY);
    expect(after.CONTRACT_ADDRESS).to.equal(second.contract);
    expect(after.CONTRACT_ADDRESS).to.not.equal(before.CONTRACT_ADDRESS);
  });

  it("refuses the wrong deployer, a bad key hash, too few candidates and an unfunded admin", async () => {
    const { wallets } = makeWallets(dir);
    const [other] = await ethers.getSigners();
    const wrong = await ethers.getContractFactory("GovElection", other);
    await expect(deployLive(params(wrong, wallets))).to.be.rejectedWith(/not the admin wallet/);

    await fund(wallets.admin.address);
    const factory = await factoryFor(wallets);
    await expect(deployLive(params(factory, wallets, { keyHash: "0x1234" }))).to.be.rejectedWith(/key hash/);
    await expect(deployLive(params(factory, wallets, { candidates: ["only one"] }))).to.be.rejectedWith(/at least 2 candidates/);

    await ethers.provider.send("hardhat_setBalance", [wallets.admin.address, "0x0"]);
    await expect(deployLive(params(factory, wallets))).to.be.rejectedWith(/too little ETH/);
    expect(fs.existsSync(path.join(dir, "deployment.json"))).to.equal(false); // nothing recorded on failure
  });
});
