# Architecture

A measurement crosses four trust boundaries. None of the four parties that touch it — browser, gateway, relayer, worker — is trusted by the contract that pays for it.

## Components

```
┌───────────────────────────────┐
│ Browser client (React PWA)    │  measures; wallet signs the measurement (never a transaction
│                               │  except claim() and the optional self-settle)
└──────────────┬────────────────┘
               │ tRPC signalproof.submitMeasurement
               ▼
┌───────────────────────────────┐        ┌────────────────────────────┐
│ Gateway  server/routers.ts    │───────►│ Store: MySQL via drizzle,  │
│ policy · integrity · limiter  │        │ or in-memory fallback      │
└───────────────────────────────┘        └─────────────┬──────────────┘
                                                       │ SUBMITTED rows, 15 s tick
                                                       ▼
                                        ┌────────────────────────────┐
                                        │ Relayer  relayer.ts        │
                                        │ submitMeasurement(…, sig)  │──► SourceBatchRegistry (Sepolia)
                                        └─────────────┬──────────────┘
                                                      │ txHash, block
                                                      ▼
                                        ┌────────────────────────────┐
                                        │ Proof worker proofWorker.ts│
                                        │ attested height · getProof │──► SignalProofSettlement /
                                        │ execute / executeBatch     │    SignalProofBatchSettlement (CC3)
                                        └────────────────────────────┘

┌───────────────────────────────┐        logs from both chains
│ Read model  chainRead.ts      │◄──────────────────────────────── Sepolia + Creditcoin RPC
│ join by measurementRoot       │──► dashboard, /v1/* buyer API, verifier, contributors, ops
└───────────────────────────────┘
```

| Component | File(s) | Responsibility |
|---|---|---|
| Measurement client | `client/src/lib/measure.ts`, `hooks/useMeasurementRun.ts` | Take the measurement, build the canonical payload, ask the wallet to sign |
| Auto-measure | `client/src/components/AutoMeasure.tsx`, `shared/autoMeasure.ts` | Repeat the measurement every ten minutes while the tab is open; each cycle still signs |
| Gateway | `server/routers.ts` | Admission: policy, integrity, rate limit; public tRPC reads |
| Store | `server/signalproof/store.ts`, `drizzle/schema.ts` | Rows with pipeline columns; MySQL or memory |
| Relayer | `server/signalproof/relayer.ts` | `SUBMITTED` → Sepolia → `AWAITING_ATTESTATION` |
| Proof worker | `server/signalproof/proofWorker.ts`, `worker.ts` | Poll attestation, fetch proofs, settle singly or in batches, classify failures, reconcile with chain |
| Read model | `server/signalproof/chainRead.ts` | The snapshot every page and API reads; hardened against flaky RPCs |
| Buyer API | `server/signalproof/buyerApi.ts`, `areas.ts`, `areaExport.ts`, `access.ts`, `verify.ts` | `/v1/*` |
| Contracts | `contracts/src/*.sol` | Registry on Sepolia; two settlement routes on CC3 |

## Data flow of one measurement

1. The browser measures and derives `measurementRoot = keccak256(canonical payload)`; the wallet signs the EIP-191 message for that root and address.
2. `submitMeasurement` admits it (see [Concepts](concepts.md#admission-and-payment)) and stores a `SUBMITTED` row. The response is the public projection — it never echoes `signature`, `nonce` or `sessionHash`.
3. On the next 15 s tick the relayer calls `SourceBatchRegistry.submitMeasurement(root, area, contributor, session, timestamp, latency, download, signature)`. The registry recovers the signer, refuses a mismatch, and emits `MeasurementSubmitted`.
4. The worker reads the latest attested Sepolia height from Creditcoin's `ChainInfo` precompile once per tick. When the block is attested it fetches the inclusion + continuity proof from the Attestcoin proof service.
5. Rows whose proofs share an identical continuity proof settle together through `SignalProofBatchSettlement.executeBatch` (max 50); the rest settle singly through `SignalProofSettlement.execute`.
6. The settlement contract verifies through the BlockProver precompile, applies its own checks, accrues 0.001 CTC and emits `MeasurementVerified`.
7. The read model joins the two events; the dashboard, the buyer API and the verifier all read that join.

## The read model

`getOnchainSnapshot()` scans `MeasurementSubmitted` on the current registry from its deploy block and on any retired registries (`RETIRED_REGISTRIES`), and `MeasurementVerified` on every settlement route (current, batch, and retired siblings the batch contract names). It joins by `measurementRoot`, aggregates per area, and serves one snapshot to everything.

Defences that exist because public RPCs misbehaved during the build:

- An empty `eth_getLogs` answer is re-asked up to twice before it is believed (a public Sepolia endpoint answered half of identical calls with `[]`).
- A re-read that reports fewer measurements or settlements than the snapshot already served is discarded: logs on an append-only chain cannot disappear.
- Sepolia transactions are sent one JSON-RPC request at a time (`batchMaxCount: 1`): a gateway answered an ethers batch containing `eth_sendRawTransaction` with a lone HTTP 429 object, which ethers cannot match, and the send hung silently.
- Snapshot builds are single-flight with stale-while-revalidate, so a burst of dashboard clients does not multiply RPC load.

## Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| `SourceBatchRegistry` (signature verified on chain) | Ethereum Sepolia 11155111 | `0x32c0923cD58523864D2727FCaaB109783664c236` |
| `SignalProofSettlement` | Creditcoin CC3 Testnet 102031 | `0x8F14B2cC1b807203d332DE6E3DA6274176FDb584` |
| `SignalProofBatchSettlement` | Creditcoin CC3 Testnet 102031 | `0x3B90e22f246bBa68f6de682b564c33b121D68C85` |
| Retired `SourceBatchRegistry` (relayer-gated only; history still read) | Ethereum Sepolia | `0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc` |

All are verified on their explorers. Details and history in [Smart contracts](contracts.md).

## Pages and routes

| Route | What it shows |
|---|---|
| `/` | The console: coverage overview, run a test, proof queue, data products |
| `/verify` and `/verify/:hash` | Any measurement root or transaction hash resolved across both chains, with its proof |
| `/area/:geohash` | One cell: quality trend, samples, export, badge |
| `/contributors` and `/contributors/:address` | Leaderboard and per-address profile with the claim control |
| `/ops` | Relayer balances, pool runway, worker and RPC health |
| `/docs` | These pages |
