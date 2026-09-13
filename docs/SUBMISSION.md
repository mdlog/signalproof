<!-- trace: idea="SignalProof — verifiable connectivity data for DePIN: phone measurements committed on Ethereum Sepolia, proven by the Attestcoin Protocol, settled and rewarded on Creditcoin CC3 Testnet." | event="BUIDL CTC 2026 Fall" | deadline="2026-09-13 23:59 ET (2026-09-14 03:59 UTC) — re-verified live 2026-09-11 09:36 UTC: payload timelineEnd=1789358340, isExtended=true" | source=submission-packager -->
# Submission — BUIDL CTC 2026 Fall (DoraHacks)

**Portal:** https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail → "Submit BUIDL". One track
only (`isMultiTracksAllowed: false`): **DePIN**.
**Deadline:** September 13, 2026, 23:59:00 ET = **2026-09-14 03:59 UTC** = 2026-09-14 10:59 WIB.
Verified against the live payload at packaging time (`timelineEnd = 1789358340`, `isExtended: true`
— it was extended once already from Sept 6; do not assume a second extension).

**One value does not exist yet and must be filled before pasting:** `<DEMO_VIDEO_URL>` (no video
yet). The repository and the deck are live — their URLs are already in Fields 2, 6 and 7. Search
this file for `<` before you paste.

The form below mirrors the portal's `submissionForm` payload **field-for-field, in order**. Field 5
is labelled "USC Integration Summary" in the form and "Attestcoin Protocol Integration Summary" on
the page — same field; the Attestcoin Protocol was previously called Universal Smart Contracts.

---

## Field 1 — Project Name (required)

```
SignalProof
```

## Field 2 — Project Logo (Image URL — PNG, SVG, or AI; optional)

The raw URL of the PWA icon in the repo (512×512 PNG on white, the SignalProof mark — the blue S-ribbon with the Wi-Fi arc; transparent version at `client/public/logo.png`; regenerated 2026-09-13):

```
https://raw.githubusercontent.com/mdlog/signalproof/main/client/public/icon-512.png
```

## Field 3 — Project Sector (required)

```
DePIN
```

## Field 4 — Project Description (required)

