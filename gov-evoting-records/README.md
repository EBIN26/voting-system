# Government e-voting prototype (blockchain)

Modules built so far:

| Module | Where |
|---|---|
| 1 Registration (Aadhaar OTP, **mock**) | `backend/app.js`, `backend/uidai-mock.js` |
| 2 Authentication (OTP login, short session) | `backend/app.js` |
| 3 Voter verification + single-use voting token | `backend/app.js`, `backend/db.js` |
| 5/6 Blockchain ledger + trustee-verified results | `contracts/GovElection.sol` |

| 4 Ballot encryption (library, runs in Node and browsers) | `lib/ballot.js` |
| Key ceremony, trustee tally and public verification | `lib/`, `scripts/ceremony.js`, `tally.js`, `submit-tally.js`, `verify-tally.js` |

| Voter web app (register, OTP login, encrypt in browser, vote, receipt) | `frontend/` (`npm run build:frontend`), served by the backend |

| Admin page (monitor turnout, open and close the election, show results) | `frontend/src/admin.js`, served at `/admin.html` |

All modules of the design are now built. What remains is production work: a real UIDAI/AUA adapter, a real SMS
gateway, hosting with TLS, and an independent security audit.

## Admin page (`/admin.html`)

- **Monitoring** needs the admin API key (kept in page memory only). It shows turnout, the registration funnel
  (roll, registered, tokens issued, ballots recorded) and consistency checks, such as "voter limit equals roll size".
  These are counts only; nothing links a ballot to a voter.
- **Opening the election** is signed in the browser by the **administrator's own wallet** (MetaMask or similar).
  The admin key never touches the server. The page checks the key hash, the roll size and that the wallet is the
  contract admin on the right network, then asks for an explicit confirmation before signing.
- **Closing** is available to anyone once the end time has passed (the contract enforces it); the server pays gas.
- **Counting** shows how many trustees have submitted matching tallies. **Results** appear only once final, and are
  also shown on the voter page.
- Local demo without a wallet extension: start the server with `DEV_RPC_PROXY=1`. It forwards `eth_*` calls to the
  local test chain only, and the server refuses to start with it in production or on any other chain.

## Voter web app

Open `http://127.0.0.1:3000` after `npm start`. For a demo with no SMS gateway, start the server with
`SHOW_DEMO_OTP=1` (refused in production): the OTP then appears on screen.

- The page loads no third-party code, fonts or images, and has no inline scripts or styles (strict CSP).
- The browser checks that the election public key matches the fingerprint it is shown before encrypting.
- The ballot is encrypted in the browser; the login session is dropped as soon as the voting token is issued, and the
  cast request carries only the token and the encrypted ballot.
- The voting token is saved in the browser before anything else, with a downloadable backup and a "resume" path.
- The receipt is a hash of the token. It proves a ballot was recorded, not how the voter voted (no vote-selling receipt).

## Key ceremony and results

The ballot is encrypted in the voter's browser to an **election public key**. The matching private key is
split among the trustees (Shamir), so no single person can read a vote.

1. **Before deployment:** `node scripts/ceremony.js --trustees 3 --threshold 2` on an offline computer with all
   trustees present. Each types their own passphrase. It writes `election-public-key.pem`, `key-hash.txt` and one
   passphrase-protected `trustee-N.share.json` per trustee. The contract is deployed with the key hash, and the
   backend refuses to start if the public key does not match it.
2. **After the election closes:** `node scripts/tally.js --shares a.json,b.json` (threshold trustees together).
   It refuses to run before the contract is closed, proves the rebuilt key matches the on-chain hash, decrypts
   every ballot and counts. Ballots that fail to decrypt count as invalid, never as a vote.
3. **Each trustee separately** submits the tally from their own wallet: `node scripts/submit-tally.js`.
   The contract finalises only when the threshold of trustees submit identical counts.
4. **Optional, recommended:** `--publish-key` on step 2 writes the now-useless election private key. Publish it and
   anyone can run `node scripts/verify-tally.js` to re-count the public ballots and check the official result.
   This is safe because ballots contain only a candidate number, never who cast them.

Ballots are bound to their election (contract address and chain id), have a fixed length (430 bytes) and
random padding, so copies cannot be replayed elsewhere and equal votes look different.

## Run locally

```bash
npm install
npm test                      # 20 contract tests + 46 backend/crypto tests
node scripts/ceremony.js --demo-passphrases   # demo key ceremony (public passphrases: never for real)
npm run node                  # terminal 1: local chain
npm run deploy                # terminal 2: deploy + write .env (local test keys)
npm run seed -- 4 3           # 4 mock citizens, 3 on the electoral roll
node scripts/admin.js open 3 5 3600   # 3 eligible voters, starts in 5s, lasts 1h
npm start                     # terminal 3: backend (OTPs print to this console)
```

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/register/start` `{aadhaar}` then `/verify` `{txnId, otp}` | register |
| `POST /api/auth/start` then `/verify` | log in, returns a 10-minute `session` |
| `POST /api/voting/token` (Bearer session) | verify eligibility, get a one-time voting `token` (shown once) |
| `POST /api/voting/cast` `{token, ballot}` | relay an encrypted ballot; needs no session |
| `GET /api/election`, `GET /api/admin/stats` | public info / admin counts |

## Privacy design

- No Aadhaar number, phone or biometric is stored. Voters are a keyed hash of UIDAI's reference token.
- `tokens` has no voter column and no timestamps; `voters.token_issued` is only a flag. The database cannot link a ballot to a person.
- Casting needs no login, so the ballot request carries no identity.
- The session ends when the token is issued.

## Known limits

- The mock Aadhaar service must be replaced by a real UIDAI/AUA adapter with the same interface.
- A voting token is shown once. If the response is lost, the voter cannot get another (re-issuing would require remembering who got which token). A real deployment needs a supervised recovery procedure.
- The server is trusted not to log or correlate token issuance with casting. For a guarantee that does not depend on that trust, use the zero-knowledge design in `secure-anon-voting`.
- Per-IP rate limits assume voters have different addresses; raise them for shared networks (`OTP_PER_MINUTE` etc.).
- A quiet local chain's clock lags; run `node scripts/admin.js tick` if votes are rejected right after the window opens.

## Live network and cloud

See [DEPLOY.md](DEPLOY.md) for deploying to Sepolia (a Proof of Stake test network) and running the server in the cloud with Docker.
