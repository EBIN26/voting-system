# Oracle Object Storage for the sealed vote records

The server saves the sealed vote records to a **private** Oracle bucket, **only after the election ends**.
It does this with a **write-only link**: the server holds no Oracle login and no key, and the link cannot
list, read or delete anything. The **admin** downloads the file from the Oracle console with their own login,
then opens it with their own passphrase.

Menu names in the Oracle console change now and then. If a name differs slightly, look for the closest one.

## Part 1: Create the private bucket (once)

1. Sign in to the Oracle Cloud console.
2. Open the menu (top left), then **Storage**, then **Buckets** (under *Object Storage & Archive Storage*).
3. Check the **Compartment** on the left (use the same one as the server).
4. Click **Create bucket** and fill in:
   - **Bucket name:** `election-records`
   - **Default storage tier:** Standard
   - **Enable Object Versioning:** tick it. It keeps older copies if a file is ever overwritten.
   - **Encryption:** leave "Encrypt using Oracle managed keys".
5. Click **Create**. The bucket is **Private** by default. Never change it to Public.

## Part 2: Create the write-only link (after you deploy the contract)

The records file has a fixed name that depends on the contract. On your computer, in the project folder:

```powershell
npm run records:name
```

It prints something like `vote-records-0x1239...f59877.json`. Copy it exactly.

In the console:

1. Open the bucket `election-records`, then **Pre-Authenticated Requests**, then **Create Pre-Authenticated Request**.
2. Fill in:
   - **Name:** `server-upload`
   - **Pre-Authenticated Request Target:** **Object**
   - **Object name:** paste the name printed above (this limits the link to that one file)
   - **Access Type:** **Permit object writes**
   - **Expiration:** a date after your election ends (for example, 7 days from now)
3. Click **Create**, then **copy the URL now**. Oracle shows it only once.

The URL is a secret. Do not paste it in chat, in a report, or in a file you share. Anyone with it can write
that one file.

## Part 3: Test the link (before the election)

On your computer (PowerShell, in the project folder):

```powershell
$env:STORAGE_PAR_URL = "PASTE_THE_URL_HERE"
```

```powershell
npm run records:test-upload
```

It prints `Uploaded "vote-records-0x....json"`. In the console, open the bucket and check that the file is
there. (The real records file will replace this test file when the election ends. With versioning on, the test
copy stays as an old version.)

If it fails with `HTTP 403` or `404`: the link expired, the object name is wrong, or you chose a different
access type. Create a new link.

## Part 4: Give the link to the server

Build the bundle as usual (`npm run live:bundle`) and copy it to the server. Then, **on the server**:

```bash
cd ~/voting && nano server.env
```

Find the line `STORAGE_PAR_URL=` and paste the link after the equals sign, with no spaces or quotes.
Save (Ctrl+O, Enter, Ctrl+X). Start the server:

```bash
docker compose up -d --build
```

If the server was already running, recreate it so it reads the new setting:

```bash
docker compose up -d --force-recreate app
```

Check the log says where records will go, and that it does **not** print the link:

```bash
docker compose logs app | grep -i "records"
```

## Part 5: After the election (the admin)

1. The election ends and someone closes it. Within about 10 to 20 seconds the server uploads the file.
2. In the Oracle console, open the bucket, find `vote-records-0x....json`, click the three dots and **Download**.
3. On the admin's computer (the one that has `records-admin/admin-private-key.json`):

```powershell
node scripts/read-records.js --live --file D:\Downloads\vote-records-0xYOURCONTRACT.json
```

It asks for the admin passphrase, prints who voted for whom, and compares the totals with the blockchain.
Add `--csv records.csv` to save a spreadsheet.

## Who can read what

| Who | Can see |
|---|---|
| The server | Can write that one file. **Cannot read it, list the bucket, or delete anything.** |
| Someone who steals the link | Can write the one file (it cannot read). Versioning keeps the older copy. |
| Someone who opens the file | Sees only sealed text. Needs the admin's private key and passphrase to read it. |
| The admin | Downloads with their Oracle login, then opens with the admin key and passphrase. |
| The public | Nothing. The bucket is private. |

Give the Oracle console login only to the people who should see the file. If staff other than the admin
have a login to this Oracle account, restrict the bucket in IAM, or the file could be downloaded by them.
They still could not read it without the admin key.

## Limits to state honestly

- This has been tested against a **fake Oracle server** on the development computer, not against a real bucket
  yet. The test upload in Part 3 is the first real check.
- If the upload fails, the server keeps the records in its database and **retries every 10 seconds** until it works,
  so keep the server running until the file appears.
- If the server's database volume is deleted before the upload, the sealed records are lost.
- "Only after the election ends" is enforced by when the file is uploaded and by the admin tool checking the
  contract. See README-RECORDS.md.
