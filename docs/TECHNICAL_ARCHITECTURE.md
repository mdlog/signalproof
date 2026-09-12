# SignalProof Technical Architecture

**Status:** As built. Every statement below describes code in this repository and contracts that
are deployed and verified on public testnets. Where the system is incomplete, this document says
so rather than describing what it would look like finished.
**Protocol:** Attestcoin Protocol (formerly Universal Smart Contracts / USC), read direction
Ethereum Sepolia → Creditcoin CC3 Testnet.
**Hackathon:** BUIDL CTC 2026 Fall, DePIN track. [4]

| Contract | Chain | Address |
|---|---|---|
| `SourceBatchRegistry` (signature verified on-chain) | Ethereum Sepolia (11155111) | `0x32c0923cD58523864D2727FCaaB109783664c236` |
| Retired `SourceBatchRegistry` (relayer-gated only; history still read) | Ethereum Sepolia | `0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc` |
| `SignalProofSettlement` | Creditcoin CC3 Testnet (102031) | `0x8F14B2cC1b807203d332DE6E3DA6274176FDb584` |
| `SignalProofBatchSettlement` | Creditcoin CC3 Testnet (102031) | `0x3B90e22f246bBa68f6de682b564c33b121D68C85` |

## 1. Architecture decision

SignalProof turns a phone's network measurement into a claim that a contract on Creditcoin can
check without trusting anyone in the middle. Four parties touch a measurement — the browser that
took it, the gateway that validated it, the relayer that committed it to Sepolia, and the worker
that carried the proof to Creditcoin — and none of them is trusted by the settlement contract. It
accepts a measurement only when the Attestcoin BlockProver precompile has proven that a
`MeasurementSubmitted` event was included in an attested Sepolia block, the transaction that
emitted it succeeded, and the emitter was our registry.

The trust boundary is therefore the Sepolia event. Everything before it (gateway validation,
signature recovery, freshness, geohash precision) decides what gets *admitted*; everything after
it (attestation, inclusion proof, emitter binding, replay protection, reward) decides what gets
*paid*. Admission is gated twice: the registry accepts submissions from one relayer address, the one
that carries the gateway's checks on-chain, and it recovers the contributor's own EIP-191 signature
before recording anything, so the relayer cannot forge attribution. Payment is permissionless —
anyone holding a valid proof may settle it, and the contract's own checks are the only authorisation.

## 2. Logical architecture

```text
┌───────────────────────────────┐
│ Browser measurement client    │  latency (7 timed HEADs), throughput (3 MB stream),
│ (PWA, wallet = identity only) │  navigator.connection class, geolocation → geohash-6
└──────────────┬────────────────┘
               │ tRPC signalproof.submitMeasurement
               ▼
┌───────────────────────────────┐        ┌────────────────────────────┐
│ Gateway  server/routers.ts    │───────►│ Store  (MySQL via drizzle, │
│ zod schema · root recompute · │        │  or in-memory fallback)    │
│ freshness · nonce/root unique │        └─────────────┬──────────────┘
└───────────────────────────────┘                      │ SUBMITTED rows, 15 s tick
                                                       ▼
                                        ┌────────────────────────────┐
                                        │ Relayer  relayer.ts        │
                                        │ submitMeasurement(...) on  │
                                        │ SourceBatchRegistry        │
                                        └─────────────┬──────────────┘
                                                      │ Sepolia txHash, block
                                                      ▼
                                        ┌────────────────────────────┐
                                        │ Proof worker proofWorker.ts│
                                        │ poll attested height ·     │
                                        │ ProofBuilder.getProof ·    │
                                        │ execute / executeBatch     │
                                        └─────────────┬──────────────┘
                                                      │ Creditcoin tx
                                                      ▼
┌───────────────────────────────┐        ┌────────────────────────────┐
│ Dashboard  chainRead.ts       │◄───────│ Creditcoin CC3             │
│ joins MeasurementSubmitted    │  logs  │ BlockProver 0x…0FD2 +      │
│ (Sepolia) with                │        │ SignalProofSettlement /    │
│ MeasurementVerified (CC3)     │        │ SignalProofBatchSettlement │
└───────────────────────────────┘        └────────────────────────────┘
```

The dashboard does not read the database. It derives its entire read model from the two chains,
so a clone with only RPC URLs and the contract addresses in `.env` shows real settlements.

## 3. Attestcoin Protocol integration

