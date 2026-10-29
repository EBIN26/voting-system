# Oracle Cloud server setup (Always Free VM)

This replaces the Azure guide ([CLOUD-SETUP.md](CLOUD-SETUP.md)) for the Oracle VM. It assumes an **Ubuntu** image
and the VM's public IP address (the examples use `129.225.94.68`; use yours). On Oracle's Ubuntu images the login
name is `ubuntu`. On Oracle Linux it is `opc` and the install commands differ, so use Ubuntu.

Order matters: finish **Part A on your computer** (contract on Sepolia, bundle built) before Part D.

## Part A: Prepare on your computer (once)

Run in PowerShell from `D:\claude\test-voting\gov-evoting-live`. Details are in [DEPLOY.md](DEPLOY.md).

```powershell
npm install
npm run live:wallets
npm run live:balances
node scripts/ceremony.js --demo-passphrases
npm run live:deploy
npm run live:bundle
```

Between `live:wallets` and `live:balances`, get Sepolia test ETH for every printed address from a faucet.
`--demo-passphrases` is for a demo only. The ceremony must come before the deploy, because the key hash goes into the contract.

## Part B: Open the network (Oracle console)

1. **DuckDNS:** at duckdns.org add a domain (for example `myvote-demo`) and set its **current ip** to the VM's public IP.
2. **Open ports 80 and 443:** Networking, Virtual cloud networks, your VCN, the public subnet, **Default Security List**, **Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

Port 22 (ssh) is already open in the default list.

3. **The IP address is ephemeral.** If you stop the VM it may change. Re-update DuckDNS if it does. A reserved public IP
   (Networking, IP management) keeps it fixed, if your account allows one.

## Part C: Connect and prepare the server

From PowerShell (replace the key path; it is the private key you downloaded when creating the VM):

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@129.225.94.68
```

If Windows says the key is "too open":

```powershell
icacls C:\path\to\ssh-key.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

On the server, open the ports in the VM's own firewall. Oracle's Ubuntu image blocks them by default:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 7 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Add 2 GB of swap (the VM has only 1 GB of memory):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Docker, then log out and back in:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Reconnect and check:

```bash
docker compose version
free -h
```

## Part D: Copy the bundle and start the server

On your computer (a new PowerShell window). Copy **only** the bundle folder:

```powershell
scp -i C:\path\to\ssh-key.key -r D:\claude\test-voting\gov-evoting-live\live\cloud-bundle ubuntu@129.225.94.68:~/voting
```

On the server:

```bash
cd ~/voting
echo "SITE_ADDRESS=myvote-demo.duckdns.org" > .env
docker compose up -d --build
```

The first build is slow on this small VM (about 5 to 15 minutes). Watch it and check it started:

```bash
docker compose logs -f app
```

The logs print the five fake voter IDs once (four are on the roll). Then open `https://myvote-demo.duckdns.org/simple.html`.
The padlock appears once Caddy has its certificate (up to a minute or two).

## Part E: Run the election (on your computer)

```powershell
node scripts/admin.js --live open 4 120 1800
```

Voting opens in 2 minutes and stays open for 30. Press Vote on the site; each vote takes about 15 to 30 seconds on Sepolia.
After the window ends, close and count with the commands in DEPLOY.md, step 15.

## If something goes wrong

| Problem | Fix |
|---|---|
| `Connection timed out` on ssh | Check the VM is Running, the IP is right, and port 22 is in the security list |
| Browser cannot reach the site | Check the security list (80, 443), the iptables rules, and that DuckDNS has the current IP |
| Certificate error | The domain does not point at the VM yet, or ports 80/443 are closed. Caddy retries automatically |
| Build stops with "killed" | Out of memory. Check `free -h` shows the swap, then run `docker compose up -d --build` again |
| `docker: permission denied` | Log out and back in after the `usermod` command |
| Site loads but voting fails | Check `docker compose logs app`, and that the submitter wallet has Sepolia ETH |
| IP changed after a restart | Update DuckDNS with the new IP |

## Safety

- Copy only `live\cloud-bundle`. Never copy `live\wallets.json` or any `trustee-N.share.json`.
- Do not delete the `evoting-data` Docker volume while an election is running.
- The demo page is for showing the system. Keep the address unlisted.
