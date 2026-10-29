# Anonymous Blockchain Voting

An Ethereum voting system where **nobody, including the server and the election admin, can tell how any voter voted**, yet only registered voters can vote, each only once, and anyone can verify the count.

Built on [Semaphore](https://semaphore.pse.dev) zero-knowledge proofs.

## How it works

| Step | Who | What happens |
|---|---|---|
| Setup | Admin | Deploys the contract with the candidate list and a registrar address. |
| Codes | Admin | `issue-codes` makes one-time codes; each is handed to one verified person. |
| Register | Voter | Browser creates a secret identity and sends only its public *commitment* plus the code. |
| Close registration | Admin | Server shuffles all commitments and puts them on-chain together; admin starts voting. |
| Vote | Voter | Browser builds a ZK proof ("I am in the group and haven't voted") bound to the chosen candidate; the relayer submits it. |
| Results | Anyone | After the deadline anyone can finalise; the tally is on-chain and verifiable. |

**Why it is anonymous:** the proof shows membership without revealing which member. The server only ever sees a proof, never an identity. Codes and commitments are stored separately, with no timestamps, and are shuffled before going on-chain.

**Why it is safe:** the contract rejects invalid proofs, reused nullifiers (double votes), out-of-range candidates, altered candidates, votes outside the window, and any registration after voting starts.

## Keys

- **Admin key**: starts voting. Never put it on the server (the server refuses to start if it is configured as relayer/registrar).
- **Registrar key** (server): can only add voter commitments, only during registration.
- **Relayer key** (server): submits votes and pays gas; cannot change any vote.

## Run it locally

```bash
npm install
npm test                     # 13 contract tests with real ZK proofs
npm run node                 # terminal 1: local chain
npm run deploy               # terminal 2: deploys and writes .env (local test keys)
npm run build:frontend
node scripts/issue-codes.js 5
npm start                    # serves the app on http://127.0.0.1:3000
```

Then:

1. Voters open the site and register with their codes.
2. Commit registrations (needs ADMIN_API_KEY from `.env`):
   `curl -X POST -H "x-admin-api-key: <key>" http://127.0.0.1:3000/api/admin/registration/commit`
3. Start voting: `node scripts/admin.js start 3600`
4. Voters vote in the browser.
5. After the deadline (locally: `node scripts/admin.js warp 3700`) anyone clicks **Finalise**.

`scripts/simulate-voters.js` can play extra voters for testing.

## Honest limits

- **Registration is the trust point.** The registrar can add fake voters; check `registeredCount` against your real voter roll. Verify identities properly before issuing codes.
- **Small groups are not anonymous.** Use many voters; the server enforces a minimum (`MIN_VOTERS`).
- **Interim results are not secret on a public chain**, because contract storage is readable. Use a permissioned chain or an encrypted tally if that matters.
- **Network metadata:** the relayer hides voters' addresses but not their IPs from your network operator. Use Tor/VPN and put the server behind TLS (set `TRUST_PROXY`).
- **Voters' devices:** malware or a shared computer can leak the identity backup.
- **Not audited.** Get an independent security audit before any real election.