### 3.1 What the protocol provides

CC3 Testnet exposes two precompiles: `ChainInfo` at `0x…0fd3`, which lists supported source
chains and the latest attested height per chain, and `BlockProver` at `0x…0FD2`, which verifies a
Merkle inclusion proof and a continuity proof for a transaction in an attested source block. The
hosted proof service (`ATTESTCOIN_PROOF_SERVICE_URL`) builds those proofs, and `@gluwa/usc-sdk`
0.18.0 wraps both. [1][2]

### 3.2 Destination contract — `ASCBase`

`SignalProofSettlement` inherits `ASCBase` from `@gluwa/asc-contracts` 0.2.1 and overrides one
hook, `_processAndEmitEvent`. `ASCBase.execute()` (selector `0xc6339bf7`) calls the BlockProver
precompile, deduplicates by `queryId`, and only then invokes the hook with the RLP-encoded source
transaction and receipt. Inside the hook the contract:

1. rejects a source transaction whose receipt status is not `1` — the precompile proves
   inclusion, not success (`SourceTransactionFailed`);
2. decodes every log matching the `MeasurementSubmitted` signature with `EvmV1Decoder`;
3. rejects a log whose emitter is not `sourceRegistry` (`WrongEmitter`) — without this, a
   lookalike contract on Sepolia could mint provable events and drain the pool. This check is
   absent from the `SimpleMinterASC` example on the documentation site and present in Gluwa's own
   `ASCLoanManager`; we mirror the latter and its regression test;
4. rejects a `measurementRoot` already in `settled` (second replay layer behind `queryId`), and a
   timestamp older than `maxMeasurementAge` (24 h) or in the future;
5. reads the contributor from `topics[3]`, accrues `rewardAmount` (0.001 CTC) to
   `rewards[contributor]`, and emits `MeasurementVerified(measurementRoot, areaHash, contributor,
   rewardAmount, queryId)`.

Rewards are pull-payments: `claim()` transfers the accrued balance to `msg.sender`, so no value
moves on the verification path and a reverting receiver cannot block settlement for anyone else.

### 3.3 Batch route — one continuity proof for many measurements

`SignalProofBatchSettlement.executeBatch(chainKey, heights[], encodedTransactions[],
merkleProofs[], sharedContinuityProof)` verifies a set of transactions with a single precompile
call and a single continuity walk. Per-entry checks are the same as the single route, but a bad
entry is *skipped, not fatal*: a foreign emitter is reported through `ForeignLogSkipped`, a stale
or already-paid entry is left out, and only a batch that settles nothing reverts
(`NoMeasurementSettled`). Because the single-route contract is immutable and shipped first, the
batch contract holds `siblingSettlements` (max 4) and defers to any root a sibling has already paid
— that cross-check is what stops one measurement from being settled on both routes.

Measured: 3 measurements settled in one transaction at 253,284 and 423,360 gas across two live
runs against 150,640 gas for one single-route settlement. `contracts/test/BatchGasProbe.t.sol`
holds the proof shape fixed and shows the marginal entry costs 45–71k gas, rising with batch size
because the decoder's memory expansion is quadratic; the worker caps batches at 50 entries.

### 3.4 Source contract — `SourceBatchRegistry`

```solidity
event MeasurementSubmitted(
    bytes32 indexed measurementRoot,
    bytes32 indexed areaHash,
    address indexed contributor,   // topics[3]: the payee the settlement contract reads
    bytes32 sessionHash,
    uint256 timestamp,
    uint256 latencyMs,
    uint256 downloadMbps
);

function submitMeasurement(bytes32 measurementRoot, bytes32 areaHash, address contributor,
    bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps,
    bytes calldata signature) external;

function signingMessage(bytes32 measurementRoot, address contributor) public pure returns (string memory);
function signingDigest(bytes32 measurementRoot, address contributor) public pure returns (bytes32);
function recoverContributor(bytes32 measurementRoot, address contributor, bytes calldata signature)
    public pure returns (address);
```

`submitMeasurement` reverts unless `msg.sender == relayer`, rejects an empty root, a zero
contributor, a root already in `registered`, and — before writing anything — a signature whose
recovered signer is not `contributor` (`SignatureMismatch`). The signed text is rebuilt on-chain
byte for byte from `shared/measurement.ts` `buildMeasurementSigningMessage` (the EIP-191
personal_sign message the wallet displayed); a signature vector produced with ethers in
`server/signalproof/signing.test.ts` is accepted by `contracts/test/SourceBatchRegistry.t.sol`,
which is the proof the two implementations agree. The contract stores no coordinates, no raw
payload, and no identity beyond the reward address.

