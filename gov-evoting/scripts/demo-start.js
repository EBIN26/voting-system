// One command to start a complete LOCAL demo:  npm run demo
//
// It deletes any previous demo state, runs a key ceremony with public demo passphrases,
// starts a local test blockchain, deploys the election, creates mock citizens, and starts
// the web server in demo mode. Everything here is for demonstration only: the passphrases,
// the Hardhat keys and the on-screen OTPs are public. Press Ctrl+C to stop it all.
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";
const node = process.execPath;
const children = [];

// Stops Hardhat from pausing the demo to ask about anonymous usage data.
process.env.HARDHAT_DISABLE_TELEMETRY_PROMPT = "true";

// Windows can only start npx.cmd through a shell. All arguments here are fixed strings
// from this file (never user input), so they are joined into one command line, which
// also avoids Node's warning about passing an argument list to a shell.
const needsShell = (cmd) => isWin && cmd.endsWith(".cmd");

function run(cmd, args, label) {
  const r = needsShell(cmd)
    ? spawnSync([cmd, ...args].join(" "), { cwd: root, stdio: "inherit", shell: true })
    : spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${label} failed.`);
}

function stopAll() {
  for (const c of children) {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/t", "/f"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {}
  }
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

async function waitForRpc() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8545", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The local blockchain did not start.");
}

async function main() {
  const args = process.argv.slice(2);
  const simple = args.includes("--simple"); // one-click vote page, election opened automatically
  const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const citizens = nums[0] || 5;
  const onRoll = nums[1] ?? citizens - 1;

  // A demo that is still running holds these ports and locks the data folder. Say so plainly,
  // instead of failing later with a cryptic "EPERM, Permission denied".
  for (const [port, what] of [[3000, "the web server"], [8545, "the test blockchain"]]) {
    if (await portInUse(port)) {
      throw new Error(
        `Port ${port} is already in use (${what}). A demo is probably still running: press Ctrl+C in the terminal that started it, then run this command again.`
      );
    }
  }
  for (const p of ["ceremony", "data", ".env", "tally.json", "published-election-private-key.pem"]) {
    try {
      fs.rmSync(path.join(root, p), { recursive: true, force: true });
    } catch (e) {
      throw new Error(`Could not delete "${p}" (${e.code}). Close any other terminal still running the demo, then try again.`);
    }
  }
  if (!fs.existsSync(path.join(root, "frontend", "public", "app.js")) || !fs.existsSync(path.join(root, "frontend", "public", "admin.js"))) {
    run(node, ["frontend/build.js"], "frontend build");
  }

  console.log("\n[1/5] Key ceremony (demo passphrases)");
  run(node, ["scripts/ceremony.js", "--demo-passphrases"], "key ceremony");

  console.log("\n[2/5] Starting a local test blockchain");
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const chainLog = fs.openSync(path.join(root, "data", "node.log"), "w");
  const chain = isWin
    ? spawn(`${npx} hardhat node`, { cwd: root, shell: true, stdio: ["ignore", chainLog, "inherit"] })
    : spawn(npx, ["hardhat", "node"], { cwd: root, stdio: ["ignore", chainLog, "inherit"] });
  children.push(chain);
  await waitForRpc();

  console.log("\n[3/5] Deploying the election contract");
  run(npx, ["hardhat", "run", "scripts/deploy-local.js", "--network", "localhost"], "deploy");

  console.log("\n[4/5] Creating mock citizens");
  run(node, ["scripts/seed-mock.js", String(citizens), String(onRoll)], "seed");

  console.log("\n[5/5] Starting the web server");
  const env = { ...process.env, SHOW_DEMO_OTP: "1", DEV_RPC_PROXY: "1", OTP_PER_MINUTE: "100", VERIFY_PER_MINUTE: "100", TOKEN_PER_MINUTE: "100", CAST_PER_MINUTE: "100" };
  if (simple) env.SIMPLE_VOTING = "1";
  const server = spawn(node, ["backend/server.js"], { cwd: root, env, stdio: ["ignore", fs.openSync(path.join(root, "data", "server.log"), "w"), "inherit"] });
  children.push(server);
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch("http://127.0.0.1:3000/api/election")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  if (simple) {
    // Open straight away for one day. A quiet local chain only moves its clock when a block
    // is mined, and the contract checks votes against that clock, so keep mining until the
    // latest block is past the start time. Otherwise the first votes are refused as "not open".
    console.log("\nOpening the election (simple mode)");
    run(node, ["scripts/admin.js", "open", String(onRoll), "3", String(24 * 3600)], "open election");
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", undefined, { cacheTimeout: -1 });
    const address = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^CONTRACT_ADDRESS=(.*)$/m)[1];
    const start = Number(await new ethers.Contract(address, ["function startTime() view returns (uint256)"], provider).startTime());
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await provider.send("evm_mine", []);
      if ((await provider.getBlock("latest")).timestamp >= start) break;
      if (i >= 30) throw new Error("The local chain's clock did not reach the voting start time.");
    }
    console.log("Voting is open on the chain.");
  }

  const adminKey = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^ADMIN_API_KEY=(.*)$/m)[1];
  console.log("\n==================== DEMO READY ====================");
  if (simple) {
    console.log("Vote page  : http://localhost:3000/simple.html   <- pick a voter ID and press a Vote button");
    console.log("The election is OPEN for 24 hours.");
    console.log("Count the votes later with:  node scripts/admin.js warp 90000  then  node scripts/admin.js close");
    console.log("  node scripts/tally.js --shares ceremony/trustee-1.share.json,ceremony/trustee-2.share.json --demo-passphrases");
    console.log("Press Ctrl+C to stop everything.\n");
    return;
  }
  console.log("Voter page : http://localhost:3000/");
  console.log("Admin page : http://localhost:3000/admin.html");
  console.log("Admin key  :", adminKey, "(local demo only)");
  console.log("\nMock citizens (these are fake; the OTP is shown on screen in demo mode):");
  const list = JSON.parse(fs.readFileSync(path.join(root, "data", "mock-uidai.json"), "utf8"));
  list.forEach((c, i) => console.log(`  ${c.aadhaar}  ${i < onRoll ? "on the electoral roll" : "NOT on the roll (will be refused a token)"}`));
  console.log("\nThe election is NOT open yet. Open it from the admin page, or run:");
  console.log("  node scripts/admin.js open " + onRoll + " 5 3600     (starts in 5 s, lasts 1 hour)");
  console.log("Useful: node scripts/admin.js tick | warp <seconds> | close | status");
  console.log("Press Ctrl+C to stop everything.\n");
}

main().catch((e) => { console.error(e.message); stopAll(); process.exit(1); });
