<!-- trace: idea="SignalProof — verifiable connectivity data for DePIN: phone measurements committed on Ethereum Sepolia, proven by the Attestcoin Protocol, settled and rewarded on Creditcoin CC3 Testnet." | event="BUIDL CTC 2026 Fall" | deadline="2026-09-13 23:59 ET (2026-09-14 03:59 UTC) — re-verified live 2026-09-11 09:36 UTC: payload timelineEnd=1789358340, isExtended=true" | source=submission-packager -->
# Judge Q&A — SignalProof

Projects die in Q&A, not in the demo. This event has no live Q&A slot (online, video + writeup),
but the same questions arrive as comments on the BUIDL page, in `#buidl-ctc-qna`, and in CEIP due
diligence. Every answer below is written from the code and the on-chain record as of 2026-09-11,
not from what we wish were true. Where the team must add something only they know, the line is
marked **TEAM TO CONFIRM**.

## Say this before anyone asks — the real-vs-mocked disclosure

> Everything on the demo path is live against Ethereum Sepolia and Creditcoin CC3 Testnet: the
> measurement is taken on the device, the gateway really recomputes the root and recovers the
> signature, the relayer really commits to Sepolia, the worker really waits for attestation and
> fetches a proof, the BlockProver precompile really verifies it, the contract really accrues the
> reward, and `claim()` really moves CTC. The dashboard is a join of the two chains' logs — there is
> no database behind it and no fixture in it. What is **not built**: the buyer API ("Create area
> brief" is disabled and says so), anti-Sybil scoring, a native client, and on-chain verification
> of the contributor signature. The one deliberately "fake" thing in the UI is the tampered-payload
> demo, and even that is a real submission the gateway really rejects.

## Top 10 hardest questions (ranked by how much damage a bad answer does)

**1. Why does this need the Attestcoin Protocol? (the sponsor-native question)**
Because the product claim is that a Creditcoin contract accepted a measurement without trusting
anyone who handled it, and the only way to get a Sepolia event into a Creditcoin contract without an
oracle operator is a proof the chain itself verifies — which is what the BlockProver precompile
does inside `ASCBase.execute()`. Remove Attestcoin and `SignalProofSettlement` has to believe a
relayer's word, which is exactly the status quo of coverage data that we are replacing.

**2. What did you do beyond the tutorial? Where is the depth?**
Six places, each forced by running against the live chains rather than reading the docs: (i) the
batch overload of the precompile's `verifyAndEmit`, which `ASCBase` does not wire, called directly
from `SignalProofBatchSettlement.executeBatch` so one continuity proof settles many measurements;
(ii) `chainKey` resolved from `ChainInfo.getSupportedChains()` by `chainId`, because it is a
`uint64`, the name comes back hex-encoded, and key `1` means a different chain on Mainnet;
(iii) attestation polled once per 15 s tick instead of the SDK's `waitUntilHeightAttested`, which
blocks 8–20 minutes; (iv) `ProofBuilder` with a 120 s timeout and `.data` unwrapped from
`ProofResult`; (v) `estimateGas` in try/catch because it fails against precompiles; (vi) `forge
create` instead of `forge script` because CC3 headers carry no `mixHash`. Plus the check the docs'
`SimpleMinterASC` example omits (Q3) and a gas probe of the batch curve to n=200.

**3. What does the precompile not check, and what happens if you forget?**
It proves inclusion of a transaction in an attested source block — not that the transaction
succeeded, and not which contract emitted the logs. We revert on `receipt.receiptStatus != 1`
(`SourceTransactionFailed`) and on `log.address_ != sourceRegistry` (`WrongEmitter`); without the
second, anyone deploys a lookalike on Sepolia, emits a byte-identical `MeasurementSubmitted`, proves
it, and drains the pool — `test_forgedRegistryCannotSettleEvenWithValidProof` in
`contracts/test/EndToEnd.t.sol` runs exactly that attack and only the binding stops it.

**4. Can a caller attribute a measurement to any address? What stops someone submitting on my behalf?**
Nothing reaches a chain without the contributor's signature: `verifyMeasurementIntegrity`
in `server/routers.ts` recomputes the root from the canonical payload and recovers the EIP-191
signer with `verifyMessage`, rejecting `MEASUREMENT_ROOT_MISMATCH`, `SIGNATURE_MISMATCH` and
`SIGNATURE_MALFORMED` before anything is stored or relayed (21 tests in
`server/signalproof.test.ts`, including a re-signed payload from a different key). What remains
true, and is the honest limitation: the signature is not carried on-chain, so the settlement
contract cannot re-check it — admission still trusts the relayer key (Q5).

**5. What happens if the relayer is malicious?**
It can withhold or delay measurements, and — because it is the registry's admission gate — it could
submit a self-named measurement and accrue rewards from the pool that the same operator funded; it
cannot forge a proof, cannot make the contract accept an event from another emitter, cannot touch
anyone else's accrued balance, and can be rotated with `setRelayer`. Removing that trust means
carrying the contributor's signature in the event and recovering it in the hook (`ecrecover`,
about 3k gas per settlement) — it is the first thing we would ship after the event.

