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

## 3. The script — screen, action and words, in sync

Each row is one sentence. **Screen shows** is what must be visible (and, in bold, what the cursor rests on) while the sentence is spoken; move to the next row's element on the last word of the previous sentence. Speak at ~155 words per minute; the main path is ≈ 620 words ≈ 4:00 including the pauses marked *(pause)*.

### Shot 1 — cold open · 0:00–0:14 · `/verify/0x60d9e4…a2b5`

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 0:00 | Verifier page, result card: **"Settled on Creditcoin"** header with the green **SETTLED** pill; below it *Area qqguw6 · contributor 0x5360…8c93* | Nothing for 2 s — let it sit | *(pause)* |
| 0:02 | Same card; cursor on the **Measurement root** row (step 1, green check) | Rest the cursor on the root hash | "This measurement was taken on a phone in Jakarta," |
| 0:05 | Cursor moves down the rail: **Committed on Ethereum Sepolia** → **Attested by Creditcoin** → **Settled on Creditcoin CC3**, each with its green check | Trace the four steps top to bottom | "committed on Ethereum Sepolia, proven by the Attestcoin Protocol, and settled on Creditcoin —" |
| 0:09 | The **Attestcoin proof — what the precompile verified** panel scrolled into view (attested height, Merkle inclusion, continuity, execute()) | Scroll so the whole panel is visible | "where a smart contract, not a server, decided it was real." |
| 0:12 | Cursor on an **explorer ↗** link beside a hash | Hover, don't click | "Every step is a transaction you can open. This is SignalProof." |

### Shot 2 — the problem · 0:14–0:36 · Coverage overview

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 0:14 | Sidebar **Coverage overview** clicked; hero *"Know where the signal breaks before users do."* and the four KPI cards (Verified coverage 100 %, Measurements, Median latency, Rewards settled) | Click the sidebar item, leave the cursor off the cards | "Anyone can claim coverage numbers. Nobody can prove them." |
| 0:19 | Scroll to the **Coverage signal map** card; three logo pins on the Java–Sulawesi map, shaded cells | Scroll one screen down | "SignalProof turns each phone measurement into a claim a contract can check, and aggregates it per area." |
| 0:25 | Cursor on the **shaded rectangle** around the `qqguw6` pin (zoom in one step so the box is obvious) | Click **+** once on the map, rest the cursor on the box edge | "Each box is a geohash cell about one kilometre wide — a contributor is somewhere inside it, never at a point." |
| 0:32 | Hover the pin: tooltip **`qqguw6 · quality 94`**; the legend *"shaded box = geohash cell"* at the bottom-left | Hover the pin | "The raw coordinate never leaves the phone." |

### Shot 3 — how it works · 0:36–1:08 · GitHub README, Architecture diagram

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 0:36 | GitHub tab, the Mermaid flowchart fully visible: subgraphs *Contributor device · SignalProof server · Ethereum Sepolia · Attestcoin Protocol · Creditcoin CC3 Testnet · Consumers* | Switch tab; cursor on **Measure** then **Wallet** in the device box | "The pipeline. The phone measures and signs;" |
| 0:40 | Cursor on **Gateway (tRPC)** → follows the arrow to **Relayer** → to **SourceBatchRegistry** (Sepolia box) | Trace the arrow | "the gateway checks the signature and relays to a registry on Sepolia, which recovers the signature again on-chain." |
| 0:47 | Cursor on **Attestation** then **Proof service** in the Attestcoin box | Trace the dotted *block attested* arrow into Attestcoin | "Attestcoin attests Sepolia blocks on Creditcoin; once our block is attested, the proof service returns a Merkle inclusion proof and a continuity proof." |
| 0:55 | Cursor on **Proof worker** → *execute(proof)* arrow → **BlockProver precompile** → **SignalProofSettlement** → **Reward pool** | Trace into the CC3 box | "Our settlement contract hands that proof to the BlockProver precompile — and only if it verifies does the contributor earn a reward." |
| 1:03 | Cursor on **Buyer → 0.05 CTC → Reward pool** (bottom-right arrow) | Rest on the arrow | "Buyers pay into that same pool. Two chains, no oracle operator in the middle." |