```
A phone measured its network. Eight and a half minutes later a contract on Creditcoin paid for that measurement — without trusting the phone, the server, or the relayer that carried it. It trusted a proof.

Live at https://signalproof.mdloglabs.org — dashboard, public verifier, metered buyer API and ops panel, reading Creditcoin CC3 Testnet and Ethereum Sepolia; open it on a phone to contribute a measurement.

SignalProof is verifiable connectivity data for DePIN. Anyone can claim coverage numbers; nobody can prove them. Operators buy drive tests and crowdsourced quality reports whose provenance is a spreadsheet. SignalProof makes the claim checkable: a measurement is committed as a hash on Ethereum Sepolia, proven to exist there by the Attestcoin Protocol, and settled on Creditcoin CC3 Testnet, where a contract verifies the cross-chain proof and accrues a reward to the contributor.

What is built and live on testnet:

- A browser measurement client that measures rather than asks: latency as the median of seven timed round trips read from Resource Timing, throughput from a 3 MB incompressible stream (the browser's own navigator.connection.downlink under-reported a real 40.8 Mbps link as 7.5), a precision-6 geohash for the area (~1.2 km x 0.6 km — the raw coordinate never leaves the function), and the browser's network class. The wallet is an identity, not a signer: the relayer pays gas on both chains, and the only user transaction is claim().
- A gateway that recomputes the commitment, recovers the contributor's EIP-191 signature, enforces freshness, uniqueness and a per-cell rate limit (3 per contributor per cell per 10 minutes), and never returns signature, nonce or sessionHash.
- SourceBatchRegistry on Sepolia — relayer-gated AND verifying the contributor's signature on-chain, so the relayer cannot forge attribution — with SignalProofSettlement and SignalProofBatchSettlement on CC3 Testnet: all verified on their explorers, eighteen live cross-chain settlements from six contributors across three geohash cells, including a 3-in-1 batch under one continuity proof, a 9.8-minute run through the signed registry, and a claim that moved 0.001 CTC from the pool to a contributor.
- A dashboard whose entire read model is a join of MeasurementSubmitted (Sepolia) and MeasurementVerified (Creditcoin). No database is needed to demo; a clone with RPC URLs shows real settlements. Every proof-queue row opens the live Attestcoin proof (attested height, Merkle path, continuity roots, the exact execute() call), and a pending row can be settled from the contributor's own wallet — execute() is permissionless, and the button shows it. The coverage map decodes each geohash and draws the cell, never a point; areas that are not geohashes are listed as unmapped rather than placed.
- A buyer API whose access is paid into the reward pool: a buyer sends 0.05 CTC to SignalProofSettlement (its receive() credits the pool contributors claim() from), signs the transaction hash, and receives a stateless HMAC key that opens /v1/areas/{geohash}, /brief, /export.csv and /export.json. The catalog, the public verifier and the badges are free — what is metered is the service, not the data, which is public on two chains. First purchase on chain: 0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30 (pool 4.997 → 5.047 CTC).
- A public verifier, /verify/{hash}: a measurement root, the Sepolia commitment or the Creditcoin settlement resolves to the four-step rail — commitment, attestation, proof, settlement — each with its transaction, plus the Attestcoin proof; a hash outside the scanned window is reported as not found, never as invalid. An area page per geohash (cell on the map, quality over time, every sample, CSV/JSON export, an embeddable badge), a contributors leaderboard with per-address history and claim, an operations panel (relayer balances on both chains, pool runway in settlements, worker and RPC health, attestation lag), and an auto-measure mode that runs the same measurement every 10 minutes with a wallet signature per cycle.

How it fits the DePIN track sentence, clause by clause: phones are the sensor nodes; MeasurementSubmitted attested by Attestcoin and consumed on CC3 is the cross-chain data; rewards[contributor] + claim() is the incentive; SignalProofSettlement is the settlement; per-area aggregation on the map is the coordination layer.

Four things we found and fixed during the build, kept as inverted exploit tests: the first registry was permissionless, so anyone could name themselves payee, obtain a genuine proof and be paid for work nobody did (now relayer-gated); the batch route let one measurement be paid on both routes (now cross-checked against the sibling contract, skipped rather than reverted so one paid entry cannot strand a batch); a co-emitted lookalike log could strand every batch containing it (foreign logs are skipped and reported); and the relayer itself could name the payee (the registry now recovers the contributor's signature on-chain — a vector signed with ethers is accepted by the contract, so the TypeScript client and Solidity agree byte for byte).

What is not built, stated plainly: no native app (the browser client is the measurement client; auto-measure needs a wallet signature per cycle by design), anti-Sybil is a rate limit and not a defence, buyer keys are stateless so a single key cannot be revoked and there is no retention policy, read direction only, and end-to-end latency of 9–13 minutes dominated by attestation. Nothing in the UI claims an on-chain result that does not exist.

75 Foundry tests, 156 Vitest tests, pnpm smoke passes from a clean machine, pnpm e2e:surface checks the whole product surface against the live chains (28/28), and the whole thing runs in one container. MIT.
```

## Field 5 — USC Integration Summary / Attestcoin Protocol Integration Summary (required)

This is the field the only published criterion scores ("Depth of Attestcoin Protocol utilization").
It is written to be read by the Creditcoin protocol engineer first.