**6. Attested is not finalized. What about a Sepolia reorg?**
Attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag, so a deep reorg could in
principle invalidate an attested height after we paid 0.001 CTC for it; the expected loss at that
reward is negligible, and for larger rewards the worker can wait for `finalized` before proving —
one comparison in `proofWorker.ts`. We chose speed and wrote the risk down as a security note
rather than pretending it is not there.

**7. Nine to thirteen minutes end to end. Who accepts that?**
The buyer of coverage data receives drive-test reports in weeks, not minutes; the contributor sees
a block countdown ("35 blocks to attestation"), not a spinner, and can close the tab because the
relayer and proof worker run server-side. The latency is the attestation cadence (~10 Sepolia blocks
every ~2 minutes), not our code, and a live real-time demo is therefore impossible — which is why
the video pre-warms a measurement and says so.

**8. There is no anti-Sybil. One phone can run a hundred tests.**
Correct, and today that earns 100 × 0.001 CTC from a pool we fund, so the exposure is bounded by
the pool; the gateway already enforces nonce and root uniqueness, freshness, and a per-session hash,
and the contract a 24-hour window. Real anti-Sybil for this data is a scoring problem — rate limits
per address and per cell, cross-contributor agreement inside a cell, platform attestation once
there is a native client — and the on-chain record already carries the fields that scoring needs
(`areaHash`, `contributor`, `timestamp`).

**9. A browser client is not DePIN hardware.**
The phone is the sensor and the browser is the driver: latency is the median of seven timed round
trips from Resource Timing, throughput a 3 MB incompressible stream with slow-start excluded, and we
deleted the fields no browser can provide (carrier, "5G") instead of faking them — the browser's
own `downlink` under-reported a measured 40.8 Mbps link as 7.5. A native client gets radio-layer
data (RSRP, cell id) and platform attestation; it is the first roadmap item and the settlement
rail does not change.

**10. Who buys this, and how does it make money?**
Mobile operators and their vendors already pay for drive testing and crowdsourced quality-of-
experience data; venues (stadiums, malls, campuses) and public programmes pay for coverage audits.
The product is an "area brief" whose every number links to a settled proof, sold per area or per
period, with contributors paid from that revenue rather than from an emissions pool — the buyer
API and retention policy are not built, and the "Data products" screen says exactly that.

## The next tier (asked by the specialist judge)

**11. Why is the marginal batch cost rising with batch size? Batching is supposed to get cheaper.**
The decoder allocates memory it never reclaims, so the quadratic memory-expansion term takes over:
44,892 gas per extra entry at n=10, 51,015 at n=50, 71,165 at n=200, against 77,828 for a batch of
one (`contracts/test/BatchGasProbe.t.sol`, proof shape held fixed). That is why the worker caps a
batch at 50 rather than the ~600 a 75M-gas CC3 block admits, and why we refuse to quote a saving
from two live runs (253,284 vs 423,360 gas for three measurements) whose proof shapes differed.

**12. Why Sepolia as the source chain? Why not commit straight onto Creditcoin?**
Committing on Creditcoin leaves nothing cross-chain to prove, and the track is about consuming
cross-chain data; architecturally the commitment belongs on the chain with the broadest verifier
set and tooling, and the incentive logic where verification is native and cheap. Practically, on
CC3 Testnet Ethereum Sepolia is an attested source chain with a public proof service, and the
design is chain-agnostic — `chainKey` is resolved at runtime by `chainId`, never assumed.

