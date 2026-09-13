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

## Scorecard (the BUILT project, as of 2026-09-13)

| Criterion | Weight (ESTIMATED) | Predicted score (1–5) A · B · C → mean | Evidence the judge will SEE | Cheapest +1 point |
|---|---|---|---|---|
| **C1. Depth of Attestcoin Protocol utilization** | 35% — the only criterion the organizer names, and a hard requirement | 5 · 4 · 5 → **4.7** | `SignalProofSettlement` inherits `ASCBase` and overrides `_processAndEmitEvent`; `SignalProofBatchSettlement.executeBatch` drives the BlockProver precompile's **batch overload** of `verifyAndEmit`, which `ASCBase` does not wire; `chainKey` resolved from `ChainInfo.getSupportedChains()` by `chainId`, not hardcoded; attestation polled per 15 s tick instead of the SDK's blocking `waitUntilHeightAttested`; seven live transaction hashes (single, batch, gateway-to-chain, claim); `pnpm smoke` prints the resolved key and the attestation lag from a clean clone; `BatchGasProbe.t.sol` measures the batch curve | Already the strongest criterion. Spend 20 minutes making it unmissable: in the video, open the settlement transaction's **Logs** tab on Blockscout and read `MeasurementVerified(measurementRoot, areaHash, contributor, rewardAmount, queryId)` aloud, then the `BatchSettled` log of the batch run |
| **C2. Verified cross-chain data without a centralized oracle operator** | 15% — the theme paragraph's two named properties; the AI track repeats "without centralized oracle operators" | 5 · 4 · 5 → **4.7** | The Creditcoin contract accepts a measurement only after the precompile proves inclusion in an attested Sepolia block; the dashboard read model is a **join of the two chains' logs**, not a database; the "Trust boundary" panel names and links each control. Persona C docks a point because attestation runs 65–85 blocks ahead of Sepolia's `finalized` tag and because a single relayer key is the admission gate | Zero code: state the relayer's role in one precise sentence in the Integration Summary and Q&A — "the relayer can withhold a measurement; it cannot forge a proof, move a reward, or make the contract accept an event the registry did not emit". Written in `docs/JUDGE_QA.md` |
| **C3. Real-world use case and path to a product** | 20% — series title; top-3 go straight to CEIP due diligence; every prior winner was a real-world product | 4 · 4 · 4 → **4.0** | The DePIN loop closes on screen: a buyer's 0.05 CTC lands in the settlement contract's reward pool (first purchase [`0xed00a0…8d30`](https://creditcoin-testnet.blockscout.com/tx/0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30), pool 4.997 → 5.047 CTC) and returns a key that opens per-area samples, the brief, CSV/JSON; `/verify/<hash>`, `/area/<geohash>` with an embeddable badge, `/contributors`, `/ops`; **18 settled measurements from 6 addresses in 3 cells** on 2026-09-13. Persona B still sees one city and no external buyer | **No code.** The live URL (https://signalproof.mdloglabs.org) in the Description and one sentence naming who pays for drive-test data today |
| **C4. DePIN track fit** | 10% — the track sentence; prizes are overall, so fit buys narrative coherence, not a pool | 4 · 4 · 4 → **4.0** | "incentives, settlement, coordination" are each a screen now: rewards accrued and claimed per address, `execute()` settlement with the proof on the verifier, per-cell aggregation with three mapped cells and six contributors | Show the three cells and the leaderboard in the video |
| **C5. Security posture and auditability** | 10% — CertiK audit credits for every winning team | 5 · 4 · 5 → **4.7** | 75 Foundry tests incl. a 6-test end-to-end suite and a signature vector shared with the client; four findings kept as **inverted exploits**; 156 Vitest tests incl. purchase verification (wrong recipient, underpaid, reverted, foreign signer) and the key HMAC; `pnpm e2e:surface` 28/28 against the live chains; pull-payment rewards; secrets never reach the client; public API never returns `signature`/`nonce`/`sessionHash`; the deck, README and Q&A were re-aligned to the code on 2026-09-13 (the deck had still said "no authentication") | Keep docs and code in step — a judge who finds one contradiction discounts the rest |
| **C6. Submission completeness** | 10% — "Requirements for a complete submission"; a gate as much as a score | 5 · 5 · 5 → **5.0** | Repo public and pushed (`main` at the product surface); deck PDF live at the raw GitHub URL, 12 slides, consistent with the code; logo URL live. Demo video live at https://youtu.be/a8pT_0w3Qa8 (4:07, chapters, captions); each member's DoraHacks registration is outside the repo | Record the 3-minute video from `docs/VIDEO_SCRIPT.md` after a pre-warm (`docs/DEMO_RUNBOOK.md`), upload unlisted, paste the URL, re-render the last deck slide with it. ~1.5 h, and a DQ if skipped |

**Weighted projected total (2026-09-13, after the product surface — paid buyer access into the pool, public verifier, area page with exports and badge, contributors, ops, auto-measure; 18 settlements from 6 contributors in 3 cells):** 0.35·4.7 + 0.15·4.7 + 0.20·4.0 + 0.10·4.0 + 0.10·4.7 + 0.10·5.0 = **4.52 / 5 = 90% — PASS** (bar for a top-3 finish in a 127-entry field under ESTIMATED weights: ≥ 80%).

**Demo video in place** (2026-09-13, https://youtu.be/a8pT_0w3Qa8): C6 is 5.0; the total above already includes it.

**Lowest criteria:** C3 and C4 at 4.0. Persona B — the one who decides CEIP — now sees a
queryable, paid product surface with a real purchase on chain and six contributors, but still one
city and no buyer who is not us. The cheapest lift left is a live URL in the Description and a
named customer conversation, not more code.

## What will lose us points (the three to fix first)

1. **C6 Submission completeness — done.** The demo video is uploaded (4:07); what remains outside the repo is each member's DoraHacks registration — a DQ if skipped.
2. **C3 Real-world path — 4.0.** Live host is up at https://signalproof.mdloglabs.org with the paid-access gate enabled (`pnpm e2e:surface` 28/28 against it on 2026-09-13). Put the URL in the Description, and pre-warm it before judging windows (first chain read after a restart ~20 s).
3. **Consistency.** Every number in the deck, README, Q&A and this scorecard must match the code and the chain on submission day. Re-run `pnpm e2e:surface` and re-read the "Current status" table before pasting.

## Notes on how this was scored

- Scores are for the built project (deployed contracts, live dashboard, source code), not the idea.
- Persona scores are independent 1–5 predictions; the mean is shown to one decimal.
- Sources: `docs/HACKATHON_BRIEF.md`, `docs/BRIEF_RAW.md`, the live payload (2026-09-11), the Spring 2026 edition page (`dorahacks.io/hackathon/buidl-ctc`), `README.md`, `docs/TECHNICAL_ARCHITECTURE.md`, `contracts/`, `server/`, `client/src/pages/Home.tsx`.
