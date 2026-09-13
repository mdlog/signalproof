# FAQ and glossary

## Questions

**Why does this need the Attestcoin Protocol at all?**
Because the alternative is trusting someone. Without it, the Creditcoin contract would have to believe an oracle, a relayer or the gateway when they say a measurement happened. With it, the contract verifies that the Sepolia transaction was included in an attested block, then applies its own checks. No party in the middle can invent a measurement.

**Why commit on Sepolia and settle on Creditcoin instead of doing everything on one chain?**
The DePIN track asks for cross-chain data driving settlement, and the design separates two concerns cleanly: the source chain is a cheap, append-only commitment log; the destination chain is where verification, rewards and the buyer economy live. Attestcoin is the bridge that lets the destination check the source without trusting anyone.

**Is the dashboard showing real data?**
Yes. Every number is derived from a join of `MeasurementSubmitted` (Sepolia) and `MeasurementVerified` (Creditcoin). There is no fixture data, and the quality score is a stated formula over on-chain inputs. The only computed thing is the score itself.

**Does a good quality score earn a bigger reward?**
No. The reward is flat, 0.001 CTC per proven measurement. Paying more for good signal would penalise contributors for their operator's coverage; paying more for bad signal would invite faking it. See [Concepts](concepts.md#rewards).

**Why does a measurement take nine to thirteen minutes?**
Creditcoin attests Sepolia in batches of about ten blocks every two minutes, 35–45 blocks behind the head. The proof cannot exist before the block is attested. Everything else is seconds.

**Can I test from a laptop?**
Yes — it is the easiest way. You need a wallet extension and a usable location (`localhost` is a secure context; desktops without Wi-Fi location should use DevTools → Sensors). See [Quickstart](quickstart.md#testing-from-a-laptop).

**What does auto-measure do, and does it sign for me?**
It repeats the measurement every ten minutes while the tab is open and submits it, but every cycle still asks the wallet to sign, because the registry recovers the signature on chain. A reading not signed within 14 minutes is discarded.

**What stops one phone from running a hundred tests?**
The gateway admits 3 measurements per wallet per cell per 10 minutes, on top of nonce and root uniqueness, a 15-minute freshness window and the contract's 24-hour window. That is a policy, not a Sybil defence, and the docs say so.

**What happens if the relayer is malicious or offline?**
It can withhold or delay — that is the residual trust. It cannot forge attribution, forge a proof, replay a root or touch anyone's balance. Anything already committed can be settled by anyone, including the contributor's own wallet.

**Who buys the data?**
Operators and their vendors already pay for drive tests and crowdsourced quality data; venues and public programmes pay for coverage audits. What SignalProof sells is an area brief whose every number links to a settled proof. A buyer's payment lands in the reward pool that contributors claim from.

**Is location private if the area is on chain?**
The area is a geohash of at most six characters (~1.2 km × 0.6 km), enforced by the gateway. No coordinate is transmitted or stored anywhere; the map draws the cell, never a point.

**Why two settlement contracts?**
The single-proof contract shipped first and is immutable. The batch route was added for cost, and rather than replace a live contract, the newer one defers to its sibling before paying — which is also what closed the double-payment finding.

## Glossary

| Term | Meaning |
|---|---|
| **Area cell** | A geohash-6 cell, ~1.2 km × 0.6 km; the only location ever recorded |
| **Attestation** | Creditcoin's record of Sepolia block headers, advanced in batches; a source block can be proven only once attested |
| **Attestcoin Protocol** | Creditcoin's infrastructure for verified cross-chain data (formerly Universal Smart Contracts, USC) |
| **`ASCBase`** | Gluwa's base contract: calls the BlockProver precompile, deduplicates by `queryId`, then invokes the application hook |
| **BlockProver** | Precompile at `0x…0FD2` that verifies Merkle inclusion and continuity proofs |
| **ChainInfo** | Precompile at `0x…0fd3` listing supported source chains and attested heights |
| **Chain key** | Attestcoin's `uint64` identifier for a source chain; `1` = Sepolia on CC3 Testnet, resolved at runtime |
| **Continuity proof** | The walk from a block back to an attestation checkpoint; the expensive part of a verification, shared by a batch |
| **Contributor** | The wallet address that signed a measurement and accrues its reward |
| **Emitter binding** | The check that a proven log came from our registry, not a lookalike |
| **Measurement root** | `keccak256` of the canonical measurement payload; the key everything is joined on |
| **Merkle inclusion proof** | Siblings proving a transaction is in a block's transaction root |
| **Pull payment** | Rewards accrue to a balance the contributor withdraws with `claim()`; nothing is pushed |
| **Quality score** | 0–100 composite of latency and throughput, defined once in `shared/quality.ts` |
| **Relayer** | The one address the registry accepts; carries admitted measurements to Sepolia and pays gas |
| **Retired registry** | An earlier registry whose history is still read but which no longer accepts submissions |
| **Settlement** | The Creditcoin transaction that verifies the proof and accrues the reward |
| **Source registry** | `SourceBatchRegistry` on Sepolia, the commitment log |
