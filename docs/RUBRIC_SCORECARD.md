<!-- trace: idea="SignalProof — verifiable connectivity data for DePIN: phone measurements committed on Ethereum Sepolia, proven by the Attestcoin Protocol, settled and rewarded on Creditcoin CC3 Testnet." | event="BUIDL CTC 2026 Fall" | deadline="2026-09-13 23:59 ET (2026-09-14 03:59 UTC) — re-verified live 2026-09-11 09:36 UTC: payload timelineEnd=1789358340, isExtended=true" | source=submission-packager -->
# Rubric scorecard — BUIDL CTC 2026 Fall

**JUDGING WEIGHTS NOT PUBLISHED.** Re-checked at packaging time on the live event payload
(`dorahacks.io/hackathon/buidl-ctc-2026-fall/_payload.json`, 2026-09-11 09:36 UTC) and on the
Spring 2026 edition page (`buidl-ctc`, 76 approved projects, winners announced): neither edition
publishes a rubric or weights. The only criterion the organizer quotes, verbatim:

> "Depth of Attestcoin Protocol utilization will be evaluated as one of the core scoring criteria."

Everything else below is scored against the organizer's **emphasis order**, reconstructed from
official page copy only (no secondary sources were needed):

1. The quoted criterion above, plus the hard requirement "Must integrate the Attestcoin Protocol as a core feature."
2. Theme copy: "verified cross-chain data", "execute cross-chain business logic without relying on centralized oracle operators".
3. Series title "BUIDL For The Real World"; top three teams go straight to CEIP due diligence ("refine and prepare their products for official launch").
4. Track text (DePIN): "utilize cross-chain data to drive incentives, settlement, or coordination across hardware and sensor networks." Prizes are overall, not per track.
5. CertiK winner benefits (repository audit credits, Skynet Boost) — the repo is read as an audit candidate.
6. "Requirements for a complete submission" — working integration code, technical documentation, testnet deployment, and the 8-field form.

Calibration from the prior edition (Spring 2026, same organizer): the three winners were CrediKye
(ROSCA savings circles, Telegram mini-app), HashCredit (miner financing on SPV-verified payouts) and
SnowBall (CTC-collateralised stablecoin). All three were real-world finance products; the
organizer's own recap names "decentralized IoT infrastructure" as a notable innovation but no DePIN
entry placed. Field size this edition at packaging time: **87 BUIDLs submitted** (payload
`buidlsCount`), up from 3 at the scout fetch.

Every weight below is **ESTIMATED** with its rationale. Do not quote them to a judge.

## Judge personas

| Persona | Who | What they open first | What they punish |
|---|---|---|---|
| **A — Protocol engineer** | Creditcoin / Gluwa DevRel or core dev | `contracts/src/*.sol`, `server/signalproof/proofWorker.ts`, the Integration Summary field | SDK copy-pasted from the docs page; `chainKey` hardcoded; a "proof" that is an `eth_call` |
| **B — Credit Labs investor** | CEIP due-diligence reader | Description, deck, the "Data products" screen, the team | No buyer, no wedge, a demo that is the whole product |
| **C — CertiK reviewer** | Security engineer | `contracts/test/`, README security notes, known limitations | Undisclosed mocks, untested trust assumptions, docs that contradict code |

## Scorecard (the BUILT project, as of 2026-09-11)

