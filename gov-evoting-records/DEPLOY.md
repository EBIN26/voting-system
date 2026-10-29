# Going live: Sepolia and the cloud

This folder (`gov-evoting-live`) is a copy of the working project with two additions: it can deploy the
election to **Sepolia** (Ethereum's Proof of Stake test network) and run the server in the **cloud**.
Sepolia ETH is free test money with no real value.

Run every command from `D:\claude\test-voting\gov-evoting-live` in PowerShell.

## What you need

| Need | Cost | Notes |
|---|---|---|
| Sepolia test ETH | Free | From a "faucet" website, about 0.25 ETH in total |
| A Sepolia RPC address | Free | The default public node works. A free key from Alchemy or Infura is more reliable (set `SEPOLIA_RPC_URL`) |
| A small Linux server with Docker | Free tier or student credit | 1 GB RAM is enough. Open ports 80 and 443 |
| A domain name pointing at the server | Free | A free name from duckdns.org works. HTTPS is required, so a plain IP address will not work |
| Etherscan API key (optional) | Free | Only to publish the contract source |

## Part A: Deploy the contract to Sepolia (on your computer)

**1. Install packages** (first time only):
```powershell
npm install
```

**2. Create the five wallets** (admin, submitter, three trustees). Keys are stored only in `live\wallets.json` and never printed:
```powershell
npm run live:wallets
```
It prints five addresses and how much test ETH each needs.

**3. Fund them.** Search the web for "Sepolia faucet", request test ETH for each address, then check:
```powershell
npm run live:balances
```
Every line must say `ok`. The submitter needs the most because it pays for every ballot.

**4. Run the key ceremony.** For a real run, each trustee types their own passphrase privately, and each keeps their own `trustee-N.share.json` file:
```powershell
node scripts/ceremony.js
```
For a quick demo only (public passphrases, protects nothing), add `--demo-passphrases`.

**5. Practise first (free, optional).** This rehearses the deployment on your local test chain and costs nothing. Start the chain with `npm run node` in a second terminal, then give your wallets play-money on it and deploy there:
```powershell
npm run live:fund-local
```
```powershell
$env:ALLOW_ANY_CHAIN = "1"; npm run live:rehearse
```
When you are done practising, delete the `live` folder and create the real wallets fresh with step 2.

**6. Deploy to Sepolia:**
```powershell
npm run live:deploy
```
It prints the contract address and an Etherscan link, and writes `live\deployment.json` and `live\server.env`.

**7. Publish the source (optional).** Needs `ETHERSCAN_API_KEY` set. Replace `ADDRESS` with the contract address:
```powershell
npx hardhat verify --network sepolia --constructor-args live/verify-args.js ADDRESS
```

## Part B: Run the server in the cloud

**8. Build the bundle.** It collects only what the server needs and refuses to finish if any admin or trustee key is inside:
```powershell
npm run live:bundle
```

**9. Prepare the server.** Create a Linux VM with Docker, open ports 80 and 443, and point your domain at its address. [CLOUD-SETUP.md](CLOUD-SETUP.md) walks through this step by step with a free student account.

**10. Copy the folder `live\cloud-bundle` to the server** (for example with `scp` or WinSCP). Copy that folder only, never this whole project.

**11. On the server, set your domain.** Edit the `.env` file in the bundle so it reads `SITE_ADDRESS=your-domain.example.com`.

**12. Start it.** The first start also creates five fake demo voters:
```bash
docker compose up -d --build
```
Show their IDs with `docker compose logs app`. Four are on the electoral roll, so the election must be opened for 4 voters.

**13. Open the election (on your computer).** Voting opens in 2 minutes and stays open for 30. Sepolia runs in real time, so there is no skipping ahead:
```powershell
node scripts/admin.js --live open 4 120 1800
```

**14. Vote.** Open `https://your-domain/simple.html`. Each vote takes about 15 to 30 seconds to confirm, because it waits for a real Sepolia block. Check the transaction on Etherscan.

**15. Close and count.** After the voting window ends:
```powershell
node scripts/admin.js --live close
```
```powershell
node scripts/tally.js --live --shares ceremony/trustee-1.share.json,ceremony/trustee-2.share.json --publish-key published-election-private-key.pem
```
```powershell
node scripts/submit-tally.js --live --trustee 1
```
```powershell
node scripts/submit-tally.js --live --trustee 2
```
```powershell
node scripts/verify-tally.js --live --key published-election-private-key.pem
```
With real passphrases the tally command asks for them. With demo passphrases, add `--demo-passphrases` to it.

## What stays where

| File | Where it may be | Why |
|---|---|---|
| `live\wallets.json` | Your computer only | Holds the admin and trustee keys |
| `ceremony\trustee-N.share.json` | Each trustee only | Two together can decrypt every vote |
| `live\server.env` | Your computer and the server | Holds only the submitter key |
| `live\cloud-bundle` | The server | Built to contain no admin or trustee key |

## Things to know

- **Cost:** one ballot uses about 417,000 gas, which is a tiny fraction of an ETH on Sepolia.
- **Speed:** the server sends one transaction at a time, so it handles roughly 4 to 5 votes per minute. Enough for a demo, not for a real election.
- **The database must persist.** It lives in the Docker volume `evoting-data`. If it is lost, a voter could be issued a second token.
- **The demo features are on:** the one-click page and the on-screen OTPs (`SIMPLE_VOTING` and `SHOW_DEMO_OTP` in `server.env`). They exist only to demonstrate the system, so keep the address unlisted.
- **Free hosting that forgets files** (such as a free web service tier) is a poor fit, because it would lose the database on every restart.

## Troubleshooting

| Problem | Fix |
|---|---|
| `has too little ETH to deploy` | Fund the admin wallet and run `npm run live:balances` |
| `Connected to chain ..., not Sepolia` | Use `npm run live:deploy`, which targets Sepolia |
| `already exists` when creating wallets | Intentional. Delete the `live` folder only if you are sure nothing was funded or deployed |
| The page loads but nothing works over plain `http://` | HTTPS is required. Use a domain with the bundled Caddy server |
| `Voting is not open` right after opening | Wait for the start time you set (it is in real time on Sepolia) |
| Slow or failing RPC calls | Use your own free RPC key and set `RPC_URL` in `server.env` and `SEPOLIA_RPC_URL` on your computer |
