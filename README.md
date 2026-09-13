<p align="center"><img src="client/public/logo.png" alt="SignalProof" width="128" /></p>

# SignalProof

**Verifiable connectivity data for DePIN, settled on Creditcoin via the Attestcoin Protocol.**

Submission for [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) — **DePIN track**.

**Live:** [https://signalproof.mdloglabs.org](https://signalproof.mdloglabs.org) — the dashboard, the public verifier (`/verify/<hash>`), the metered buyer API (`/v1/access`) and the ops panel (`/ops`), all reading Creditcoin CC3 Testnet and Ethereum Sepolia. Open it on a phone to contribute a measurement.

**Documentation:** every running instance serves its own docs at `/docs` — quickstart, concepts, architecture, the Attestcoin integration, the API and contract references, the security model and an operations runbook. The sources are markdown in [`docs/site/`](docs/site/), readable on GitHub without running anything: start with the [introduction](docs/site/introduction.md).

---

## What it does

Mobile devices measure real network conditions — latency, throughput, network type, coarse area.
Anyone can *claim* coverage numbers; nobody can prove them. SignalProof makes the claim checkable.

A measurement is committed as a hash on **Ethereum Sepolia**, proven to exist there by the
**Attestcoin Protocol**, and settled on **Creditcoin CC3 Testnet**, where a contract verifies the
cross-chain proof and accrues a reward to the contributor.

```
 phone ──► gateway ──► SourceBatchRegistry ──► Attestcoin ──► SignalProofSettlement ──► reward
           (tRPC)      Ethereum Sepolia        proof          Creditcoin CC3            claim()
                       11155111                ~7 min         102031
```

The Creditcoin contract is the only place that decides whether a measurement is real. It does not
trust the gateway, the relayer, or the submitter — only the proof.

---

## Attestcoin Protocol integration

`SignalProofSettlement` inherits `ASCBase` from `@gluwa/asc-contracts` and overrides one hook. The
BlockProver precompile at `0x…0FD2` verifies Merkle inclusion and continuity; `ASCBase` deduplicates
by query id; our logic runs only after both pass.

### The two checks the precompile does not perform

The precompile proves exactly one thing: that a transaction was included in a block genuinely
belonging to the attested source chain. It does **not** prove the transaction succeeded, and it does
**not** prove which contract emitted the logs inside it. Both are the application's responsibility:

```solidity
// 1. Inclusion is not success.
if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

// 2. Emitter binding. Without this, anyone can deploy a lookalike contract on Sepolia,
//    emit a forged MeasurementSubmitted, prove it here, and drain the reward pool.
if (log.address_ != sourceRegistry) revert WrongEmitter(log.address_, sourceRegistry);
```

**Check 2 is missing from the `SimpleMinterASC` example on the Attestcoin docs site.** Anyone who
copies that page verbatim gets check 1 and silently loses check 2. It is present in Gluwa's own
`ASCLoanManager`, which ships a dedicated regression test for it. We mirror both the check and the
test — see `test_rejectsWrongEmitter` and the whole-system version,
[`test_forgedRegistryCannotSettleEvenWithValidProof`](contracts/test/EndToEnd.t.sol), where an
attacker controls their own registry, emits a byte-identical event, and holds a proof the precompile
accepts. Only the binding stops them.

### Other protocol details we handle explicitly

| Detail | What we do | Why |
|---|---|---|
| `chainKey` | Resolved at startup from `getSupportedChains()`, matched on `chainId === 11155111` | It is a `uint64`, not a string. The chain returns `chainName` **hex-encoded** (`0x5365706f6c696120657468657265756d`), so name matching finds nothing. And key `1` means a different chain on CC3 Mainnet — hardcoding it would keep "working" while proving the wrong chain. |
| Attestation wait | Poll `getLatestAttestedHeightAndHash` once per tick | `waitUntilHeightAttested` blocks 8–20 minutes. Inside a queue worker that freezes every other measurement behind the first one. |
| `getProof` | Check `.success`, then unwrap `.data` | It returns `ProofResult`, not `ContinuityResponse`. Skipping the unwrap leaves `chainKey` undefined at runtime. |
| `ProofBuilder` timeout | Explicit 120 s + our own backoff | The constructor defaults to 10 s and wraps `getProof` in no retry at all. |
| `estimateGas` | try/catch with a manual fallback, 35% buffer | It fails against precompiles even when the call would succeed — `pallet-evm` does not propagate revert reasons in estimation mode. |
| Event reading | From the transaction receipt, never a filter | Filter-based polling breaks against RPC nodes that expire filters. |
| Deploying to CC3 | `forge create`, not `forge script` | CC3 block headers carry no `mixHash`, so Foundry's shanghai simulation host aborts with ``header validation error: `prevrandao` not set`` before sending anything. `forge create` estimates over plain JSON-RPC and is unaffected. Contracts still **compile** for shanghai — only the simulation step is bypassed. |

---

## Deployed and proven on testnet

| | Address | Explorer |
|---|---|---|
| `SourceBatchRegistry` — Ethereum Sepolia (11155111) | `0x32c0923cD58523864D2727FCaaB109783664c236` | [Etherscan](https://sepolia.etherscan.io/address/0x32c0923cD58523864D2727FCaaB109783664c236) |
| `SignalProofSettlement` — Creditcoin CC3 Testnet (102031) | `0x8F14B2cC1b807203d332DE6E3DA6274176FDb584` | [Blockscout](https://creditcoin-testnet.blockscout.com/address/0x8F14B2cC1b807203d332DE6E3DA6274176FDb584) |
| `SignalProofBatchSettlement` — Creditcoin CC3 Testnet | `0x3B90e22f246bBa68f6de682b564c33b121D68C85` | [Blockscout](https://creditcoin-testnet.blockscout.com/address/0x3B90e22f246bBa68f6de682b564c33b121D68C85) |
| Retired `SourceBatchRegistry` (relayer-gated, no on-chain signature) — Sepolia | `0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc` | [Etherscan](https://sepolia.etherscan.io/address/0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc) |

All are verified on their explorers. The registry was redeployed twice, each time to close a hole
found in review — see below. The settlement contracts kept their addresses and were repointed with
`setSourceRegistry`; the retired registry's seven settled measurements are still read
(`RETIRED_REGISTRIES`), because they were genuine and authorised.

### The registry was permissionless, and that was the whole system's weak point

A pre-deploy review of the batch contract found nothing wrong with the batch contract. It found
something wrong upstream, in a contract that was already live and sitting in front of a 5 CTC pool:

`submitMeasurement` was permissionless, while `contributor` and `timestamp` were both chosen by the
caller. So an attacker did not need to forge anything. They could call the **real** registry, name
**themselves** as the payee, obtain a **genuine** inclusion proof, and settle it. Emitter binding on
the destination chain — the check the architecture leans on hardest — would pass, because the event
really did come from the bound registry. Nothing about the measurement would be forged. It would
simply be unauthorised, and the destination chain has no way to tell those apart.

Authorisation therefore has to live at the point of admission. The registry now accepts submissions
from one relayer, which is the address that carries the gateway's signature check
(`server/routers.ts`, `verifyMeasurementIntegrity`) onto the chain. `contracts/test/RegistryAuthorisation.t.sol`
proves the gate closes; `contracts/test/AdvUnlimitedMint.t.sol` is the original exploit, kept with
its assertions inverted so that removing the gate fails a test rather than quietly reopening the
hole.

The fix meant a redeploy, since the old registry had no admin function to add a gate to. The
settlement contracts keep their addresses — `settled` is keyed by `measurementRoot` and `rewards` by
address, so nothing already proven or already owed was affected; they were repointed with
`setSourceRegistry`. The dashboard's history restarts from the gated registry, deliberately: showing
measurements from a registry anyone could write to, next to a claim that submissions are
authorised, would be the wrong thing to display.

### Two settlement routes, one registry, and a measurement that paid twice

Adding the batch route created a defect the single route never had. Both contracts read the same
registry, both expose a permissionless entry point — anyone holding a valid proof may settle, which
is the correct design — and each keeps its own `settled` map. So the identical measurement could be
settled once on each and paid out of both pools. Nothing about the second settlement is forged: the
measurement is genuine, the contributor is genuine, the proof is genuine. It is the same work billed
twice, by anyone willing to send the transaction.

`contracts/test/DoubleSettlement.t.sol` demonstrates it, and keeps
`test_withoutTheCrossCheckTheSameMeasurementPaysTwice` as an executable statement of the finding.

The fix has to live on the newer contract, because the single-proof one shipped first and is
immutable. `SignalProofBatchSettlement.siblingSettlement` points at it, and any root that contract
has already paid for is skipped here — skipped, not reverted, so one already-paid entry cannot
strand the honest measurements sharing its batch. The lookup is a `staticcall` with an explicit
success check rather than a plain interface call: a misconfigured sibling must degrade to "no
cross-check", never to a route that silently refuses every honest measurement. The worker carries
the same guard in `proofWorker.ts`, so it does not spend a transaction discovering the refusal.

A second, smaller finding came out of the same review. The batch contract used to `revert` when a
proved transaction's receipt contained a `MeasurementSubmitted`-shaped log from some other contract.
That is a grief lever: one Sepolia transaction that touches the registry *and* emits a lookalike log
would kill every batch containing it, forever, taking the innocent measurements beside it down too.
Foreign logs are now skipped and reported through a `ForeignLogSkipped` event. A batch made only of
foreign logs still reverts, via `NoMeasurementSettled`, so nothing unearned can settle either way.

### The relayer could still name the payee, so the registry now checks the signature itself

Gating the registry on the relayer closed the door to outsiders. It left one party fully trusted:
the relayer. The gateway verified the contributor's EIP-191 signature before relaying, but nothing
on either chain checked it — a relayer that lied about `contributor` would have produced a
perfectly provable event and paid whoever it named.

`SourceBatchRegistry.submitMeasurement` now takes the contributor's signature and recovers the
signer on-chain, from the exact text the wallet displayed (`buildMeasurementSigningMessage`,
rebuilt byte for byte in Solidity and pinned by a vector produced with ethers):

```solidity
address recovered = recoverContributor(measurementRoot, contributor, signature);
if (recovered != contributor) revert SignatureMismatch(recovered, contributor);
```

Both controls stay. The relayer gate is what carries the gateway's admission checks — freshness,
geohash precision, uniqueness, the rate limit — on-chain; the signature is what makes attribution
a claim *by the contributor*. Neither alone suffices: without the gate anyone could spam self-signed
junk past the gateway; without the signature the relayer could forge attribution.
`contracts/test/SourceBatchRegistry.t.sol` holds the vector test and the fuzzed recovery;
`test_theRelayerGateIsStillCheckedFirst` proves an outsider with a valid signature is still refused.
Cost: 86,266 gas per Sepolia commitment against ~50,000 before, for the string rebuild and
`ecrecover`.

The first live run through the signed registry, end to end:

| Step | Result |
|---|---|
| Signed measurement committed to Sepolia | [`0xbd7261…7223`](https://sepolia.etherscan.io/tx/0xbd7261e655c751f9a38acc116808acd3a0c0b0fd14279fe4fad207c742d57223) — block 11,681,452 |
| Attestation reached that block | 9.6 min |
| Inclusion proof | 7 Merkle siblings, 9 continuity roots, 2,112-byte `txBytes` |
| Settled on Creditcoin | [`0x60d9e4…a2b5`](https://creditcoin-testnet.blockscout.com/tx/0x60d9e438e8549a101b144bd1e474475301c696640062601ddfd18f788e6aa2b5) — block 5,468,910, 154,224 gas |
| Reward | 0.001 CTC accrued; contributor balance 0.005 → 0.006 CTC |

**Total: 9.8 minutes.**

### A real cross-chain settlement

`pnpm e2e:live` runs the whole pipeline against the live chains. One complete run:

| Step | Result |
|---|---|
| Measurement submitted to Sepolia | [`0x224746…368f7`](https://sepolia.etherscan.io/tx/0x22474613e60df0650456a3ff9fd93211b833e70bbe8ef3910238e30eb82368f7) — block 11,656,985 |
| A second run, with a geohash `areaHash` | `qqguw6` (Sudirman CBD) — Sepolia block 11,657,148, settled on CC3 block 5,448,756 in 8.7 min |
| Attestation reached that block | 8.3 min · lag 35 blocks, advancing 10 at a time |
| Inclusion proof | 7 Merkle siblings, 6 continuity roots, 1,952-byte `txBytes` |
| Settled on Creditcoin | [`0x26c87e…d5c13`](https://creditcoin-testnet.blockscout.com/tx/0x26c87ed0d7dda10b864c7a6907dad4c52d19d2f449ff73eabc4db099736d5c13) — block 5,448,623, 150,640 gas |
| `MeasurementVerified` | reward 0.001 CTC accrued to the contributor |
| `claim()` | [`0x148536…e0030`](https://creditcoin-testnet.blockscout.com/tx/0x14853610d5d9ae99ade6fdca0cb3c0ead461d29baf252b18c2cfa48b83fe0030) — pool 5.000 → 4.999 CTC, accrued back to 0 |

**Total: 8.5 minutes**, dominated by the attestation wait.

### Many measurements, one continuity proof

`pnpm e2e:batch` submits three measurements with consecutive nonces so they land in one Sepolia
block, then settles all three in a single Creditcoin transaction against the batch overload of
`verifyAndEmit`. A continuity proof walks the attestation chain back to a checkpoint and is the
expensive part of a verification; the batch form carries exactly one for the whole set.

| Run | Continuity roots | Total gas | Per measurement |
|---|---|---|---|
| [`0xcf1a01…c49598`](https://creditcoin-testnet.blockscout.com/tx/0xcf1a01c55052ef604494ee53c717f9401019d7fb56c6681fb1e11f2559c49598) | 9 | 253,284 | 84,428 |
| [`0xb0933e…32d990`](https://creditcoin-testnet.blockscout.com/tx/0xb0933ed93237f0eb011ec012fa60d9aac15d935a8c9468e2980a4df0d732d990) | 2 | 423,360 | 141,120 |

Both settled 3 measurements from 1 proof in 1 transaction, and both emitted three
`MeasurementVerified` events plus one `BatchSettled`. The spread between them is the honest part:
per-measurement cost is dominated by the shape of the proof the attestation service happens to
return for that block, not by the batch size, so **two live runs are not enough to state a saving**.
A single settlement measured 150,640 gas, which sits between the two — quoting the favourable run
against it would be picking a number.

The controlled measurement is `contracts/test/BatchGasProbe.t.sol`, which holds the proof shape
fixed and varies only `n`:

| n | Total gas | Marginal gas per extra entry |
|---|---|---|
| 1 | 77,828 | — |
| 10 | 482,141 | 44,892 |
| 50 | 2,468,789 | 51,015 |
| 200 | 12,476,653 | 71,165 |

So the marginal entry costs 45–71k against 78k for a batch of one, and the per-entry cost *rises*
with batch size rather than falling — the decoder allocates memory it never reclaims, so the
quadratic memory-expansion term takes over. That is the opposite of the "batching gets cheaper the
bigger it gets" intuition, and it is why the worker caps a batch at 50 entries
(`MAX_BATCH_ENTRIES`) rather than at the block ceiling. The probe puts that ceiling at 600 entries
for a 75,000,000-gas CC3 block; 800 does not fit.


## Current status — read this before judging

| Component | State |
|---|---|
| Smart contracts | **Deployed and verified** on both chains. 75 Foundry tests passing, including a 6-test end-to-end suite, the inverted exploits described above, and the signature vector shared with the TypeScript client. |
| Cross-chain settlement | **Proven on-chain**, transaction hashes above. |
| Gateway → chain, no database | **Proven.** A measurement POSTed to the gateway with no MySQL running relayed itself to Sepolia on the next worker tick and settled on Creditcoin unattended: source [`0x17e8c0…90683`](https://sepolia.etherscan.io/tx/0x17e8c0c317c034c73c5f7a5c7decd92df4c9c91371430af8d1ca7da325c90683) → settlement [`0x87bc9d…d5ae4`](https://creditcoin-testnet.blockscout.com/tx/0x87bc9d13181e76c9dc250a64423f3d26ff2a4e4d425d9673b7cfd5aabf3d5ae4), area `qqguyg`. |
| Relayer + proof worker | **Complete.** Non-blocking 15 s tick, backoff, terminal-vs-transient error classification. |
| Gateway (tRPC + MySQL) | **Complete.** Validation, freshness, duplicate protection, SQL-side proof queue, coverage aggregates. |
| Attestcoin read path | **Verified live.** `pnpm smoke` passes from a clean machine. |
| Dashboard | **Live.** Reads the deployed contracts directly — no database required. Every proof-queue row can open the live Attestcoin proof ("View proof"); pending rows can be settled from the contributor's own wallet. Route pages: `/verify/<hash>`, `/area/<geohash>`, `/contributors`, `/contributors/<address>`, `/ops`. |
| Buyer API | **Live, metered.** `GET /v1/areas` (catalog, free); `/v1/areas/{geohash}`, `/brief`, `/export.csv`, `/export.json` behind a key bought with CTC that lands in the reward pool (`/v1/access`); `/v1/verify/{hash}` and `/badge.svg` free. First real purchase on chain: [`0xed00a0…8d30`](https://creditcoin-testnet.blockscout.com/tx/0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30). No retention policy yet. |
| Ops panel | **Live** at `/ops`: relayer balances on both chains, pool balance and runway in settlements, worker last tick, shrunken RPC reads refused, attestation lag. |
| Auto-measure | **Built, browser-side.** A 10-minute cycle around the same `runTest`; every cycle is wallet-signed, unsigned readings are discarded after 14 minutes, settlements raise a browser notification. |
| Anti-spam | **Policy only.** 3 measurements per contributor per cell per 10 minutes at the gateway, in-process. Not a Sybil defence. |
| Device measurement | **Real.** Latency, throughput, coarse area and network class measured in the browser; wallet-gated. A native app is not started — the browser client is the measurement client. |

We would rather state this plainly than have a judge discover it. Nothing in the UI or the docs
claims an on-chain result that does not exist.

### The dashboard reads the chain, not a database

`signalproof.onchain` derives the entire read model from the two deployed contracts: every
`MeasurementSubmitted` on Sepolia joined against every `MeasurementVerified` on Creditcoin. A root
present on both sides is `SETTLED`; one present only on Sepolia is still `AWAITING_ATTESTATION`.
That join is the honest definition of pipeline state — it is what the two chains agree on, not what
a local queue believes.

Consequences worth knowing:

- **No MySQL needed to demo.** A clone with only RPC URLs and the two addresses shows real
  settlements. The database remains the richer source when configured (device aliases, carriers,
  rows that have not reached the source chain yet).
- **The honesty labels are wired to the same flag as the data.** The header reads
  `CC3 TESTNET · LIVE` and the map says "aggregated from on-chain settlements" only when real
  measurements exist; otherwise both revert to the prototype wording. Neither can drift from the
  other, because one boolean drives both.
- **Proof-queue rows link to the explorer** — the settlement transaction when settled, the
  source-chain commitment while pending.
- Scanning starts at each contract's recorded deployment block. A fixed 40,000-block lookback made
  the first paint take 23 s on a public Sepolia endpoint; this brought it to 0.6 s.

### The proof is on screen, not just in the logs

Every row in the proof queue has **View proof**. It asks the Attestcoin proof service for that
transaction's inclusion proof — with no key, exactly as `pnpm smoke` does — and shows what the
BlockProver precompile is given: the attested Sepolia height and transaction index, the size of the
RLP-encoded transaction and receipt, the Merkle root and each sibling with its side, the continuity
roots that chain the block back to an attestation checkpoint, and the exact `execute()` call
(selector `0xc6339bf7`, calldata size, gas ceiling). For a block Creditcoin has not attested yet
it says so, with the countdown.

A row still awaiting attestation also has **Settle from my wallet** once a wallet is connected.
The server builds `execute()`'s calldata from that same proof; the wallet signs and pays CC3 gas.
This is `execute()`'s permissionlessness made visible: the contributor does not need the relayer to
get paid. If the relayer settles first, the contract refuses the second attempt
(`Query already processed`) and the UI says so rather than pretending. For a demo where the
contributor must be the one to settle, run the server with `PROOF_WORKER_MODE=relay-only`: the
worker still relays to Sepolia but leaves settlement to wallets.

### A buyer can query an area, with provenance

```bash
curl -s https://signalproof.mdloglabs.org/v1/areas                    # every measured cell, most samples first
curl -s https://signalproof.mdloglabs.org/v1/areas/qqguw6             # one cell: aggregates + every sample
curl -s https://signalproof.mdloglabs.org/v1/areas/qqguw6/brief       # the same as a markdown brief
```

Each sample carries `sourceTxHash`, `creditcoinTxHash` and a `verifyUrl`, so a buyer can verify
any number in the aggregate down to the transaction that proved it. The dashboard's "Create area
brief" button renders `/brief` for the most-sampled cell. The quality score the API reports is the
one the dashboard shows (`shared/quality.ts`): 50 % latency penalty up to 200 ms, 50 % throughput
credit up to 100 Mbps. There is no retention policy yet.

### The buyer pays the contributors: a key is a CTC payment into the reward pool

The per-area endpoints are metered. A key costs `BUYER_ACCESS_PRICE_CTC` (default 0.05 CTC) for
`BUYER_ACCESS_DAYS` (default 30), and the payment is a plain transfer to `SignalProofSettlement` —
its `receive()` credits the reward pool and emits `Funded`. So the buyer's money is, byte for byte,
what contributors later `claim()`. That closes the DePIN loop with no new contract.

```
buyer wallet ──0.05 CTC──► SignalProofSettlement.receive()   pool 4.997 → 5.047 CTC
             ──sign "SignalProof API access\nTransaction: <tx>\nAddress: <me>"──► POST /v1/access/redeem
             ◄── sp1_<expiry>_<txHash>_<hmac>                    Authorization: Bearer …
```

The server checks, against the CC3 RPC, that the transaction paid the settlement contract at least
the price and succeeded, and that the redeemer's EIP-191 signature recovers to the transaction's
sender — otherwise anyone reading a `Funded` event on Blockscout could redeem someone else's
payment. The key is an HMAC over `txHash|expiry` with `BUYER_ACCESS_SECRET`; nothing is stored, so
the same payment always yields the same key ("I lost my key" is "sign again") and there is no
replay to defend. The cost is that a single key cannot be revoked — only the secret can be rotated.
The key travels as `Authorization: Bearer <key>` from a program, or as `?key=<key>` on a link a
browser opens (the dashboard's own JSON links do this); either way the response is `Cache-Control:
private`.
Without a secret configured the gate is open and the purchase card hides itself, so a keyless clone
behaves exactly as before.

**What is sold is the service, not the data.** Every measurement is public on two chains, and the
dashboard, the catalog, the verifier and the badges stay free. The metered endpoints are the
aggregation, the provenance join, the brief, the exports and the uptime behind them — the same
thing a drive-test vendor charges for, minus the trust.

The first purchase on chain: [`0xed00a0…8d30`](https://creditcoin-testnet.blockscout.com/tx/0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30),
block 5,474,614 — 0.05 CTC into the pool, key valid to 2026-10-12, and a `200` on
`/v1/areas/qqguw6` with it where a bare call gets `401 { error: "ACCESS_REQUIRED", price, howTo }`.

### Anyone can verify any hash

`/verify/<hash>` takes a measurement root, the Sepolia transaction that committed it, or the
Creditcoin transaction that settled it, and shows the four-step rail — commitment, attestation,
proof, settlement — each with the transaction that proves it, the live attestation countdown while
pending, and the Attestcoin proof (Merkle siblings, continuity roots, the exact `execute()`
calldata) once one exists. A hash outside the scanned window is reported as not found, never as
invalid. `GET /v1/verify/<hash>` is the same answer as JSON. Verification is never metered.

### An area is a page, an export and a badge

`/area/<geohash>` places the cell on the map, charts quality over time, lists every sample with a
verify link, and offers CSV (`/v1/areas/<geohash>/export.csv`), JSON (`/export.json`) and the
brief — all behind the key — plus a free, embeddable badge:

```html
<a href="https://signalproof.mdloglabs.org/area/qqguw6"><img src="https://signalproof.mdloglabs.org/v1/areas/qqguw6/badge.svg"></a>
```

The badge reads `SignalProof · qqguw6 | quality 86 · 9 samples · verified on Creditcoin`, coloured
by the same thresholds as the map, cached for a minute. An unmeasured cell gets a grey "no data".

### Contributors are a network, and operations are visible

`/contributors` ranks every reward address by settled measurements, with cells covered and CTC
accrued; `/contributors/<address>` is one address's history — measurements, earned, claimed
(`RewardClaimed` events), unclaimed — with the claim button when the connected wallet is that
address. The header address links to the connected wallet's own profile.

`/ops` reads what it takes to keep the rail running: relayer balances on both chains, the pool and
its **runway** (⌊pool ÷ reward⌋ settlements — 5,047 at writing), the proof worker's last tick and
consecutive failures, how many shrunken RPC reads the chain reader has refused (the publicnode
symptom), and the attestation lag. Every probe is its own try/catch; a dead RPC is amber on its row,
never a blank panel.

### Auto-measure

The measure page has a toggle: every 10 minutes while the app is open, the same `runTest` the
button calls. Each cycle **asks the wallet to sign** — the registry recovers the contributor's
signature on-chain, so there is no silent mode, and that is the design rather than a gap. A
reading not signed within 14 minutes is discarded and logged as skipped (the gateway refuses
anything older than 15). The cycle log lives in `localStorage`; a screen wake-lock is requested
where the browser allows it; a settled measurement raises a browser notification. Background tabs
are throttled, so the honest instruction on screen is: install the PWA and keep it in front.

### `areaHash` is a geohash, and that is what makes the map real

The coverage map draws OpenStreetMap tiles and places every area by **decoding its `areaHash`** —
which is a geohash, not an arbitrary label. Precision is capped at 6 by the gateway, so a cell is
roughly **1.2 km x 0.6 km**. The shaded rectangle on the map *is* that cell: a contributor is
somewhere inside the box, never at the dot.

That single choice satisfies two requirements at once. The architecture calls for a "coarse area
bucket, never a precise coordinate", and a geohash is coarse by construction — the gateway rejects
a longer one rather than trusting the client to stay vague. And because it is decodable, the map
can show where coverage actually is without anyone transmitting a position.

**Areas that cannot be mapped are reported, not placed.** The first measurement we ever settled used
the label `a9c-46`, from before this convention. It is not a geohash, so there is no honest position
for it, and the map says so: `1 MAPPED · 1 UNMAPPED`, with the reason on screen. A decorative map
that silently invented a pixel for it would be worse than no map at all.

```
POST measurement { areaHash: "qqguw6", ... }     geohash, precision 6
  -> on-chain as bytes32                          no coordinate ever leaves the device
  -> map decodes to -6.2265, 106.8036             Sudirman CBD, Jakarta
  -> renders a 1216 m x 607 m cell                the real resolution of the claim
```

### Measuring from a real device

`Run a test` takes an actual measurement. Nothing on that screen is a fixture any more.

| Value | How it is obtained |
|---|---|
| **Latency** | Median of 7 timed `HEAD /api/net/ping` round trips to our own origin, after one discarded warm-up. Read from the Resource Timing entry (`responseStart - requestStart`), not wall clock around `fetch()`. |
| **Throughput** | Streaming a 3 MB incompressible payload from `/api/net/payload`, time-boxed to 12 s, with the first 250 ms excluded so TCP slow-start does not understate a fast link. The client asserts `encodedBodySize === decodedBodySize` and marks the result unreliable if a proxy compressed it. |
| **Coarse area** | `navigator.geolocation` with `enableHighAccuracy: false`, converted immediately to a precision-6 geohash. The raw coordinate never leaves the function. |
| **Network class** | `navigator.connection.effectiveType`, labelled as the browser's own estimate. |

**Why we measure instead of asking the browser.** One run over a real network path, taken through
the public tunnel rather than localhost:

| | Measured by us | Reported by `navigator.connection` |
|---|---|---|
| Throughput | **40.8 Mbps** (3 MB in 0.6 s, verified uncompressed) | `downlink: 7.5` — 5.4x low, because Chromium caps it at 10 Mbps |
| Latency | **68 ms** median, 66 ms min, 7 samples | `rtt: 50` — rounded to the nearest 50 ms |

The browser's numbers are not merely coarse, they are wrong by a factor of five. They are usable as
a connection *class* and nothing more.

**What no browser can provide, and what we therefore deleted.** The UI used to display `5G · Telkomsel`.
Both halves were fabricated and neither can be made real:

- No web API exposes the carrier. The complete `NetworkInformation` member list is
  `downlink, downlinkMax, effectiveType, rtt, saveData, type` — there is no operator field.
- `EffectiveConnectionType` is exactly `"slow-2g" | "2g" | "3g" | "4g"`. There is no `"5g"`, and
  Chromium maps 5G NR to `SUBTYPE_UNKNOWN` with an open TODO.

We also do not use `navigator.connection.downlink` or `.rtt` as measurements: Chromium caps
`downlink` at 10 Mbps, rounds `rtt` to 50 ms, and applies a deliberate ±10% per-host randomisation
to both. They are fine as a coarse class, useless as evidence.

On Firefox and Safari `navigator.connection` does not exist at all. The UI renders
`Not reported` there rather than filling the gap.

### Wallet

`Connect wallet` uses EIP-6963 discovery via `ethers`' own `BrowserProvider.discover()`, falling
back to `window.ethereum`. No wallet library was added — `ethers` was already a dependency and
already implements this.

**The wallet is an identity, not a signer.** The relayer pays gas on both chains, so submitting a
measurement never asks the user to sign or send anything. The connected address is passed as
`contributorAddress` and becomes `topics[3]` of `MeasurementSubmitted`, which
`SignalProofSettlement` reads to decide who accrues the reward. The only moment the wallet must act
is `claim()`, which is `msg.sender`-based — that is what `switchToCreditcoin` exists for.

`Run a test` is disabled until a wallet is connected, because without an address there is nobody to
attribute the reward to.

### Testing from a phone

Geolocation requires a secure context. `http://192.168.x.x:3010` is **not** one, and WebKit
implements no override, so an iPhone pointed at a LAN dev server will always fail. The UI detects
this and says so rather than letting it look like a permission denial.

- **Android** — Chrome DevTools port forwarding, so the phone loads a literal `http://localhost:PORT`.
- **Any phone** — an HTTPS tunnel: `cloudflared tunnel --url http://localhost:3010`.
  No config change is needed; `server/_core/vite.ts:13` already sets `allowedHosts: true`.
  Note this exposes the dev server publicly for as long as it runs.

### Running with no database

There is no MySQL requirement. `server/signalproof/store.ts` backs the pipeline with an in-memory
store when `DATABASE_URL` is unreachable, and re-imposes the `measurementRoot` and `nonce`
uniqueness that otherwise exists only as a MySQL index. A measurement submitted through the gateway
reaches Sepolia on the next 15 s worker tick either way; it simply does not survive a restart.

### Reproducing the deployment

```bash
pnpm deploy:check     # balances and readiness — no transactions
pnpm deploy:all       # sepolia -> cc3 -> fund the reward pool
pnpm e2e:live         # full pipeline against the live chains, ~9 min
```

Measured deploy cost: **134,013 gas on Sepolia**, **1,503,596 gas on CC3** (0.5 gwei ⇒ ~0.00075
CTC). Addresses are written back into `.env` automatically, so each step picks up the previous one
with no copy-paste.

---

## Run it

Requires **Node 22+**, **pnpm 10**, and **Foundry**. MySQL is optional — see
[Running with no database](#running-with-no-database).

```bash
git clone --recursive <this repo>   # forge-std is a git submodule; or run `forge install` in contracts/
pnpm install
cp .env.example .env          # pre-filled with the live testnet deployment — no key needed to read
pnpm dev                      # http://localhost:3000 — the dashboard shows real settlements
```

To relay and settle new measurements yourself, add `SEPOLIA_RELAYER_PRIVATE_KEY` and
`CREDITCOIN_RELAYER_PRIVATE_KEY` (funded burners) to `.env`; to persist across restarts, add
`DATABASE_URL` and run `pnpm db:push`. The template names a Sepolia RPC that answered every log
query consistently during the hackathon; PublicNode did not, and the server now defends against
that, but a consistent endpoint is still the first line.

Verify everything:

```bash
pnpm verify                   # tsc --noEmit + vitest + forge test
pnpm smoke                    # live read-path check against CC3 Testnet, no key needed
```

`pnpm smoke` is the fastest way to tell whether a problem is ours or the network's. It reports the
resolved chain key and the current attestation lag:

```
✓ resolved chainKey=1 for Sepolia
✓ latest attested Sepolia height 11655120
    lag behind Sepolia head: 36 blocks (~7.2 min)
✓ height 11655115 bracketed by parent=11655110 child=11655120 (attested=true)
```

### In a container

```bash
docker build -t signalproof .
docker run --rm -p 3000:3000 --env-file .env signalproof
```

`fly.toml` and `render.yaml` are included; both hosts inject `PORT`. The image ships only
production dependencies — the Vite dev server is loaded lazily and never in production.

### Without chain configuration

The chain variables are optional. With none of them set, the gateway still accepts and stores
measurements as `SUBMITTED`, the proof worker logs which variables are missing and stays off, and
`signalproof.integrationStatus` reports exactly that to the UI. There is no silent failure and no
false claim of verification.

---

## Layout

```
contracts/                       Foundry — isolated from the pnpm workspace
  src/SourceBatchRegistry.sol      Sepolia: commitment log, dedupe, no PII
  src/SignalProofSettlement.sol    CC3: ASCBase consumer, both security checks, pull-payment rewards
  test/EndToEnd.t.sol              real registry emission -> real settlement, no hand-written fixtures
  script/Deploy.s.sol              two-step deploy + reward-pool funding

server/signalproof/              Server-side only — the SDK is CommonJS with no browser build
  chain.ts                         providers, signers, startup chainKey resolution
  relayer.ts                       SUBMITTED -> Sepolia -> AWAITING_ATTESTATION
  proofWorker.ts                   AWAITING_ATTESTATION -> proof -> CC3 -> SETTLED
  worker.ts                        pure helpers: transitions, backoff, error classification, gas
  smoke.ts                         live read-path check
  abi.ts / abi.test.ts             hand-written ABIs, pinned against the compiled artifacts
  access.ts                        buyer keys: purchase verification on CC3, stateless HMAC keys, the gate
  verify.ts                        any hash -> its joined record across both chains
  areas.ts / areaExport.ts         area views; trend, CSV/JSON export, badge
  contributors.ts / ops.ts         leaderboard rows; relayer, pool, worker and RPC health
  buyerApi.ts                      the /v1 HTTP surface

client/src/pages/                one file per route: Home (console), VerifyPage, AreaPage,
                                 ContributorsPage, ContributorPage, OpsPage, DocsPage
client/src/docs/manifest.ts      the docs site: reading order, groups, one markdown file per page
docs/site/*.md                   the documentation itself, rendered at /docs and readable on GitHub
client/src/components/AppShell   sidebar, header, wallet control — shared by every route
client/src/hooks/useMeasurementRun.ts  the measurement sequence, shared by the button and auto-measure

server/routers.ts                tRPC gateway
shared/docsToc.ts / docsSearch.ts headings, cross-links and full-text search over the docs, unit-tested
drizzle/schema.ts                users + measurements
docs/superpowers/specs/          design document for this work
```

### Status machine

```
SUBMITTED ──relayer──► AWAITING_ATTESTATION ──proof+settle──► PROOF_VERIFIED ──► SETTLED
    │                          │                                    │
    └──────────────────────────┴────────────────────────────────────┴──► REJECTED (+ rejectionCode)
```

`canTransition` encodes this as data rather than scattered conditionals, so the worker cannot skip
`AWAITING_ATTESTATION` and present an unproven measurement as settled. `SETTLED` is terminal: once a
reward is accrued on Creditcoin, nothing walks it back.

---

## Security notes

- **Attested ≠ finalized.** Attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag, so a
  deep reorg could in principle invalidate an already-attested height. This is also why the demo is
  fast enough to be usable. We record it as a known limitation rather than claiming otherwise.
- **`execute()` is permissionless by design** — any relayer may submit a valid proof. All
  authorization therefore lives in `_processAndEmitEvent`, never in a caller check.
- **Rewards use a pull pattern.** No value moves on the verification path, so a contributor with a
  reverting `receive()` cannot brick settlement for anyone else.
- **The public API never returns `signature`, `nonce`, or `sessionHash`.** They are session-binding
  secrets; exposing them would let a caller replay another contributor's payload.
- **Prove fresh transactions.** Proving a 24-hour-old transaction costs roughly 10× more gas, once
  the dense attestation is replaced by sparse checkpoints.
- **Sepolia transactions are sent one JSON-RPC call at a time.** ethers v6 batches the three
  calls behind `broadcastTransaction` into one HTTP request; Tenderly's public gateway answers a
  batch that carries `eth_sendRawTransaction` with a single HTTP 429 object instead of an array,
  ethers cannot match it to a request id, and the send never settles — no error, just a relayer
  that sits on `SUBMITTED` rows forever. `batchMaxCount: 1` on every Sepolia sender sidesteps it
  (`SEPOLIA_SENDER_PROVIDER_OPTIONS`). The dashboard's log reads survived a second public endpoint
  that answered half of identical `eth_getLogs` calls with an empty array; those are re-asked and a
  re-read may never shrink what is already shown.

## Known limitations

- The relayer is still the admission point: only it may submit to the registry, so a relayer that
  goes offline stalls new measurements (already-committed ones can be settled by anyone). The
  contributor's signature is verified on-chain, so it can no longer forge attribution.
- Anti-Sybil is a rate limit (3 per contributor per cell per 10 minutes, in-process), not a
  defence: device attestation and stake-weighted rewards are not built.
- The buyer API is metered by stateless keys: a key cannot be revoked individually (rotating
  `BUYER_ACCESS_SECRET` revokes all), and there is no retention policy.
- Auto-measure needs a wallet signature per cycle, by design; a silent mode would need an on-chain
  delegation registry, which is not built.
- Read direction only (Sepolia → Creditcoin). Write-ability has no public reference implementation
  and has not cleared third-party audit.
- End-to-end latency is 9–13 minutes, dominated by the ~7 minute attestation wait. A live
  real-time demo is not possible; the demo pre-warms a proof.

## Credits

Built on the [Attestcoin Protocol](https://docs.attestcoin.org/) by Gluwa. Contract patterns follow
[`gluwa/attestcoin-protocol-examples`](https://github.com/gluwa/attestcoin-protocol-examples)
(Apache-2.0) rather than the documentation site, which is stale in places noted above.

## License

MIT — see [LICENSE](LICENSE).
