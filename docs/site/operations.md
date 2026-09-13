# Operations

Running SignalProof: configuration, worker modes, deployment, the ops panel, and what to do when something looks wrong.

## Configuration

Everything is read from the environment (`.env` in development, host secrets in production). `.env.example` is pre-filled with the public testnet deployment so a clone reads live data with no key.

### Chain

| Variable | Required for | Notes |
|---|---|---|
| `SEPOLIA_RPC_URL` | reads, relaying | Default `https://sepolia.gateway.tenderly.co`. PublicNode answered half of identical log queries with `[]` during the build; the server defends against that, but a consistent endpoint is the first line |
| `CREDITCOIN_RPC_URL` | reads, settling | `https://rpc.cc3-testnet.creditcoin.network`. The app refuses to start on Devnet (102032) or Mainnet (102030) |
| `SOURCE_BATCH_REGISTRY_ADDRESS`, `SOURCE_BATCH_REGISTRY_DEPLOY_BLOCK` | reads | Scanning starts at the deploy block; a fixed 40,000-block lookback is the fallback |
| `RETIRED_REGISTRIES` | reads | `address:deployBlock,…` — earlier registries whose history is still shown |
| `SETTLEMENT_CONTRACT_ADDRESS`, `SETTLEMENT_DEPLOY_BLOCK` | reads, settling | Single-proof route |
| `BATCH_SETTLEMENT_ADDRESS`, `BATCH_SETTLEMENT_DEPLOY_BLOCK` | reads, settling | Batch route; optional |
| `ATTESTCOIN_CHAIN_KEY` | cross-check only | The app resolves the key at startup from `ChainInfo` and warns on disagreement; never trust a hardcoded value |
| `ATTESTCOIN_PROOF_SERVICE_URL` | proofs | `https://prover.cc3-testnet.creditcoin.network` |
| `SEPOLIA_RELAYER_PRIVATE_KEY` | relaying | Funded burner; the registry only accepts this address |
| `CREDITCOIN_RELAYER_PRIVATE_KEY` | settling | Funded burner (CTC from the Discord faucet: `#token-faucet` → `/faucet`) |
| `DEPLOYER_PRIVATE_KEY` | deploy scripts only | Never read by the server |

### Behaviour

| Variable | Default | Effect |
|---|---|---|
| `PROOF_WORKER_MODE` | `full` | `relay-only` relays to Sepolia but never settles; contributors settle from their own wallet. Any other value is treated as `full` so a typo cannot silently stop settlement |
| `DATABASE_URL` | unset | MySQL for persistence across restarts; without it an in-memory store keeps the same uniqueness rules |
| `PORT` | `3000` | Fly and Render inject their own |
| `BUYER_ACCESS_SECRET` | unset | HMAC secret for API keys; unset (and no `JWT_SECRET`) leaves every `/v1` endpoint open |
| `BUYER_ACCESS_PRICE_CTC` | `0.05` | Price of a key, paid into the reward pool |
| `BUYER_ACCESS_DAYS` | `30` | Key validity |

### Scaffold (unused by SignalProof)

`JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_*` belong to the OAuth login scaffold the project started from. Every SignalProof procedure is public and the wallet is the only identity; leaving these unset logs one informational line at boot and nothing else.

## Readiness states

`integrationStatus` (and the sidebar's *Protocol rail* card) reports one of:

| State | Meaning |
|---|---|
| **Attestcoin ready** | Relayer and proof worker running (`proofWorkerReady`) |
| **Relayer only — proof worker off** | Sepolia key present, Creditcoin side incomplete |
| **Read-only — no relayer key** | Both chains and contracts configured, no keys: dashboard, proof inspector and buyer API work; nothing can be submitted |
| **Chain not configured** | Addresses or RPCs missing |
| **Relay only — settle from your wallet** | `PROOF_WORKER_MODE=relay-only` |

## The worker

One in-process loop on a 15 s tick. Each tick: relay `SUBMITTED` rows to Sepolia; read the attested height once; fetch proofs for rows whose block is attested; group rows sharing a continuity proof into `executeBatch` (max 50) and settle the rest singly; every 20 ticks reconcile against chain state so a row is never left `AWAITING_ATTESTATION` after it was paid. Transient failures back off exponentially per row; a permanent revert marks the row `REJECTED` with a machine-readable code (`SOURCE_TX_FAILED`, `WRONG_EMITTER`, `MEASUREMENT_IN_FUTURE`, `MEASUREMENT_TOO_OLD`, …).

## Ops panel (`/ops`)

Reads `signalproof.ops`: relayer balances on both chains, the reward pool balance and its **runway** in settlements at the current reward, worker health (last tick, consecutive failures), snapshot health (age, source), attestation lag versus the Sepolia head, and RPC reachability. Every field is live; a stale snapshot is labelled stale.

## Deployment

```bash
docker build -t signalproof .
docker run --rm -p 3000:3000 --env-file .env signalproof
```

- **Fly.io** — `fly launch --copy-config --no-deploy`, `fly secrets set` the chain variables, `fly deploy`. `fly.toml` keeps one machine always on (the worker must keep ticking) and health-checks `/api/trpc/signalproof.integrationStatus`.
- **Render** — connect the repo as a Blueprint (`render.yaml`); set the addresses and keys as environment variables.
- Any host: Node 22, `pnpm build`, `node dist/index.js`. The production bundle does not import Vite.

Geolocation on phones requires HTTPS; both hosts provide it.

## Runbook: things that look like bugs and are not

| Symptom | Cause | What to do |
|---|---|---|
| Header says LIVE, sidebar says "Read-only — no relayer key" | Keyless clone | Expected; add relayer keys to submit |
| "Your browser reported ±1,019,966 m, which is coarser than one area cell" | Desktop without Wi-Fi location fell back to IP geolocation | Phone over HTTPS, enable location services, or Chrome DevTools → Sensors |
| "Rabby Wallet rejected the connection request" when you meant MetaMask | Several wallet extensions; the header now asks which one | Pick the wallet in the header; the choice is remembered |
| Measurement stuck at `SUBMITTED` | No relayer key, or a Sepolia RPC that hangs batched sends | Check `/ops`; the server already sends one request per call |
| `AWAITING_ATTESTATION` for more than 15 minutes | Attestation lag is high, or the proof service is slow | `pnpm smoke` prints the lag; the proof inspector says "not attested yet" with the countdown |
| "Rate limited" on the fourth test | 3 per wallet per cell per 10 min | Second wallet or another cell |
| Dashboard flips to "Prototype mode" | A public RPC returned an empty log set | The read model retries and never shrinks a served snapshot; switch to a steadier endpoint if it persists |
| Settlement from the wallet fails with "Query already processed" | The relayer settled first | Nothing to do; nothing was paid twice |

## Verifying a deployment

```bash
pnpm verify                                   # tsc + vitest + forge test
pnpm smoke                                    # Attestcoin read path, keyless
pnpm e2e:live                                 # one measurement through both chains, ~10 min, needs keys
pnpm e2e:batch                                # three measurements, one continuity proof
pnpm e2e:surface                              # buyer access, verifier, area page, ops — against a running server
curl -s https://<host>/api/trpc/signalproof.integrationStatus
```