```
SignalProof uses the Attestcoin Protocol (formerly Universal Smart Contracts / USC) in the read direction: Ethereum Sepolia (11155111) is the source chain, Creditcoin CC3 Testnet (102031) is the destination. A phone's measurement is committed on Sepolia and a Creditcoin contract accepts it only after the BlockProver precompile has proven it. The Creditcoin contract is the only place that decides whether a measurement is real; it does not trust the gateway, the relayer, or the submitter — only the proof.

1. Destination contract — ASCBase, one hook, two checks the precompile does not do

SignalProofSettlement (CC3 Testnet, 0x8F14B2cC1b807203d332DE6E3DA6274176FDb584) inherits ASCBase from @gluwa/asc-contracts 0.2.1 and overrides exactly one function, _processAndEmitEvent. ASCBase.execute() (selector 0xc6339bf7) calls the BlockProver precompile at 0x0000000000000000000000000000000000000FD2, which verifies the Merkle inclusion proof and the continuity proof for a transaction in an attested Sepolia block, deduplicates by queryId, and only then hands the hook the RLP-encoded transaction and receipt.

The precompile proves exactly one thing: that a transaction was included in a block genuinely belonging to the attested source chain. It does NOT prove the transaction succeeded, and it does NOT prove which contract emitted the logs inside it. Both are the application's job, and both are in our hook:

  if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);   // inclusion is not success
  if (log.address_ != sourceRegistry) revert WrongEmitter(log.address_, sourceRegistry);   // emitter binding

Without the second check, anyone can deploy a lookalike contract on Sepolia, emit a byte-identical MeasurementSubmitted, obtain a proof the precompile accepts, and drain the reward pool. That check is absent from the SimpleMinterASC example on the documentation site and present in Gluwa's own ASCLoanManager; we mirror the latter and its regression test (test_rejectsWrongEmitter, and the whole-system test_forgedRegistryCannotSettleEvenWithValidProof in contracts/test/EndToEnd.t.sol, where an attacker controls their own registry and holds a valid proof — only the binding stops them).

After those two checks the hook decodes every MeasurementSubmitted log with EvmV1Decoder, rejects a measurementRoot already in settled (a second replay layer behind ASCBase's queryId ledger, because one guards the source transaction and the other guards the measurement), rejects a timestamp older than maxMeasurementAge (24 h) or in the future, reads the contributor from topics[3], accrues rewardAmount (0.001 CTC) to rewards[contributor], and emits MeasurementVerified(measurementRoot, areaHash, contributor, rewardAmount, queryId). Rewards are pull-payments: no value moves on the verification path, so a contributor with a reverting receive() cannot block settlement for anyone else. execute() is permissionless by design — any relayer may submit a valid proof — so all authorisation lives in the hook, never in a caller check.

2. Batch route — many measurements, ONE continuity proof

ASCBase wires only the single-proof overload of the precompile. The precompile also exposes a batch overload: verifyAndEmit(chainKey, heights[], encodedTransactions[], merkleProofs[], sharedContinuityProof). SignalProofBatchSettlement (0x3B90e22f246bBa68f6de682b564c33b121D68C85) calls it directly from executeBatch(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions, MerkleProof[] merkleProofs, ContinuityProof sharedContinuityProof): one precompile call and one continuity walk for the whole set. The continuity proof walks the attestation chain back to a checkpoint and is the expensive part of a verification, so this is where the saving is. The worker groups pending rows whose proofs share an identical continuity proof (same lowerEndpointDigest and roots) and settles each group in one transaction, capped at 50 entries. Per-entry checks are the same as the single route; a bad entry is skipped, not fatal (a foreign emitter is reported via ForeignLogSkipped, a stale or already-paid root is left out), and only a batch that settles nothing reverts (NoMeasurementSettled). Because the single-route contract shipped first and is immutable, the batch contract holds siblingSettlements (max 4) and defers to any root a sibling already paid — a staticcall with an explicit success check, so a misconfigured sibling degrades to "no cross-check", never to a route that refuses every honest measurement.

Measured on-chain: 3 measurements settled in one transaction at 253,284 gas (9 continuity roots) and 423,360 gas (2 roots) across two live runs, against 150,640 gas for one single-route settlement. Two runs are not enough to state a saving, so contracts/test/BatchGasProbe.t.sol holds the proof shape fixed and varies only n: marginal entry 44,892 gas at n=10, 51,015 at n=50, 71,165 at n=200 — rising, because the decoder's memory expansion is quadratic. That is why the cap is 50, not the block ceiling (~600 entries in a 75M-gas CC3 block).

3. Source contract — SourceBatchRegistry (Sepolia, 0x32c0923cD58523864D2727FCaaB109783664c236)

Emits MeasurementSubmitted(bytes32 indexed measurementRoot, bytes32 indexed areaHash, address indexed contributor, bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps). It stores no coordinates, no raw payload, no identity beyond the reward address. submitMeasurement takes the contributor's EIP-191 signature and recovers the signer on-chain from the exact text the wallet displayed (rebuilt in Solidity byte for byte from the client's buildMeasurementSigningMessage; a vector produced with ethers is accepted by the contract in contracts/test/SourceBatchRegistry.t.sol), and it reverts unless msg.sender == relayer. Two layers for two attackers: the gate carries the gateway's admission checks (freshness, geohash precision, uniqueness, rate limit) on-chain, so an outsider with a valid signature is still refused; the signature makes attribution a claim by the contributor, so the relayer cannot name a payee who did not sign. The first deployment was permissionless — emitter binding on Creditcoin cannot distinguish "genuine but unauthorised" from "genuine" — and the second trusted the relayer for attribution; the settlement contracts were repointed with setSourceRegistry each time and the retired gated registry's history is still read (RETIRED_REGISTRIES). contracts/test/AdvUnlimitedMint.t.sol keeps the original exploit with its assertions inverted.

4. How the SDK is actually driven (server/signalproof/, @gluwa/usc-sdk 0.18.0)

- chainKey is resolved at startup from ChainInfo (precompile 0x…0fd3) via PrecompileChainInfoProvider.getSupportedChains(), matched on chainId === 11155111 — never hardcoded, never matched by name. It is a uint64; the chain returns chainName hex-encoded (0x5365706f6c696120657468657265756d), and key 1 means a different chain on Mainnet. The configured ATTESTCOIN_CHAIN_KEY is only a cross-check; the resolved value wins and a disagreement is logged.
- Attestation wait: one getLatestAttestedHeightAndHash read per 15 s tick, reused for every pending row. waitUntilHeightAttested blocks 8–20 minutes and would freeze the queue behind the first row.
- ProofBuilder.getProof(txHash) with an explicit 120 s timeout and our own backoff (the constructor default is 10 s with no retry); the result is a ProofResult, so we check .success and unwrap .data — skipping the unwrap leaves chainKey undefined at runtime.
- estimateGas fails against precompiles even when the call succeeds (pallet-evm does not propagate revert reasons in estimation), so it runs in try/catch with a manual fallback and a 35% buffer.
- Results are read from the transaction receipt, never from a log filter; every 20 ticks the worker reconciles against chain state so a row is never left AWAITING_ATTESTATION after it was paid.
- Deploying to CC3 uses forge create, not forge script: CC3 headers carry no mixHash and Foundry's shanghai simulation aborts with "prevrandao not set" before sending.
- Sepolia transactions go out one JSON-RPC request at a time (batchMaxCount: 1): ethers v6 batches the three calls behind broadcastTransaction, and Tenderly's public gateway answers a batch that carries eth_sendRawTransaction with a lone HTTP 429 object, which ethers cannot match to a request — the send hangs silently. Found and fixed while proving the signed registry live.

5. Proven on-chain (all links open)

- One complete run, 8.5 minutes end to end: Sepolia commit https://sepolia.etherscan.io/tx/0x22474613e60df0650456a3ff9fd93211b833e70bbe8ef3910238e30eb82368f7 → attestation reached the block after 8.3 min (lag 35 blocks, advancing 10 at a time) → 7 Merkle siblings, 6 continuity roots, 1,952-byte txBytes → settled https://creditcoin-testnet.blockscout.com/tx/0x26c87ed0d7dda10b864c7a6907dad4c52d19d2f449ff73eabc4db099736d5c13 (150,640 gas, MeasurementVerified, 0.001 CTC accrued) → claimed https://creditcoin-testnet.blockscout.com/tx/0x14853610d5d9ae99ade6fdca0cb3c0ead461d29baf252b18c2cfa48b83fe0030 (pool 5.000 → 4.999 CTC).
- Batch, 3 measurements from 1 proof in 1 transaction: https://creditcoin-testnet.blockscout.com/tx/0xcf1a01c55052ef604494ee53c717f9401019d7fb56c6681fb1e11f2559c49598 and https://creditcoin-testnet.blockscout.com/tx/0xb0933ed93237f0eb011ec012fa60d9aac15d935a8c9468e2980a4df0d732d990 — three MeasurementVerified plus one BatchSettled each.
- Gateway to chain with no database: a POST relayed itself on the next tick and settled unattended — https://sepolia.etherscan.io/tx/0x17e8c0c317c034c73c5f7a5c7decd92df4c9c91371430af8d1ca7da325c90683 → https://creditcoin-testnet.blockscout.com/tx/0x87bc9d13181e76c9dc250a64423f3d26ff2a4e4d425d9673b7cfd5aabf3d5ae4.
- First run through the signed registry, 9.8 minutes end to end: https://sepolia.etherscan.io/tx/0xbd7261e655c751f9a38acc116808acd3a0c0b0fd14279fe4fad207c742d57223 (block 11,681,452, signature recovered on-chain) → attested after 9.6 min → 7 Merkle siblings, 9 continuity roots, 2,112-byte txBytes → settled https://creditcoin-testnet.blockscout.com/tx/0x60d9e438e8549a101b144bd1e474475301c696640062601ddfd18f788e6aa2b5 (154,224 gas, contributor 0.005 → 0.006 CTC).
- The dashboard's "View proof" shows this same proof for any measurement, fetched with no key (attested height, Merkle siblings, continuity roots, the exact execute() calldata), and "Settle from my wallet" sends that calldata from the contributor's wallet — execute() is permissionless, and this makes it visible.
- pnpm smoke, from a clean clone with no key: resolves chainKey=1 for Sepolia, reads the latest attested height and its lag (44 blocks ≈ 8.8 min on 2026-09-11), and brackets an attested height between parent and child.

6. Known limitations of the integration, stated rather than discovered

Attested is not finalized: attestation runs 65–85 blocks ahead of Sepolia's finalized tag, so a deep reorg could in principle invalidate an attested height; this is also why the pipeline is fast enough to use. Read direction only: write-ability has no public reference implementation and has not cleared third-party audit. End-to-end latency is 9–13 minutes, dominated by the ~7-minute attestation wait; the demo pre-warms a measurement. Proving a 24-hour-old transaction costs roughly 10x more gas once the dense attestation is replaced by sparse checkpoints, so the worker proves fresh transactions.

Technical documentation: README.md (integration section, deployment, status machine, security notes) and docs/TECHNICAL_ARCHITECTURE.md (as-built). Contract patterns follow github.com/gluwa/attestcoin-protocol-examples (Apache-2.0), not the documentation site, which is stale in the places noted above.
```

