# SignalProof — demo video script (word for word)

**Target length:** 4:00 (self-imposed; DoraHacks sets no limit). **Language:** English — the judges are the Creditcoin/Gluwa and CertiK teams. **Resolution:** record the browser at 1920×1080, one tab, zoom 110 % so labels read on a phone.

The video has one job: show a judge, in the first minute, that a phone measurement really became a proof the Creditcoin contract verified — and then show that the pipeline is a product (buyers pay into the pool contributors claim from). Everything on screen is live against Sepolia and CC3 Testnet; nothing is a fixture. If a live beat fails, use its fallback and say so on camera — never pass an old row off as new.

---

## 1. Before you press record (T-60 min)

Do these in order; the settlement beat (§3, shot 7) depends on the pre-warm timing.

| When | Do | Check |
|---|---|---|
| T-60 | Open `https://signalproof.mdloglabs.org` once and wait for the header badge **CC3 TESTNET · LIVE** | The first chain read after a host restart takes ~20 s; after that every page paints instantly |
| T-60 | `E2E_BASE=https://signalproof.mdloglabs.org E2E_ACCESS_TX=0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30 pnpm e2e:surface` | Must print `28/28 checks passed` — this proves the gate, the verifier and the ops feed before you rely on them on camera |
| T-45 | **Contributor wallet** (MetaMask account A) on Creditcoin CC3 Testnet with ≥ 0.05 tCTC for `claim()` gas | Header shows **CC3** chip after connecting |
| T-45 | **Buyer wallet** (MetaMask account B) with ≥ 0.1 tCTC (0.05 price + gas) | A second account, so the leaderboard and the purchase read as two parties |
| T-30 | In MetaMask, Settings → Advanced → make sure popups open on the recording screen | The confirm dialogs must be visible in the capture |
| T-20 | Close every other tab; hide bookmarks bar; disable notifications | — |
| **T-9** | **Pre-warm:** with wallet A, run **Run a test** once and let it reach *"N blocks to attestation"*. Note the time. | Attestation reaches a Sepolia block ~7–9 min after it is mined; the worker settles on the next 15 s tick. Start recording at **T-2** so the flip lands around shot 7 |
| T-2 | Start the screen recorder; open `https://signalproof.mdloglabs.org/verify/0x60d9e438e8549a101b144bd1e474475301c696640062601ddfd18f788e6aa2b5` as the first screen | This is the cold open |

Do **not** run a local `pnpm dev` with the same relayer keys while the host runs — two proof workers race on nonces.

---

## 2. Screens you will open, in order

| # | Screen | How to get there |
|---|---|---|
| 1 | Verifier, a settled measurement | URL above (pre-opened) |
| 2 | Console — Coverage overview | Sidebar **Coverage overview** |
| 3 | GitHub README — Architecture diagram | New tab: `https://github.com/mdlog/signalproof#architecture` |
| 4 | Console — Run a test | Sidebar **Run a test** |
| 5 | MetaMask popups (connect · sign) | Triggered by the app |
| 6 | Console — Proof queue → **View proof** | Sidebar **Proof queue** |
| 7 | Blockscout, settlement tx, **Logs** tab | Click **Open on explorer** on a settled card |
| 8 | GitHub — `contracts/src/SignalProofSettlement.sol` | New tab; scroll to the two `revert` lines |
| 9 | Console — Proof queue (pre-warmed card flips) | Sidebar **Proof queue** |
| 10 | Console — Data products → **Buy API access** | Sidebar **Data products** |
| 11 | Area page `/area/qqguw6` | Click the area card title |
| 12 | Operations `/ops` | Sidebar **Operations** |
| 13 | Contributors `/contributors` | Sidebar **Contributors** |
| 14 | End card (deck slide 12 or a still) | — |

---

## 3. The script

Format per shot: **timecode · screen · what you do · what you say.** Speak at ~155 words per minute; the main-path narration is ≈ 590 words ≈ 3:50, plus pauses while the screen speaks for itself.

### Shot 1 — cold open · 0:00–0:14 · Verifier

**Do:** the page is already open. Let it sit 3 s, then slowly scroll to the **Attestcoin proof — what the precompile verified** panel.

**Say:**
> "This measurement was taken on a phone in Jakarta, committed on Ethereum Sepolia, proven by the Attestcoin Protocol, and settled on Creditcoin — where a smart contract, not a server, decided it was real. Every step is a transaction you can open. This is SignalProof."