It was redeployed twice. The first version was permissionless: an attacker could name themselves
as `contributor`, obtain a genuine proof and be paid for work nobody did
(`contracts/test/AdvUnlimitedMint.t.sol` keeps the exploit with its assertions inverted). The
second was relayer-gated but trusted the relayer for attribution; the third recovers the
signature itself. The settlement contracts were repointed each time and the retired gated
registry's history is still read (`RETIRED_REGISTRIES`).

### 3.5 Off-chain worker — how the SDK is actually driven

| Step | Implementation | Why it is done this way |
|---|---|---|
| Resolve `chainKey` | At startup from `ChainInfo.getSupportedChains()`, matched on `chainId === 11155111` | The key is a `uint64` and `chainName` comes back hex-encoded; key `1` means a different chain on Mainnet, so it is never hardcoded |
| Wait for attestation | One `getLatestAttestedHeightAndHash` read per 15 s tick, reused for every pending row | `waitUntilHeightAttested` blocks 8–20 min and would freeze the queue behind the first row |
| Build the proof | `ProofBuilder.getProof(txHash)` with a 120 s timeout, then unwrap `.data` | The SDK default is 10 s with no retry; the return type is `ProofResult`, not the proof itself |
| Submit | `settlement.execute(...)` or `batch.executeBatch(...)` with `estimateGas` in try/catch and a 35 % buffer, manual fallback | Estimation fails against precompiles even when the call succeeds |
| Read the result | From the transaction receipt, never from a log filter | Filter-based polling breaks on RPC nodes that expire filters |
| Send to Sepolia | One JSON-RPC request per call (`batchMaxCount: 1`) | Tenderly's gateway answers a batch containing `eth_sendRawTransaction` with a lone HTTP 429 object; ethers cannot match it and the send hangs silently |
| Deploy to CC3 | `forge create`, not `forge script` | CC3 headers carry no `mixHash`, so Foundry's shanghai simulation aborts before sending |

Attestation lag measured during the hackathon: 35–44 blocks behind Sepolia head, advancing 10
blocks at a time, 7–9 minutes. End-to-end from browser to claimable reward: 8.5 minutes on the
recorded run; 9.8 minutes on the first run through the signed registry (9.6 min attestation,
7 Merkle siblings, 9 continuity roots, 154,224 gas).

## 4. Components

### Measurement client (`client/`)

A React + Vite PWA. `Run a test` measures rather than asks: latency is the median of seven timed
`HEAD /api/net/ping` round trips read from Resource Timing; throughput streams a 3 MB
incompressible payload from `/api/net/payload` with the first 250 ms excluded; the network class is
`navigator.connection.effectiveType`, labelled as the browser's own estimate; the area is
`navigator.geolocation` at low accuracy converted immediately to a precision-6 geohash. The raw
coordinate never leaves the function. The wallet (EIP-6963 discovery via `ethers`) is an identity,
not a signer — the relayer pays gas on both chains, and the only user transaction is `claim()`.

A native mobile app was not built; the browser client is the measurement client.

### Gateway (`server/routers.ts`)

tRPC procedures under `signalproof.*`: `submitMeasurement`, `listMeasurements`, `getMeasurement`,
`proofQueue`, `coverage`, `integrationStatus`, `contributorStats`, `attestationProgress`,
`rewardsFor`, `onchain`. `submitMeasurement` validates with a zod schema (geohash `areaHash` capped
at precision 6, 13-digit `timestampMs`, bounded metrics), recomputes `measurementRoot` from the
canonical payload and rejects a mismatch, recovers the EIP-191 signer of the canonical signing
message and rejects one that is not `contributorAddress` (`SIGNATURE_MISMATCH`), enforces freshness
(60 s clock skew ahead, 15 min behind; the contract applies its own 24 h window at settlement),
applies the rate limit (3 measurements per contributor per geohash cell per 10 minutes,
in-process — `admitMeasurement` runs policy, then integrity, then the limiter so a forged
submission never consumes an honest slot), and enforces `nonce` and `measurementRoot` uniqueness.
Public reads never return `signature`, `nonce` or `sessionHash`. `proofFor(sourceTxHash)` returns
the live Attestcoin proof for any measurement through a keyless read context (`getReadContext`),
summarised for the dashboard and with `execute()`'s calldata for a wallet.