## Field 6 — GitHub Repository URL (must include a README; required)

```
https://github.com/mdlog/signalproof
```

Verified 2026-09-11: the repo is **public**; `README.md` is at the root; `contracts/lib/forge-std`
is a pushed submodule (`git clone --recursive`, or `forge install` in `contracts/`, documented in
README "Run it"); `LICENSE` (MIT) is present; `.env` is **not** committed (`.env.example` is, pre-filled
with the public deployment); the stale "signatures not yet cryptographically verified" bullet is
corrected in README, `docs/TECHNICAL_ARCHITECTURE.md` and `todo.md`; a clean recursive clone passes
`forge test` 67/67 and `pnpm verify` exits 0. Commits are authored by `mdlog` and carry no
AI attribution.

## Field 7 — Project Deck or Whitepaper (PDF URL; required)

```
https://raw.githubusercontent.com/mdlog/signalproof/main/docs/deck/SignalProof-deck.pdf
```

Live (HTTP 200, 12 pages, ~0.6 MB). Source is `docs/deck/SignalProof-deck.html`, rendered with
headless Chrome: `google-chrome --headless=new --no-pdf-header-footer --print-to-pdf=SignalProof-deck.pdf SignalProof-deck.html`.
Slide 12 carries the demo video URL (re-rendered 2026-09-13 after the upload). The 12 slides, in order:

1. **Title** — one-liner, the pipeline as five stations, event and track.
2. **Anyone can claim coverage numbers. Nobody can prove them.** — who claims, why it is unverifiable, what SignalProof changes.
3. **One measurement, two chains, one decision** — the five steps with timings; admitted vs paid.
4. **What the precompile proves, and the two things it does not** — `ASCBase` hook, receipt status, emitter binding, `chainKey`, polling, `getProof`; replay layers, batch route, pull payments.
5. **Deployed, verified, and settled on-chain** — three addresses, the 9.8-minute run through the signed registry with hashes, 3-in-1 batch, 75 + 127 tests.
6. **Four ways to get paid for nothing, found and closed before submission** — permissionless registry, double settlement, poisoned batch, relayer-named payee; each kept as an inverted exploit test.
7. **Batching is cheaper per entry, and it gets more expensive as it grows** — the gas probe table, why the cap is 50.
8. **The dashboard reads the chains, not a database** — three live screenshots.
9. **Buyers pay contributors. Anyone can check the receipt** — paid access into the pool, the verifier, area page, contributors, ops, auto-measure.
10. **Coarse by construction. Measured, not asked** — geohash-6, wallet as identity, measured vs `navigator.connection`.
11. **What is not done, stated before a judge finds it** — known limitations and the next 90 days.
12. **Why this belongs on Creditcoin** — the buyer, the proof as product, links (including the first paid-access transaction).