**13. How is location private if the area is on-chain?**
The device converts its position to a precision-6 geohash before anything leaves the function
(~1.2 km × 0.6 km), the gateway rejects anything finer, and the chain stores only that cell as
`bytes32`. What is public is the link between one wallet address and cells over time — a
cell-level trail — so the honest next step is per-session contributor addresses or a
commit-then-aggregate scheme; we did not build that and say so.

**14. The batch route has no `queryId` ledger, does not bind heights to transactions, and accepts padding transactions. Replay?**
True, and characterised in `contracts/test/BatchPoison.t.sol` rather than hidden: the batch contract
relies on the precompile for proof validity (with the real precompile, inconsistent heights or an
empty continuity proof fail verification — the mock in those tests says yes to everything) and on
`settled[measurementRoot]` for replay, which is the thing that pays. A replayed batch settles
nothing and reverts `NoMeasurementSettled`; a ledger keyed by `(chainKey, height, txIndex)` is a
small addition we would make before mainnet.

**15. Walk me through the two security findings.**
First: the registry accepted `submitMeasurement` from anyone and let the caller choose
`contributor`, so an attacker could call the *real* registry naming themselves payee, obtain a
*genuine* proof and be paid for work nobody did — emitter binding cannot tell "genuine but
unauthorised" from "genuine"; fix: a relayer gate at admission, a redeploy (the old contract had no
admin hook), settlement contracts repointed with `setSourceRegistry`, exploit kept inverted in
`AdvUnlimitedMint.t.sol`. Second: two settlement routes with separate `settled` maps read the same
registry, so one measurement could be paid on both; fix: the batch contract defers to
`siblingSettlements` through a guarded `staticcall`, skipping rather than reverting so one paid
entry cannot strand a batch, with `test_withoutTheCrossCheckTheSameMeasurementPaysTwice` kept as
the executable statement of the bug.

**16. Some transaction hashes in the README predate the gated registry. Why does the dashboard start at Sepolia block 11,658,403?**
Because showing measurements from a registry anyone could write to, next to a claim that submissions
are authorised, would be the wrong thing to display; the settlement contracts kept their addresses
(state is keyed by `measurementRoot` and by address) and were repointed. The earlier hashes are
real and stay in the README as the record of the runs; the dashboard's seven measurements are all
post-gate.

**17. Why two settlement contracts instead of one upgradeable one?**
`ASCBase` wires only the single-proof overload; the batch overload needed a contract that calls the
precompile directly, and the single-proof contract was already live and immutable. Keeping both and
cross-checking them was cheaper and safer than introducing a proxy for a hackathon deployment, and
the sibling list (max 4) means a retired route is still deferred to.

**18. My clone says "Chain not configured" in the sidebar but "CC3 TESTNET · LIVE" in the header. Which is it?**
Both are true: the header reflects the read path (contract logs, no key needed), and the "Protocol
rail" card reflects whether the relayer and proof worker can run, which needs the two relayer
private keys that `.env.example` deliberately leaves blank. The wording is one string and is on the
fix list ("Read-only — relayer key not set").

**19. `estimateGas` fails against precompiles. How do you know your gas limit is right?**
It runs in try/catch; on failure the worker uses a formula (base + per-continuity-root +
per-entry) with a 35% buffer, and every observed settlement (150,640 single; 253,284 and 423,360
batch) sits inside it. The probe test gives the curve for batches up to 200 entries.

**20. What existed before August 13, and what was AI-generated?**
The design document dated 2026-09-07 records that a fixture UI and a tRPC + MySQL gateway scaffold
existed on that date with "zero chain code"; every claim in this submission — contracts, worker,
SDK integration, measurement client, chain-read dashboard, the two findings, the on-chain
results — is dated Sept 7–11 and the first commit is Sept 11. **TEAM TO CONFIRM** (a) that the
scaffold itself was created on or after Aug 13, and (b) which AI coding tools were used; state
both plainly in the description. What no tool produced: the decisions in Q2, the two findings in
Q15, the measurement methodology in Q9, and the seven transactions on the explorers.