### Shot 4 — connect and measure · 1:08–1:50 · Run a test

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 1:08 | App tab; header **Connect wallet** → RainbowKit dialog *"Connect a Wallet"* with the **Installed** list (MetaMask among them) | Click **Connect wallet**, then **MetaMask** | "A real one. I connect a wallet —" |
| 1:12 | MetaMask popup *"Connect with MetaMask"* → approve; header now shows **CC3** chip + your short address | Approve in MetaMask | "it needs no balance; the relayer pays gas on both chains." |
| 1:16 | Sidebar **Run a test**; card *"Capture a signal snapshot."*; dial shows the logo, **Run valid test** button | Click **Run a test**, then **Run valid test** | "Run valid test:" |
| 1:19 | Dial ring **spinning in colour**, status *"Sampling network…"*; tiles fill in order — **Coarse area** (`qqguw6`, *±NN m → cell 1216×607 m · coordinate discarded*), **Network class**, **Latency** (*median of 7 round trips*), **Throughput** (*3.00 MB over 0.6 s*) | Hover each tile as it fills | "the browser measures latency as the median of seven timed round trips, throughput from a three-megabyte incompressible download, and turns my position into a six-character geohash before anything leaves the device." |
| 1:31 | MetaMask popup *"Signature request"* showing the text *SignalProof measurement…* | Approve | "My wallet signs the measurement — free, no gas." |
| 1:35 | *Evidence pipeline* label changes **"sent to gateway"** → step 02 **Source-chain event** turns green → **"N blocks to attestation · ~M min"** with the *attested height / your block* box | Rest the cursor on the countdown label | "The gateway recomputes the hash, recovers the signer, and relays it to Sepolia." |
| 1:41 | The countdown box: **attested height** and **your block**, note *"Creditcoin attests Sepolia in batches of ~10 blocks, about every 2 minutes"* | Hover the box | "Now the honest part: Creditcoin attests Sepolia about ten blocks every two minutes, so this settles in roughly eight minutes. We'll come back to it." |

### Shot 5 — the proof, on screen · 1:50–2:12 · Proof queue → View proof

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 1:50 | Sidebar **Proof queue**; filter **All (N) · Settled · Awaiting**; the top card is **Settled** (green check, *Proof verified on Creditcoin. Reward 0.001 CTC released.*) | Click **Proof queue**, then **View proof** on the first settled card | "This is what the precompile is given, fetched live with no key:" |
| 1:54 | The proof panel opens under the card: **Attested height** `11,681,452 (Sepolia block, tx index 96)` | Cursor on the *Attested height* row | "the attested Sepolia height," |
| 1:57 | **Merkle inclusion** row: *root 0x145d… · 7 siblings: R 0x8b77…, L 0xbf56…* | Cursor on the row | "seven Merkle siblings up to the block's transaction root," |
| 2:01 | **Continuity** row: *49 roots from lower endpoint 0x3e60…* | Cursor on the row | "and the continuity roots that chain the block back to an attestation checkpoint —" |
| 2:05 | **execute()** row: *selector 0xc6339bf7 · action 0 · calldata 4,484 bytes · gas ceiling 858,000* | Cursor on the row | "packed into one execute call." |
| 2:08 | The panel's footnote *"Anyone holding this proof may call execute(); the settlement contract then checks…"* | Rest on the footnote | "Anyone holding this proof may call it. That is by design." |

### Shot 6 — what the precompile does not check · 2:12–2:50 · Blockscout logs → the contract

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 2:12 | Blockscout transaction page, **Logs** tab: `MeasurementVerified` decoded — **measurementRoot**, **areaHash**, **contributor**, **rewardAmount** | Click **Open on explorer** on the settled card, open **Logs** | "The settlement on Creditcoin: MeasurementVerified, with the root, the area, the contributor and the reward." |
| 2:20 | Same log; cursor on the **From** / contract address `0x8F14…b584` | Hover the address | "The precompile proves inclusion in an attested block — and only that." |
| 2:24 | GitHub tab, `contracts/src/SignalProofSettlement.sol`, scrolled to the two `revert` lines (`SourceTransactionFailed`, `WrongEmitter`) | Switch tab | "It does not prove the transaction succeeded, or which contract emitted the log." |
| 2:29 | Cursor on `if (receipt.receiptStatus != 1) revert SourceTransactionFailed(…)` | Highlight the line by selecting it | "So we check both: receipt status must be one," |
| 2:32 | Cursor on `if (log.address_ != sourceRegistry) revert WrongEmitter(…)` | Select the line | "and the log must come from our registry." |
| 2:35 | Scroll up two screens to the comment block above the hook that names the missing check | Show the comment | "That second check is missing from the SimpleMinterASC example in the Attestcoin docs; without it, anyone can prove a forged event from a lookalike registry and drain the pool." |
| 2:44 | Same tab, file switcher to `contracts/test/EndToEnd.t.sol`, function name **`test_forgedRegistryCannotSettleEvenWithValidProof`** visible | Open the test file (pre-opened in a third tab is faster) | "Our end-to-end test runs that attack, and only the emitter binding stops it." |