### Buyer API v1 (`server/signalproof/areas.ts`, `buyerApi.ts`)

`GET /v1/areas` (free catalog), `GET /v1/areas/{area}`, `/brief`, `/export.csv` and
`/export.json` (metered) are read-only views of the on-chain snapshot: per-cell aggregates (with
the decoded geohash cell), and every sample with its Sepolia commitment, Creditcoin settlement and
`verifyUrl`. `GET /v1/verify/{hash}` and `GET /v1/areas/{area}/badge.svg` are free. No retention
policy yet.

### Buyer access (`server/signalproof/access.ts`)

A key is bought by sending `BUYER_ACCESS_PRICE_CTC` to `SignalProofSettlement` on CC3 — its
`receive()` credits the reward pool — and redeemed with `POST /v1/access/redeem { txHash, address,
signature }`. `verifyPurchase` checks on chain that the transaction paid the settlement contract at
least the price and succeeded, and that the EIP-191 signature over
`"SignalProof API access\nTransaction: <tx>\nAddress: <addr>"` recovers to `tx.from`. The key
`sp1_<expiryUnix>_<txHash>_<hmac16>` is HMAC-SHA256(`BUYER_ACCESS_SECRET`, `txHash|expiry`), so
verification is offline and nothing is stored; the same payment always yields the same key. The
gate (`requireAccess`) is open when no secret is configured. Metered is the service, not the data.

### Verifier, contributors, ops (`verify.ts`, `contributors.ts`, `ops.ts`, `areaExport.ts`)