### Shot 2 — the problem · 0:14–0:36 · Coverage overview

**Do:** click **Coverage overview**. Hover the map so the cells and their logo pins are visible; hover one pin so the tooltip shows `quality`.

**Say:**
> "Anyone can claim coverage numbers. Nobody can prove them. SignalProof turns each phone measurement into a claim a contract can check, and aggregates it per area. Each box is a geohash cell about one kilometre wide — a contributor is somewhere inside it, never at a point. The raw coordinate never leaves the phone."

### Shot 3 — how it works · 0:36–1:08 · README architecture diagram

**Do:** switch to the GitHub tab, already scrolled to the Architecture flowchart. Trace left to right with the cursor as you speak.

**Say:**
> "The pipeline. The phone measures and signs; the gateway checks the signature and relays to a registry on Sepolia, which recovers the signature again on-chain. Attestcoin attests Sepolia blocks on Creditcoin; once our block is attested, the proof service returns a Merkle inclusion proof and a continuity proof. Our settlement contract hands that proof to the BlockProver precompile — and only if it verifies does the contributor earn a reward. Buyers pay into that same pool. Two chains, no oracle operator in the middle."

### Shot 4 — connect and measure · 1:08–1:50 · Run a test

**Do:** back to the app. Click **Connect wallet** → RainbowKit lists the installed wallets → click **MetaMask** → approve. Header shows the **CC3** chip and your address. Sidebar **Run a test**. Click **Run valid test**. Watch the ring spin, the four tiles fill (network class, coarse area, latency, throughput). MetaMask asks for a signature → approve. The label reads **"sent to gateway"**, then **"N blocks to attestation · ~M min"**.

**Say (while it runs):**
> "A real one. I connect a wallet — it needs no balance; the relayer pays gas on both chains. Run valid test: the browser measures latency as the median of seven timed round trips, throughput from a three-megabyte incompressible download, and turns my position into a six-character geohash before anything leaves the device. My wallet signs the measurement — free, no gas. The gateway recomputes the hash, recovers the signer, and relays it to Sepolia. Now the honest part: Creditcoin attests Sepolia about ten blocks every two minutes, so this settles in roughly eight minutes. We'll come back to it."

### Shot 5 — the proof, on screen · 1:50–2:12 · Proof queue → View proof

**Do:** sidebar **Proof queue**. On a **Settled** card click **View proof**. Point at *Attested height*, *Merkle inclusion* (the siblings), *Continuity* (the roots), and the `execute()` row with the selector and gas ceiling.

**Say:**
> "This is what the precompile is given, fetched live with no key: the attested Sepolia height, seven Merkle siblings up to the block's transaction root, and the continuity roots that chain the block back to an attestation checkpoint — packed into one execute call. Anyone holding this proof may call it. That is by design."

### Shot 6 — what the precompile does not check · 2:12–2:50 · Blockscout logs, then the contract

**Do:** click **Open on explorer** on the settled card → Blockscout → **Logs** tab; hover `MeasurementVerified` with `measurementRoot`, `areaHash`, `contributor`, `rewardAmount`. Switch to the GitHub tab with `SignalProofSettlement.sol` scrolled to the two `revert` lines.

**Say:**
> "The settlement on Creditcoin: MeasurementVerified, with the root, the area, the contributor and the reward. The precompile proves inclusion in an attested block — and only that. It does not prove the transaction succeeded, or which contract emitted the log. So we check both: receipt status must be one, and the log must come from our registry. That second check is missing from the SimpleMinterASC example in the Attestcoin docs; without it, anyone can prove a forged event from a lookalike registry and drain the pool. Our end-to-end test runs that attack, and only the emitter binding stops it."

### Shot 7 — settlement on camera · 2:50–3:03 · Proof queue

**Do:** sidebar **Proof queue**. The pre-warmed card should be **Settled** now, or flip on the next 15-second poll. If it is still amber, click **Settle from my wallet** on it (MetaMask confirms `execute()` — your wallet pays CC3 gas) and let the card flip. If attestation is genuinely late, use the fallback line.

**Say (settled):**
> "And the measurement I submitted before recording has just settled: proof verified, reward accrued. Nothing here comes from a database — the dashboard is a join of the two chains' logs."