## Field 8 — Prototype Demo Video URL (required)

```
https://youtu.be/a8pT_0w3Qa8
```

YouTube, 4:07, 1080p, English narration with burned-in captions and chapters (0:00 settled
measurement · 0:18 problem · 0:39 pipeline · 1:13 a real measurement signed in MetaMask · 1:52 the
proof · 2:12 receipt-status and emitter-binding checks · 2:50 settled · 3:02 buyer side · 3:40
operations and contributors · 3:55 links). Script: `docs/VIDEO_SCRIPT.md`. No organizer length
limit is published (`DATA TIDAK DITEMUKAN` in the brief). Every number on screen was read from the
live host at record time; the measurement in shot 4 (`0x98cC…b5E7`, cell `qxhftw`) is the one
that settles in shot 7. Opened in a private window before pasting: plays.

---

## Team registration — every member, individually, before submitting

DoraHacks collects these on each member's **own** registration (payload `registrationForm`); they
cannot be filled at submit time on someone's behalf. Team size and member details are not recorded
in this repo — each member completes their own row.

| # | Field | Required | Member 1 | Member 2 | Member 3 |
|---|---|---|---|---|---|
| 1 | First & Last Name | yes | ☐ | ☐ | ☐ |
| 2 | Email | yes | ☐ | ☐ | ☐ |
| 3 | Telegram ID | no | ☐ | ☐ | ☐ |
| 4 | X / Twitter | no | ☐ | ☐ | ☐ |
| 5 | LinkedIn | no | ☐ | ☐ | ☐ |
| 6 | Resume (PDF URL) | no | ☐ | ☐ | ☐ |
| 7 | Short Bio | yes | ☐ | ☐ | ☐ |
| 8 | Role within the team | yes | ☐ | ☐ | ☐ |
| 9 | Country of Residence | yes | ☐ | ☐ | ☐ |
| 10 | Country of Citizenship | yes | ☐ | ☐ | ☐ |

Eligibility, per the rules (all members): no criminal record, no pending criminal cases, not a
resident of a sanctioned country, not a sanctioned individual, legally permitted to participate.
Minimum team size is 1; delete unused columns.

---

## Deliverables checklist — ticked line-by-line against `docs/HACKATHON_BRIEF.md`