Pure functions over the snapshot: `resolveVerification` matches any of a measurement's three hashes;
`listContributors` groups by reward address and ranks by settled count; `areaTrend`/`areaCsv`/
`areaJson`/`badgeSvg` derive the area deliverables. `getOpsStatus` adds live probes — relayer
balances, pool runway, `workerHealth` (updated by the proof worker's interval), `snapshotHealth`
(updated by the chain reader, including how many shrunken reads `reconcileSnapshot` refused) and
the attestation lag — each in its own try/catch.

### Route pages (`client/src/pages/`, `client/src/components/AppShell.tsx`)

`wouter` routes `/verify/:hash`, `/area/:geohash`, `/contributors[/:address]`, `/ops` share one
shell (sidebar, header, wallet control) with the console at `/`. The wallet connection is a single
context. `useMeasurementRun` holds the measurement sequence so the button and the auto-measure loop
run identical code; auto-measure is a 10-minute timer with a 14-minute signing deadline.

### Store (`server/signalproof/store.ts`, `drizzle/schema.ts`)

MySQL through drizzle when `DATABASE_URL` is reachable, otherwise an in-memory store that
re-imposes the same uniqueness. The `measurements` table carries the pipeline columns —
`status`, `sourceTxHash`, `sourceBlockNumber`, `chainKey`, `headerNumber`, `proofStatus`,
`creditcoinTxHash`, `rewardAmount`, `attempts`, `nextAttemptAt`, `lastError` — with indexes on
`(status, nextAttemptAt)` and `(areaHash, createdAt)`.

### Relayer and proof worker (`server/signalproof/relayer.ts`, `proofWorker.ts`, `worker.ts`)

One in-process loop on a 15 s tick. `relayer.ts` moves `SUBMITTED` rows to Sepolia and records
`AWAITING_ATTESTATION`; `proofWorker.ts` settles rows whose block is attested, grouping rows whose
proofs share an identical continuity proof into one `executeBatch` (max 50) and settling the rest
one by one. `worker.ts`
holds the pure logic — `canTransition`, exponential backoff, and the classification of every
revert into terminal (`REJECTED` with a `rejectionCode`) or transient (retry). Every 20 ticks the
worker reconciles against chain state so a row is never left `AWAITING_ATTESTATION` after it was
paid.

### Dashboard read model (`server/signalproof/chainRead.ts`)

Scans `MeasurementSubmitted` on the registry from its deploy block and `MeasurementVerified` on
every settlement route (current, batch, and any retired sibling the batch contract names), joins
them by `measurementRoot`, and aggregates per `areaHash`. A root on both sides is `SETTLED`; on
Sepolia only, `AWAITING_ATTESTATION`. The coverage map decodes each geohash to its bounding box
and draws the cell, never a point. Labels that are not geohashes are listed as unmapped rather than
placed.

The proof queue exposes two things on top of the snapshot: **View proof**, the live proof summary
from `proofFor`, and **Settle from my wallet**, which sends the same `execute()` calldata the worker
would from the contributor's own wallet — `execute()` is permissionless, and this is that property
made visible. `PROOF_WORKER_MODE=relay-only` keeps the worker relaying but leaves settlement to
wallets, for a demo where the contributor must be the one to settle.

Two defences against unreliable public RPCs live here: an empty `eth_getLogs` answer is re-asked
up to twice before it is believed, and a re-read that reports fewer measurements or settlements
than the snapshot already served is discarded, because logs on an append-only chain cannot
disappear. Both were added after a public Sepolia endpoint returned an empty array on half of
identical calls.

## 5. Status machine

```text
SUBMITTED ──relayer──► AWAITING_ATTESTATION ──proof+settle──► PROOF_VERIFIED ──► SETTLED
    │                          │                                    │
    └──────────────────────────┴────────────────────────────────────┴──► REJECTED (+ rejectionCode)
```

`canTransition` encodes this as data. `SETTLED` and `REJECTED` are terminal; nothing walks a
paid measurement back.

## 6. Security and privacy controls

- **Location:** a geohash of at most 6 characters (~1.2 km × 0.6 km), enforced by the gateway,
  stored on-chain as `bytes32`. No coordinate is transmitted or stored anywhere.
- **Admission:** only the relayer may write to the registry; the gateway's checks are what that
  address carries on-chain. The registry also recovers the contributor's signature, so the relayer
  cannot attribute a measurement to anyone who did not sign it.
- **Spam:** 3 measurements per contributor per cell per 10 minutes at the gateway. A policy, not a
  Sybil defence.
- **Payment:** inclusion ≠ success (receipt status), emitter binding, `queryId` and
  `measurementRoot` replay protection, freshness window, sibling cross-check between routes,
  pull-payment rewards.
- **Secrets:** relayer and deployer keys live only in `.env` on the server. The client never
  signs or sends a chain transaction except `claim()`.
- **Public API:** never returns `signature`, `nonce` or `sessionHash`.

## 7. Failure handling

Transient proof-builder or RPC failures back off exponentially per row. A permanent revert
classifies the row `REJECTED` with a machine-readable code and no payment. A Sepolia block that is
not yet attested is not a failure and does not consume the retry budget. A settlement that reverts
because a sibling already paid the root is recognised before the transaction is sent. A dashboard
read failure serves the last good snapshot and says nothing false.

## 8. Deployment

Foundry, `solc 0.8.30`, `evm_version = shanghai`, `via_ir = true` (the Gluwa reference toolchain;
`ASCBase` plus the decoder hit "stack too deep" without it). `contracts/deploy.sh` deploys the
registry to Sepolia, the settlement contracts to CC3 with `forge create`, verifies on Blockscout,
funds the reward pool, and writes addresses and deploy blocks back to `.env`. Measured deploy cost:
134,013 gas on Sepolia, 1,503,596 gas on CC3.

Runtime: Node 22, `pnpm dev` (Vite + Express on one port). MySQL is optional. With no chain
variables set the gateway still accepts measurements as `SUBMITTED`, the worker stays off, and
`integrationStatus` reports exactly which variables are missing.

## 9. Known limitations

- The relayer remains the admission point: an offline relayer stalls new measurements, though
  anything already committed can be settled by anyone. Attribution can no longer be forged by it.
- Read direction only. Attestcoin write-ability has no public reference implementation and has
  not cleared third-party audit.
- Attested ≠ finalized: attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag, so a
  deep reorg could in principle invalidate an attested height.
- End-to-end latency is 9–13 minutes, dominated by attestation. A demo pre-warms a proof.
- Anti-Sybil is a per-cell rate limit only; platform attestation and stake-weighted rewards are
  not implemented. Buyer keys are stateless — no per-key revocation — and there is no retention
  policy.

## References

[1]: https://docs.attestcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments "Attestcoin Protocol chains and environments"

[2]: https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk "Attestcoin SDK / USC SDK"

[3]: https://github.com/gluwa/attestcoin-protocol-examples "Attestcoin Protocol examples (Apache-2.0) — the contract patterns followed here"

[4]: https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail "BUIDL CTC 2026 Fall official rules and submission requirements"
