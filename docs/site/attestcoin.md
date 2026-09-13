# Attestcoin integration

How SignalProof uses the Attestcoin Protocol (formerly Universal Smart Contracts / USC), in the read direction: Ethereum Sepolia is the source chain, Creditcoin CC3 Testnet the destination.

## What the protocol provides

CC3 Testnet exposes two precompiles and a hosted proof service:

| Piece | Address / endpoint | Role |
|---|---|---|
| `ChainInfo` precompile | `0x0000000000000000000000000000000000000fd3` | Lists supported source chains and the latest attested height per chain |
| `BlockProver` precompile | `0x0000000000000000000000000000000000000FD2` | Verifies a Merkle inclusion proof and a continuity proof for a transaction in an attested source block |
| Proof service | `ATTESTCOIN_PROOF_SERVICE_URL` (`prover.cc3-testnet.creditcoin.network`) | Builds those proofs; wrapped by `@gluwa/usc-sdk` 0.18.0 |

The precompile proves **exactly one thing**: that a transaction was included in a block genuinely belonging to the attested source chain. Everything else is the application's job.

## Destination contract: `ASCBase` and one hook

`SignalProofSettlement` inherits `ASCBase` from `@gluwa/asc-contracts` 0.2.1 and overrides `_processAndEmitEvent`. `ASCBase.execute()` (selector `0xc6339bf7`) calls the precompile, deduplicates by `queryId`, and only then invokes the hook with the RLP-encoded transaction and receipt. Inside the hook:

1. **Inclusion is not success.** `if (receipt.receiptStatus != 1) revert SourceTransactionFailed(...)`.
2. **Emitter binding.** `if (log.address_ != sourceRegistry) revert WrongEmitter(...)`. Without this, a lookalike contract on Sepolia could mint provable events and drain the pool. The check is absent from the `SimpleMinterASC` example on the documentation site and present in Gluwa's own `ASCLoanManager`; SignalProof mirrors the latter and its regression test, plus a whole-system test (`test_forgedRegistryCannotSettleEvenWithValidProof`) where an attacker controls their own registry and holds a proof the precompile accepts.
3. **Second replay layer.** `settled[measurementRoot]` on top of `ASCBase`'s `processedQueries[queryId]` — one guards the source transaction, the other the measurement.
4. **Freshness.** `MeasurementTooOld` beyond `maxMeasurementAge` (24 h), `MeasurementInFuture` otherwise.
5. **Reward.** `rewards[contributor] += rewardAmount` (pull-payment; nothing is transferred on the verification path) and `MeasurementVerified` is emitted.

`execute()` is permissionless by design: all authorisation lives in the hook, never in a caller check. The dashboard's **Settle from my wallet** button sends the same calldata the worker would, from the contributor's own wallet.

## Batch route: many measurements, one continuity proof

The precompile also exposes a batch overload, which `ASCBase` does not wire. `SignalProofBatchSettlement.executeBatch(chainKey, heights[], encodedTransactions[], merkleProofs[], sharedContinuityProof)` verifies a set of transactions with one precompile call and one continuity walk — the expensive part of a verification. The worker groups pending rows whose proofs share an identical continuity proof and settles each group in one transaction, capped at 50 entries.

Per-entry checks are the same as the single route, but a bad entry is *skipped, not fatal*: a foreign emitter is reported through `ForeignLogSkipped`, a stale or already-paid root is left out, and only a batch that settles nothing reverts (`NoMeasurementSettled`). Because the single-route contract shipped first and is immutable, the batch contract holds `siblingSettlements` (max 4) and defers to any root a sibling already paid — a guarded `staticcall`, so a misconfigured sibling degrades to "no cross-check" rather than refusing every honest measurement.

Measured live: three measurements settled in one transaction at 253,284 and 423,360 gas, against 150,640–154,224 gas for one single-route settlement. The controlled probe (`BatchGasProbe.t.sol`) holds the proof shape fixed: the marginal entry costs 45–71k gas and *rises* with batch size, because the decoder's memory expansion is quadratic. Hence the cap at 50, not at the ~600-entry block ceiling.

## How the SDK is driven

| Step | Implementation | Why |
|---|---|---|
| Resolve `chainKey` | At startup from `ChainInfo.getSupportedChains()`, matched on `chainId === 11155111` | It is a `uint64`, `chainName` comes back hex-encoded, and key `1` means a different chain on Mainnet — never hardcode it |
| Wait for attestation | One `getLatestAttestedHeightAndHash` read per 15 s tick | `waitUntilHeightAttested` blocks 8–20 min and would freeze the queue |
| Build the proof | `ProofBuilder.getProof(txHash)`, 120 s timeout, own backoff; unwrap `.data` | The SDK default is 10 s with no retry; the return type is `ProofResult`, not the proof |
| Submit | `execute` / `executeBatch` with `estimateGas` in try/catch, 35 % buffer, manual fallback | Estimation fails against precompiles even when the call succeeds |
| Read the result | From the transaction receipt, never a log filter | Filter-based polling breaks on nodes that expire filters |
| Send to Sepolia | One JSON-RPC request per call | A public gateway hangs ethers' batched `eth_sendRawTransaction` |
| Deploy to CC3 | `forge create`, not `forge script` | CC3 headers carry no `mixHash`; Foundry's shanghai simulation aborts |

## Proof inspector

Every row in the proof queue can open **View proof**: the server fetches the proof for that transaction through a keyless read context and shows what the precompile is given — attested height and transaction index, RLP-encoded transaction size, the Merkle root and each sibling with its side, the continuity roots and lower endpoint digest, and the exact `execute()` call (selector, calldata size, gas ceiling). For a block Creditcoin has not attested yet it says so.

## Recorded runs

| Run | Sepolia | Attestation | Proof | Creditcoin |
|---|---|---|---|---|
| First live settlement | [`0x224746…368f7`](https://sepolia.etherscan.io/tx/0x22474613e60df0650456a3ff9fd93211b833e70bbe8ef3910238e30eb82368f7), block 11,656,985 | 8.3 min | 7 siblings, 6 roots, 1,952 bytes | [`0x26c87e…d5c13`](https://creditcoin-testnet.blockscout.com/tx/0x26c87ed0d7dda10b864c7a6907dad4c52d19d2f449ff73eabc4db099736d5c13), 150,640 gas |
| First run through the signed registry | [`0xbd7261…7223`](https://sepolia.etherscan.io/tx/0xbd7261e655c751f9a38acc116808acd3a0c0b0fd14279fe4fad207c742d57223), block 11,681,452 | 9.6 min | 7 siblings, 9 roots, 2,112 bytes | [`0x60d9e4…a2b5`](https://creditcoin-testnet.blockscout.com/tx/0x60d9e438e8549a101b144bd1e474475301c696640062601ddfd18f788e6aa2b5), 154,224 gas |
| Batch, 3 measurements in 1 tx | — | — | 9 roots shared | [`0xcf1a01…c49598`](https://creditcoin-testnet.blockscout.com/tx/0xcf1a01c55052ef604494ee53c717f9401019d7fb56c6681fb1e11f2559c49598), 253,284 gas |

## Limits of the integration

- **Attested is not finalized.** Attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag; a deep reorg could in principle invalidate an attested height. This is also why the pipeline is fast enough to use.
- **Read direction only.** Write-ability has no public reference implementation and has not cleared third-party audit.
- **Prove fresh transactions.** Proving a 24-hour-old transaction costs roughly 10× more gas once dense attestation is replaced by sparse checkpoints; the worker proves promptly.