| Criterion | Weight (ESTIMATED) | Predicted score (1–5) A · B · C → mean | Evidence the judge will SEE | Cheapest +1 point |
|---|---|---|---|---|
| **C1. Depth of Attestcoin Protocol utilization** | 35% — the only criterion the organizer names, and a hard requirement | 5 · 4 · 5 → **4.7** | `SignalProofSettlement` inherits `ASCBase` and overrides `_processAndEmitEvent`; `SignalProofBatchSettlement.executeBatch` drives the BlockProver precompile's **batch overload** of `verifyAndEmit`, which `ASCBase` does not wire; `chainKey` resolved from `ChainInfo.getSupportedChains()` by `chainId`, not hardcoded; attestation polled per 15 s tick instead of the SDK's blocking `waitUntilHeightAttested`; seven live transaction hashes (single, batch, gateway-to-chain, claim); `pnpm smoke` prints the resolved key and the attestation lag from a clean clone; `BatchGasProbe.t.sol` measures the batch curve | Already the strongest criterion. Spend 20 minutes making it unmissable: in the video, open the settlement transaction's **Logs** tab on Blockscout and read `MeasurementVerified(measurementRoot, areaHash, contributor, rewardAmount, queryId)` aloud, then the `BatchSettled` log of the batch run |
| **C2. Verified cross-chain data without a centralized oracle operator** | 15% — the theme paragraph's two named properties; the AI track repeats "without centralized oracle operators" | 5 · 4 · 4 → **4.3** | The Creditcoin contract accepts a measurement only after the precompile proves inclusion in an attested Sepolia block; the dashboard read model is a **join of the two chains' logs**, not a database; the "Trust boundary" panel names and links each control. Persona C docks a point because attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag and because a single relayer key is the admission gate | Zero code: state the relayer's role in one precise sentence in the Integration Summary and Q&A — "the relayer can withhold a measurement; it cannot forge a proof, move a reward, or make the contract accept an event the registry did not emit". Written in `docs/JUDGE_QA.md` |
| **C3. Real-world use case and path to a product** | 20% — series title; top-3 go straight to CEIP due diligence; every prior winner was a real-world product | 3 · 2 · 3 → **2.7** | The "Data products" screen says, in the UI's own words, "Area cards are live; the buyer API is not built" and the "Create area brief" button is disabled; README states no native app, no anti-Sybil, no retention policy; the live history is 7 measurements from the team's own devices. Persona B sees a working rail with no customer | **No code.** (1) One deck slide naming the buyer class and the number they pay today — mobile operators buy drive-test and crowdsourced QoE data; venues and regulators buy coverage reports — and what a SignalProof "area brief" replaces. (2) Before recording, have 2–3 people outside the team run `Run valid test` through the HTTPS tunnel from different geohash cells, so the KPI reads more than one contributor and the map shows ≥3 cells. ~2 h total |
| **C4. DePIN track fit** | 10% — the track sentence; prizes are overall, so fit buys narrative coherence, not a pool | 4 · 3 · 4 → **3.7** | Each clause maps to a component (phones = sensor nodes; `MeasurementSubmitted` → attested → consumed on CC3 = cross-chain data; `rewards[contributor]` + `claim()` = incentives; `SignalProofSettlement` = settlement; per-`areaHash` aggregation and the geohash map = coordination). Persona B discounts phones-as-hardware against dedicated sensor networks | In the Description, map the track sentence clause-by-clause (done in `docs/SUBMISSION.md`) and show the coverage map with ≥3 distinct cells in the video (same 2–3 outside runs as C3) |
| **C5. Security posture and auditability** | 10% — CertiK audit credits for every winning team | 4 · 4 · 4 → **4.0** | 67 Foundry tests incl. a 6-test end-to-end suite; two findings kept as **inverted exploits** (`AdvUnlimitedMint.t.sol`, `DoubleSettlement.t.sol`); `BatchPoison.t.sol` characterises the batch route's accepted gaps; pull-payment rewards; secrets never reach the client; public API never returns `signature`/`nonce`/`sessionHash`. The README bullet that said payload signatures were "not yet cryptographically verified" contradicted `server/routers.ts` (which recovers the EIP-191 signer, 21 tests); corrected on 2026-09-11 in README, `docs/TECHNICAL_ARCHITECTURE.md`, `todo.md` and the deck | **20 minutes:** a short "Accepted risks" table in README pointing at the three `BatchPoison` characterisation tests |
| **C6. Submission completeness** | 10% — "Requirements for a complete submission"; a gate as much as a score | 4 · 4 · 4 → **4.0 today** | Repo public at https://github.com/mdlog/signalproof (recursive clone passes `forge test` 67/67 and `pnpm verify`); deck PDF live at the raw GitHub URL (11 slides); logo URL live. Only form field 8 (demo video URL) is blank; each member's DoraHacks registration is outside the repo | Record the 3-minute video from `docs/VIDEO_SCRIPT.md` after two pre-warms (`docs/DEMO_RUNBOOK.md`), upload unlisted, paste the URL, re-render the last deck slide with it. ~1.5 h, and a DQ if skipped |

**Weighted projected total (2026-09-11, after repo + deck + doc fixes):** 0.35·4.7 + 0.15·4.3 + 0.20·2.7 + 0.10·3.7 + 0.10·4.3 + 0.10·4.0 = **4.03 / 5 = 81% — at the bar** (bar for a top-3 finish in an 87-entry field under ESTIMATED weights: ≥ 80%).

**Weighted projected total after the remaining cheapest moves land** (C6 → 5.0 with the video, C3 → 3.3 with outside contributors on the map): **4.25 / 5 = 85% — PASS.**

**Lowest criterion:** C3, real-world use case and path to a product (2.7). Persona B — the one who
decides CEIP — sees a rail without a customer. The single cheapest lift is a deck slide that names
the buyer and the number they already pay for unverifiable coverage data, plus 2–3 outside
contributors on the map before the video is recorded. No code is required for either.

## What will lose us points (the three to fix first)

1. **C6 Submission completeness — 4.0.** One required URL is blank: the demo video. Record from the script, upload, paste. ~1.5 h, and a DQ if skipped.
2. **C3 Real-world path — 2.7.** Name the buyer on one slide; get outside contributors on the map before recording.
3. **C4 DePIN track fit — 3.7.** Clause-by-clause mapping in the Description (done) and ≥3 cells on the map in the video.

## Notes on how this was scored

- Scores are for the built project (deployed contracts, live dashboard, source code), not the idea.
- Persona scores are independent 1–5 predictions; the mean is shown to one decimal.
- Sources: `docs/HACKATHON_BRIEF.md`, `docs/BRIEF_RAW.md`, the live payload (2026-09-11), the Spring 2026 edition page (`dorahacks.io/hackathon/buidl-ctc`), `README.md`, `docs/TECHNICAL_ARCHITECTURE.md`, `contracts/`, `server/`, `client/src/pages/Home.tsx`.