**21. What happens if Sepolia reorgs the commit before it is attested?**
The proof service will not return a proof for a transaction that is no longer canonical; the worker
classifies that as transient, backs off, and after `MAX_ATTEMPTS` marks the row `REJECTED` with a
code. Nothing is paid, and the dashboard — being a join of the two chains — simply never shows it
as settled.

**22. Why should CEIP care about a connectivity-data project?**
Because the settlement rail is reusable by any sensor class whose buyer needs "prove the reading
was committed before you pay for it", and it is Attestcoin-native — the depth of integration, not
the dashboard, is the moat. The ask is a pilot with one operator district or one venue, and
engineering advisory on carrying signatures on-chain and on write-ability once it clears audit.

## One-line differentiation vs named competitors

No PMF document exists for this project; the names below are the obvious comparables a judge will
raise, described as they are publicly positioned. The differentiator is never "better measurement";
it is that the record is checkable by a third party without trusting us.

| Competitor (as publicly positioned) | One line |
|---|---|
| **Ookla Speedtest / Opensignal / Tutela** — centralised crowdsourced QoE | They are the trusted party and the methodology is closed; SignalProof makes each measurement's commitment provable to a contract that trusts nobody, including us. |
| **Helium Mobile coverage mapping** — phone-based coverage points rewarded on one chain | Verification and reward live inside one network's own oracle set; SignalProof's reward is released by a chain-verified proof of a commitment on *another* chain, with no oracle operator. |
| **Nodle / Silencio** — phone-as-sensor DePIN networks | Same "phone is the sensor" pattern, single-chain settlement; SignalProof is the cross-chain settlement rail that pattern could adopt, and it is already deployed against Attestcoin. |
| **WeatherXM / Wingbits** — dedicated attested hardware | Hardware-attested devices, not connectivity; SignalProof trades device attestation (roadmap: native client + Play Integrity / App Attest) for a rail that works with the phone people already carry. |
| **A homegrown oracle / signer** (the default alternative) | A signature from an operator is a claim; an inclusion proof verified in CC3 consensus is a fact — and `execute()` being permissionless means anyone can carry it. |

## Feasibility and "what's next" — the honest version

- **Now (built, testnet):** commit → attest → prove → settle → claim, single and batch routes, live dashboard, real browser measurement, 67 + 93 tests, seven on-chain settlements.
- **Next 2 weeks (no new protocol surface):** carry the contributor signature in the event and recover it in the hook; relabel readiness; add a `(chainKey, height, txIndex)` ledger to the batch route; correct the stale README bullet.
- **Next quarter:** native client with radio-layer metrics and platform attestation; anti-Sybil scoring per cell; buyer API + retention policy; a pilot with one venue or operator district.
- **Not until it clears audit:** Attestcoin write-ability (Creditcoin → source chain) and mainnet. We will not claim a mainnet timeline we cannot back.
- **What we will not say:** that this replaces drive testing today, that phones equal calibrated probes, or that 7 measurements from our own devices are a network.

## Critic conditions — each shown satisfied or pre-answered

No `docs/TRACK.md` or `docs/IDEATION_CRITIQUE.md` exists; the conditions below are the accepted
limitations from `docs/superpowers/specs/2026-09-07-signalproof-chain-core-design.md` §9 and the
README's "Known limitations", which are the closest thing to a critic's list.

| Condition | Status |
|---|---|
| A live real-time demo is impossible (attestation 7–9 min) — the demo must pre-warm and the UI must show the waiting state honestly | Satisfied: `docs/DEMO_RUNBOOK.md` pre-warms two measurements; the UI shows "N blocks to attestation" with attested height vs your block; Q7 |
| Read direction only; write-ability unaudited | Pre-answered: Q22, "what's next" |
| Attested ≠ finalized | Pre-answered: Q6 |
| Judging rubric not published — assume no weights | Satisfied: `docs/RUBRIC_SCORECARD.md` labels every weight ESTIMATED |
| Payload signatures "not verified" (README) | Resolved in code, stale in docs: Q4; fix the bullet before pushing |
| No anti-Sybil, no platform attestation, no retention policy | Pre-answered: Q8, Q13, Q10 |
| Browser client, not native | Pre-answered: Q9 |
| Originality window (Aug 13 – Sep 13) | Pre-answered: Q20, TEAM TO CONFIRM the scaffold date |