| Brief item (mandatory) | Status | Where the judge finds it |
|---|---|---|
| Working Attestcoin Protocol integration code running within the project | ✓ done | `contracts/src/SignalProofSettlement.sol`, `contracts/src/SignalProofBatchSettlement.sol`, `server/signalproof/{chain,relayer,proofWorker}.ts`; live tx hashes in README |
| Technical documentation detailing setup and how the project uses the Attestcoin Protocol | ✓ done | `README.md` ("Attestcoin Protocol integration", "Run it", "Reproducing the deployment"), `docs/TECHNICAL_ARCHITECTURE.md` §3 |
| Deployed on a testnet | ✓ done | Sepolia `0x32c0…c236` (signed registry; retired `0x15F3…59Dc` still read); CC3 Testnet `0x8F14…b584`, `0x3B90…8C85` — all verified on explorers |
| Attestcoin Protocol as a core feature | ✓ done | Settlement cannot happen without the proof; there is no non-Attestcoin path to a reward |
| GitHub Repository URL (must include a README) — form field 6 | ✓ done — https://github.com/mdlog/signalproof | Field 6 above |
| Project Deck or Whitepaper (PDF URL) — form field 7 | ✓ done — raw GitHub PDF, 12 slides (re-rendered 2026-09-13) | Field 7 above |
| Prototype Demo Video URL — form field 8 | ✓ done — https://youtu.be/a8pT_0w3Qa8 (4:07, uploaded 2026-09-13) | Field 8 above |
| USC / Attestcoin Integration Summary — form field 5 | ✓ written | Field 5 above |
| Project Name, Sector, Description — form fields 1, 3, 4 | ✓ written | Fields 1, 3, 4 above |
| Project Logo (optional) — form field 2 | ✓ done — raw GitHub PNG, HTTP 200 | Field 2 above |
| Every team member registered with Country of Residence + Country of Citizenship | ☐ **pending** — each member | Registration table above |

## DQ red flags — each explicitly confirmed avoided

| Red flag (from the brief) | Confirmation |
|---|---|
| Deadline extended once; re-check on the day | ✓ Re-verified 2026-09-11 09:36 UTC on the live payload: `timelineEnd = 2026-09-14T03:59:00Z`, `isExtended: true`, `timelineOldEnd = 2026-09-06`. **Re-check again on 2026-09-13** — the payload URL is `https://dorahacks.io/hackathon/buidl-ctc-2026-fall/_payload.json` (curl with a browser UA and `-4`). Submit with hours to spare; DoraHacks closes the form at the timestamp. |
| Deck must be a **PDF URL**; video must be a **URL** | ☐ confirm both open in a private window before pasting (fields 7, 8) |
| Single track only; DePIN is final | ✓ Sector field = `DePIN`; description maps the DePIN track sentence |
| "Must be original work created during the hackathon" (Aug 13 – Sep 13) | ✓ Contracts, worker, measurement client, dashboard read model and docs were built 2026-09-07 → 09-11; first commit 2026-09-11. ☐ **Team to confirm** that the pre-existing UI shell / gateway scaffold the design doc mentions ("UI prototipe fixture dan gateway tRPC + MySQL") was also created on or after Aug 13; if any of it predates the window, say so in the Description in one sentence ("scaffolded from a template; everything Attestcoin-related was built during the event"). Honest disclosure is never a DQ; discovery is. |
| "Must be deployed on a testnet" | ✓ Sepolia + CC3 Testnet, verified |
| "Must integrate the Attestcoin Protocol as a core feature" | ✓ see Field 5 |
| "Must respect and not infringe on third-party IP rights"; "possess full rights and ownership" | ✓ MIT-licensed; Gluwa patterns credited (Apache-2.0); `@gluwa/asc-contracts` and `@gluwa/usc-sdk` used as published packages; OpenStreetMap tiles carry the required attribution in `CoverageMap.tsx` |
| "All submitted information is accurate and truthful" | ✓ Every number in fields 4–5 is traceable to README, the tests, or an explorer link; nothing claims an on-chain result that does not exist |
| Repo must include a README | ✓ `README.md` at the root |
| Every member's Country of Residence + Citizenship | ☐ each member, in their own registration |

**DEADLINE STATUS: VERIFIED LIVE 2026-09-11.** If the payload cannot be fetched on submission day,
treat the deadline as **2026-09-14 03:59 UTC** and submit no later than **2026-09-13 20:00 UTC**.