**Say (fallback, still amber):**
> "The measurement I submitted before recording is still a few blocks from attestation — that is the real cadence of the protocol, so I won't fake it. Here is the one that settled just before we started."

### Shot 8 — the buyer pays the contributors · 3:03–3:38 · Data products → Buy API access → area page

**Do:** in MetaMask switch to account B (buyer). Sidebar **Data products**. Click **Buy API access — 0.05 CTC** → MetaMask confirms a 0.05 CTC transfer → MetaMask signs a message → the green card reads **Key active until …**. Click **Area brief** on the `qqguw6` card; close it; click the card title to open `/area/qqguw6`; click **CSV**.

**Say:**
> "The other side of the market. A buyer pays 0.05 CTC for thirty days of access — a plain transfer into the settlement contract, the same pool contributors claim from. The buyer signs the transaction hash, the server verifies the payment on chain and returns a key derived from it; nothing is stored. What is metered is the service — per-area samples with provenance, briefs, exports — not the data, which is public on two chains. Here is an area: the cell, quality over time, every sample with its two transactions, and a CSV."

### Shot 9 — the network, operated · 3:38–3:52 · Operations, Contributors

**Do:** sidebar **Operations**: point at **Runway** (the pool just grew by 0.05 CTC). Sidebar **Contributors**: the leaderboard.

**Say:**
> "Operations shows the pool's runway in settlements — it just went up by fifty — and relayer gas on both chains. Contributors shows the network: nine addresses across four cells, each with claimable rewards."

### Shot 10 — close · 3:52–4:00 · End card

**Do:** end card: logo, `signalproof.mdloglabs.org`, `github.com/mdlog/signalproof`, "BUIDL CTC 2026 Fall · DePIN track".

**Say:**
> "SignalProof — verifiable connectivity data, settled on Creditcoin. Everything you saw is live on testnet; the repository, the deck and the verifier are linked below."

---

## 4. Lower-third captions (optional, one line each, mono font)

| Shot | Caption |
|---|---|
| 1 | `verify/<hash> · commitment → attestation → proof → settlement` |
| 2 | `geohash-6 cells · ~1.2 km × 0.6 km · no coordinates on chain` |
| 3 | `Sepolia registry → Attestcoin proof → Creditcoin settlement → reward` |
| 4 | `measured, not asked · signed by the contributor · relayer pays gas` |
| 5 | `Merkle inclusion + continuity roots → execute() → BlockProver 0x…0FD2` |
| 6 | `receiptStatus == 1 · log.address == registry` |
| 7 | `MeasurementVerified · 0.001 CTC accrued` |
| 8 | `0.05 CTC → reward pool → key · service, not data` |
| 9 | `runway 5,1xx settlements · 9 contributors · 4 cells` |

---

## 5. Fallbacks, one per live dependency

| If | Then |
|---|---|
| MetaMask lists the wrong account | Cancel, switch account in MetaMask, click **Connect wallet** again — RainbowKit reconnects the last-used wallet without a reload |
| Header says **Prototype mode** | The host's first chain read after a restart takes ~20 s; wait, reload once. Never record over it |
| The pre-warm has not settled by shot 7 | Use the fallback line, or click **Settle from my wallet** if the row shows *attested · fetching proof* |
| **Buy API access** card is missing | `BUYER_ACCESS_SECRET` is not set on the host — the gate is open by design. Redeploy with the secret; do not record the beat without it |
| The purchase says *Waiting for the block…* for more than a minute | Keep talking through shot 8's text; the poll retries every 5 s for three minutes. Do not click twice |
| Geolocation is refused on the laptop | Chrome DevTools → Sensors → set a location to the cell you are actually in, or record shot 4 on a phone over the HTTPS host |

---

## 6. After recording

1. Trim to ≤ 4:00; export 1080p; upload unlisted (YouTube) or a public Drive link.
2. Paste the URL into DoraHacks form field 8 (`docs/SUBMISSION.md` → *Field 8*).
3. In `docs/deck/SignalProof-deck.html`, replace "linked from the BUIDL page on DoraHacks" on slide 12 with the URL, re-render `SignalProof-deck.pdf` (`google-chrome --headless=new --no-pdf-header-footer --print-to-pdf=SignalProof-deck.pdf SignalProof-deck.html`), commit, push.