### Shot 7 — settlement on camera · 2:50–3:03 · Proof queue

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 2:50 | App tab, **Proof queue**, the pre-warmed card at the top: pill flips **Awaiting attestation → Settled**, detail line *"Proof verified on Creditcoin. Reward 0.001 CTC released."*, sidebar badge count drops | Click **Proof queue**; wait for the 15 s poll if needed | "And the measurement I submitted before recording has just settled: proof verified, reward accrued." |
| 2:57 | Footer of the sidebar **"Live · N settled on CC3"** and the header **CC3 TESTNET · LIVE** | Rest the cursor on the footer | "Nothing here comes from a database — the dashboard is a join of the two chains' logs." |

*Fallback (card still amber):* screen shows the amber card with **"N blocks to attestation"**; cursor on the countdown. Say: "The measurement I submitted before recording is still a few blocks from attestation — that is the real cadence of the protocol, so I won't fake it. Here is the one that settled just before we started." — then click **View proof** on the settled card below it.

### Shot 8 — the buyer pays the contributors · 3:03–3:38 · Data products → Buy API access → area page

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 3:03 | MetaMask switched to **account B**; sidebar **Data products**; the **API ACCESS** card: *"0.05 CTC for 30 days, paid into the reward pool."* with the three numbered steps | Switch account, click **Data products** | "The other side of the market. A buyer pays 0.05 CTC for thirty days of access —" |
| 3:09 | Button text **"Confirm the payment in your wallet…"**; MetaMask popup *Send 0.05 CTC to 0x8F14…b584* | Click **Buy API access — 0.05 CTC**, confirm | "a plain transfer into the settlement contract, the same pool contributors claim from." |
| 3:15 | Button **"Waiting for the block…"** then MetaMask *Signature request* **"SignalProof API access / Transaction: 0x… / Address: 0x…"** | Sign | "The buyer signs the transaction hash," |
| 3:19 | Green card **"Key active until <date>"**, the `sp1_…` key, **Copy key · Copy curl · Payment on Blockscout** | Rest the cursor on the key | "the server verifies the payment on chain and returns a key derived from it; nothing is stored." |
| 3:24 | Area card `qqguw6` → **Area brief** → dialog *"Area brief — qqguw6"* with the markdown and the provenance table | Click **Area brief**, scroll the dialog once, close it | "What is metered is the service — per-area samples with provenance, briefs, exports — not the data, which is public on two chains." |
| 3:31 | `/area/qqguw6`: title *qqguw6 · quality NN*, KPI strip, **The cell** map, **Quality over time** chart, **Every sample** table with *Verify* links | Click the card title | "Here is an area: the cell, quality over time, every sample with its two transactions," |
| 3:36 | Click **CSV**: the browser's download bar shows `signalproof-qqguw6.csv` | Click **CSV** | "and a CSV." |

### Shot 9 — the network, operated · 3:38–3:52 · Operations → Contributors

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 3:38 | `/ops`: **Reward pool** card — *Pool balance*, *Reward per measurement 0.001 CTC*, **Runway N settlements** (50 higher than before shot 8) | Click **Operations**, cursor on **Runway** | "Operations shows the pool's runway in settlements — it just went up by fifty —" |
| 3:44 | **Relayer gas** card: *Sepolia ETH*, *Creditcoin CTC* | Cursor on the balances | "and relayer gas on both chains." |
| 3:47 | `/contributors`: headline *"9 contributors, N settled measurements across 4 cells."* and the **Leaderboard** table (rank, address, settled, cells, accrued) | Click **Contributors** | "Contributors shows the network: nine addresses across four cells, each with claimable rewards." |

### Shot 10 — close · 3:52–4:00 · End card

| Time | Screen shows | You do | You say |
|---|---|---|---|
| 3:52 | End card: the logo, **signalproof.mdloglabs.org**, **github.com/mdlog/signalproof**, *BUIDL CTC 2026 Fall · DePIN track* (deck slide 12 works) | Cut to the still | "SignalProof — verifiable connectivity data, settled on Creditcoin." |
| 3:56 | Same card | Hold 4 s | "Everything you saw is live on testnet; the repository, the deck and the verifier are linked below." |

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
