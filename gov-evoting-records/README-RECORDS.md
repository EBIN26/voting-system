# Sealed vote records (admin only, after the election)

This copy of the project adds one feature requested by the staff: every vote also produces a **record**
of `voter ID -> candidate + symbol`, which only the **admin** can read, and only **after the election ends**.

## Important: this changes the privacy promise

The ballots on the blockchain are still anonymous. But these records **link each voter to their choice**,
so the admin can see how every voter voted after the election. The project is therefore
"confidential from the public, auditable by the admin", not "anonymous to everyone".
Use **dummy voter IDs only**. Never put real voter IDs in this version.

## How it works

1. `records-keys.js` makes the admin's key pair. The **public** key goes to the server. The **private** key
   stays in `records-admin/` (protected by the admin's passphrase) and never goes to the server or the cloud.
2. When someone votes, the server builds the record (voter ID, candidate, symbol, transaction, time) and
   **seals it with the admin's public key straight away**. The database holds only sealed text it cannot read.
3. A timer on the server watches the contract. Only when the phase becomes `Closed` or `Finalized`
   does it copy all the sealed records to storage as one file. Before that, nothing is in storage.
4. The admin runs `read-records.js`. It refuses while the election is still running, asks for the
   passphrase, opens every record, and checks the numbers against the blockchain.

## Commands

| Command | What it does |
|---|---|
| `node scripts/records-keys.js` | Creates the admin key pair (asks for a passphrase). Add `--demo-passphrase` for a demo. |
| `npm run demo:simple` | Local demo with everything switched on (creates the admin key with the demo passphrase). |
| `node scripts/read-records.js` | Admin opens the records after the election. Options: `--csv file.csv`, `--storage folder`, `--demo-passphrase`. |

Settings (in `.env` or the environment): `RECORDS_PUBLIC_KEY_FILE`, `STORAGE_TYPE` (only `local` for now),
`STORAGE_DIR` (default `data/cloud-storage`), `CANDIDATE_SYMBOLS` (e.g. `Lotus,Hand,Sun`, one per candidate, in order),
`RECORDS_EXPORT_INTERVAL_MS`.

## Limits to state honestly

- "Only after the election ends" is enforced by when the file is written to storage and by the admin tool checking
  the contract. The admin holds the key, so an admin who got hold of the sealed records early could open them.
  Making that impossible would also need the trustees to release a key (not built).
- The record is saved after the ballot is on the chain. If the server crashed in between, the vote would count
  but its record would be missing. `read-records.js` shows the mismatch (records vs ballots on the blockchain).
- Records exist only in the one-button demo mode, where the server already sees the voter and choice.
- Storage is a local folder for now. Oracle Object Storage plugs into `backend/storage.js` next.
