// Builds live/cloud-bundle/: everything the cloud server needs, and NOTHING secret beyond the
// submitter key that the server must hold. Copy that folder to the server (not this project).
//
//   npm run live:bundle
const fs = require("node:fs");
const path = require("node:path");
const { liveDir, wallets, deployment } = require("./lib/live");

const root = path.resolve(__dirname, "..");
const out = path.join(liveDir(), "cloud-bundle");

function copy(rel, filter) {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) throw new Error(`Missing ${rel}`);
  fs.cpSync(from, path.join(out, rel), { recursive: true, filter });
}

function main() {
  const d = deployment();
  if (!d) throw new Error("Deploy first: npm run live:deploy");
  const serverEnv = path.join(liveDir(), "server.env");
  const keyFile = path.join(root, "ceremony", "election-public-key.pem");
  if (!fs.existsSync(serverEnv)) throw new Error("live/server.env is missing. Run: npm run live:deploy");
  if (!fs.existsSync(keyFile)) throw new Error("ceremony/election-public-key.pem is missing. Run the key ceremony.");

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const f of ["Dockerfile", ".dockerignore", "docker-compose.yml", "Caddyfile", "package.json", "package-lock.json"]) copy(f);
  copy("backend");
  copy("lib");
  copy("scripts/seed-mock.js");
  copy("scripts/lib/cli.js");
  // Source for the pages; the image builds the bundles itself.
  copy("frontend", (src) => !/[\\/]public[\\/][^\\/]+\.js$/.test(src));
  copy("artifacts/contracts/GovElection.sol/GovElection.json");

  fs.copyFileSync(serverEnv, path.join(out, "server.env"));
  fs.copyFileSync(keyFile, path.join(out, "election-public-key.pem"));
  fs.writeFileSync(path.join(out, ".env"), "# Your domain name, with no https:// in front. It must point at this server.\nSITE_ADDRESS=your-domain.example.com\n");

  // Last line of defence: no admin or trustee key, and no key share, may be in the bundle.
  const w = wallets();
  const forbidden = [w.admin.privateKey, ...w.trustees.map((t) => t.privateKey)].map((k) => k.toLowerCase());
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(out)) {
    if (/wallets\.json$|\.share\.json$|tally\.json$|published-.*\.pem$/i.test(file)) throw new Error(`Secret file in bundle: ${file}`);
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    for (const k of forbidden) if (text.includes(k.slice(2))) throw new Error(`A private key leaked into the bundle: ${file}`);
  }

  console.log(`Cloud bundle ready: ${out}\n`);
  console.log("Copy THAT folder to your server, edit .env (your domain), then run:  docker compose up -d --build");
  console.log(`Contract: ${d.contract} on chain ${d.chainId}`);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
