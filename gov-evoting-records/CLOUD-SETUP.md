# Free cloud server for a student: Azure for Students

This guide creates the server that Part B of [DEPLOY.md](DEPLOY.md) needs. It uses **Azure for Students**:
no credit card, a $100 credit valid for 12 months, and a small Linux server is enough for this project.
Check the current terms at azure.microsoft.com/free/students before you sign up, because free offers change.

You do the account steps yourself (signing up, choosing a password). Nothing here needs a card.

## Step 1: Get a free domain name (DuckDNS)

1. Go to **duckdns.org** and sign in with a Google or GitHub account.
2. In the "domains" box type a name, for example `myvote-demo`, and click **add domain**. Your address is now `myvote-demo.duckdns.org`.
3. Leave the IP address empty for now. You fill it in at Step 4.

## Step 2: Create the Azure for Students account

1. Go to **azure.microsoft.com/free/students**.
2. Sign in with a Microsoft account and verify that you are a student using your **college email address** (not a work or personal one).
3. You should get $100 of credit without entering a card.

If your college email is not accepted, use the fallback at the end of this guide.

## Step 3: Create the server (virtual machine)

1. In the Azure portal search for **Virtual machines** and click **Create**, then **Azure virtual machine**.
2. Fill in:

| Setting | Value |
|---|---|
| Subscription | Azure for Students |
| Resource group | Create new: `voting-rg` |
| Virtual machine name | `voting-vm` |
| Region | The nearest one that lets you pick a size (for example Central India or South India). If no size is available, try another region |
| Image | **Ubuntu Server 24.04 LTS** |
| Size | **Standard_B1s** (1 vCPU, 1 GiB memory). It is the cheapest and is enough |
| Authentication type | **SSH public key**, and let Azure generate a new key pair |
| Username | `azureuser` |
| Public inbound ports | Allow selected ports: **SSH (22), HTTP (80), HTTPS (443)** |

3. Click **Review + create**, then **Create**. When asked, **download the private key file** (`.pem`) and keep it safe: it is your only way in.
4. When the deployment finishes, open the machine and copy its **Public IP address**.

## Step 4: Point your domain at the server

Back on duckdns.org, put the public IP address into your domain's **current ip** box and click **update ip**.

## Step 5: Connect to the server from your computer

In PowerShell, replace the two parts in capitals:

```powershell
ssh -i C:\path\to\voting-vm_key.pem azureuser@PUBLIC_IP
```

If Windows says the key file is "too open", restrict it with this (once):

```powershell
icacls C:\path\to\voting-vm_key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

The first time, type `yes` to trust the server. Your prompt then changes to `azureuser@voting-vm`.

## Step 6: Prepare the server (these commands run on the server)

Add 2 GB of extra memory (swap), because the server only has 1 GB:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Let your user run Docker, then log out and back in so it takes effect:

```bash
sudo usermod -aG docker $USER
```
```bash
exit
```

Connect again with the `ssh` command from Step 5, then check:

```bash
docker compose version
```

## Step 7: Copy the bundle to the server

On **your computer** (a new PowerShell window), after `npm run live:bundle` has built `live\cloud-bundle`:

```powershell
scp -i C:\path\to\voting-vm_key.pem -r D:\claude\test-voting\gov-evoting-live\live\cloud-bundle azureuser@PUBLIC_IP:~/voting
```

Copy that folder only. Never copy the whole project, and never copy `wallets.json` or any `trustee-N.share.json`.

## Step 8: Start the election server (on the server)

```bash
cd ~/voting
```

Set your domain (replace `myvote-demo.duckdns.org` with yours):

```bash
echo "SITE_ADDRESS=myvote-demo.duckdns.org" > .env
```

Build and start it. The first build takes about 3 to 6 minutes:

```bash
docker compose up -d --build
```

Show the five fake demo voter IDs and check that it started:

```bash
docker compose logs app
```

Then open `https://myvote-demo.duckdns.org/simple.html` in your browser. A padlock appears once Caddy has its free HTTPS certificate, which takes up to a minute.

## Step 9: Look after your credit

- A small always-on server, its disk and its public address use up the $100 credit over several months. Watch the balance under **Cost Management** in the portal, because the exact monthly cost depends on the region.
- To save credit, **Stop** the virtual machine in the portal when you are not using it. Its address stays the same.
- When the credit ends or you are finished, **delete the resource group** `voting-rg` so nothing keeps running.

## If something goes wrong

| Problem | Fix |
|---|---|
| `Permission denied (publickey)` | Use the `.pem` file Azure gave you and the username `azureuser` |
| The browser shows a certificate error | The domain does not point at the server yet (Step 4), or ports 80 and 443 are closed. In the portal open the machine's **Networking** page and check that both are allowed |
| The build stops with "killed" or out of memory | Check the swap from Step 6 is on with `free -h`, then run the `docker compose` command again |
| "No size available" when creating the machine | Choose a different region |
| `docker: permission denied` | Log out and back in after Step 6 |

## If your college email is not accepted

- **GitHub Student Developer Pack** (education.github.com/pack): verify with your college ID, then use the DigitalOcean credit for a small server. Steps 4 to 9 are the same.
- **Oracle Cloud Always Free:** a small free server, but it needs a card for identity checks. Oracle reduced its free offer in 2026, though the two small 1 GB servers were reported as unchanged.
