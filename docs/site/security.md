# Security model

What each party can and cannot do, the holes that were found during the build, and what is knowingly incomplete.

## Trust boundary

The boundary is the `MeasurementSubmitted` event on Sepolia. Everything before it decides what is **admitted**; everything after it decides what is **paid**.

| Party | Trusted for | Cannot |
|---|---|---|
| Browser | Taking an honest measurement | Attribute a measurement to another address (the wallet signs the root); place itself finer than a 1.2 km cell (the gateway caps geohash precision) |
| Gateway | Admission: freshness, root recomputation, signature recovery, uniqueness, rate limit | Reach a chain — it has no key; forge attribution — the signature is re-checked on chain |
| Relayer | Carrying admitted measurements to Sepolia; paying gas | Forge attribution (`SignatureMismatch`); replay a root (`AlreadyRegistered`); forge a proof; touch anyone's accrued balance. It *can* withhold or delay, and can be rotated with `setRelayer` |
| Proof worker | Fetching proofs and settling | Settle anything the precompile does not prove; settle a root twice; get paid for a proof — `execute()` is permissionless, so a stalled worker can be replaced by any relayer or by the contributor's own wallet |
| Settlement contract | The final decision | Trust any of the above: it checks inclusion (precompile), success (receipt status), emitter, replay (`queryId` and `measurementRoot`), freshness, and pays by pull |

## Controls, by attack

| Attack | Control | Where |
|---|---|---|
| Forged event from a lookalike contract | Emitter binding: `log.address_ == sourceRegistry` | `SignalProofSettlement._settleOne`, `test_forgedRegistryCannotSettleEvenWithValidProof` |
| Proving a failed transaction | `receipt.receiptStatus == 1` | same |
| Replaying a proof | `ASCBase.processedQueries[queryId]` and `settled[measurementRoot]` | `ASCBase`, `_settleOne` |
| Same measurement paid on both routes | Batch contract defers to `siblingSettlements` before paying | `SignalProofBatchSettlement._settledBySibling` |
| One poisoned log stranding a batch | Foreign logs are skipped and reported, never fatal | `ForeignLogSkipped` |
| Outsider submitting self-signed junk past the gateway | Registry accepts only the relayer | `NotAuthorised` |
| Relayer naming itself (or anyone) as payee | Registry recovers the contributor's EIP-191 signature on chain | `SignatureMismatch` |
| Tampered payload after signing | Gateway recomputes the root from the canonical payload | `MEASUREMENT_ROOT_MISMATCH` |
| Replaying another contributor's payload | `nonce` and `measurementRoot` uniqueness; public API never returns `signature`, `nonce`, `sessionHash` | gateway, store |
| Flooding one cell | 3 per contributor per cell per 10 min, applied after integrity so forgeries never consume a slot | `admitMeasurement` |
| Reverting `receive()` blocking settlement for everyone | Pull-payment rewards; no transfer on the verification path | `claim()` |
| Redeeming someone else's API purchase | Redeemer must sign as `tx.from`; keys are HMACs, nothing stored | `access.ts` |
| Bandwidth amplification through the throughput endpoint | Payload size clamped to 8 MB, same-origin | `/api/net/payload` |

## Findings

Each of these was found in review during the build, fixed, and kept in the test suite with its assertions inverted so that reopening the hole fails a test instead of quietly working.

1. **The registry was permissionless.** Anyone could call the real registry, name themselves as `contributor`, obtain a genuine inclusion proof and be paid for work nobody did. Emitter binding cannot tell "genuine but unauthorised" from "genuine". Fixed by gating admission to the relayer; redeployed. `AdvUnlimitedMint.t.sol`, `RegistryAuthorisation.t.sol`.
2. **One measurement paid twice.** Two settlement routes, one registry, two `settled` maps. Fixed by a sibling cross-check on the newer contract — a guarded `staticcall` that degrades to "no cross-check" rather than refusing everyone. `DoubleSettlement.t.sol`.
3. **One poisoned log killed a batch.** A Sepolia transaction that touched the registry and emitted a lookalike log made every batch containing it revert. Fixed by skipping and reporting foreign logs. `BatchPoison.t.sol`.
4. **The relayer could name the payee.** Gating on the relayer left one party fully trusted for attribution. Fixed by recovering the contributor's signature on chain; a vector signed with ethers is accepted by the contract. `SourceBatchRegistry.t.sol`.

None of these was a precompile flaw; every exploit used a genuine proof. Admission, attribution, replay and batching are where cross-chain security is won or lost.

## Infrastructure findings

- A public Sepolia endpoint answered half of identical `eth_getLogs` calls with an empty array. The read model re-asks empty answers and never lets a re-read shrink what it already served.
- A public gateway answered an ethers batch containing `eth_sendRawTransaction` with a lone HTTP 429 object, which ethers cannot match to a request; the send hung with no error. Sepolia senders use `batchMaxCount: 1`.

## Known limitations

- **The relayer is the admission point.** If it goes offline, new measurements wait. Anything already committed can be settled by anyone.
- **Attested ≠ finalized.** Attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag; a deep reorg could in principle invalidate an attested height.
- **Anti-Sybil is a rate limit**, not a defence. Device attestation, stake-weighted rewards and cell-level anomaly detection are not built; the on-chain record carries the fields (`areaHash`, `contributor`, `timestamp`) that scoring would need.
- **Buyer keys cannot be revoked individually**; only the secret can be rotated. There is no retention policy.
- **Read direction only.** Attestcoin write-ability has no public reference implementation and has not cleared third-party audit.
- **Not audited, testnet only.** The contracts have 75 Foundry tests, not an audit.

## Reporting

Open an issue on the repository. For anything that could drain the reward pool, email the maintainer instead (address on the GitHub profile) and allow a fix before disclosure.
