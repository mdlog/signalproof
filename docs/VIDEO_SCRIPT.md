# SignalProof — demo video script

Target length 4:00 (DoraHacks sets no limit). Narration in English — the judges are
the Creditcoin/Gluwa and CertiK teams. Record the browser at 1920×1080, one window,
zoom 110 % so labels read on a phone.

The video has one job: show a judge, in the first minute, that a phone measurement
really became a proof the Creditcoin contract verified — then show that the pipeline
is a product (buyers pay into the pool contributors claim from). Everything on screen
is live against Sepolia and CC3 Testnet; nothing is a fixture. If a live beat fails,
use its fallback and say so on camera. Never pass an old row off as new.

Sections: 1 Preparation · 2 Screens in order · 3 The script (per sentence) ·
4 Captions · 5 Fallbacks · 6 After recording

## 1. Before you press record

Do these in order. The settlement beat (shot 7) depends on the pre-warm timing.

```text
T-60  Open https://signalproof.mdloglabs.org once. Wait for the header badge
      "CC3 TESTNET · LIVE". (First chain read after a host restart takes ~20 s;
      after that every page paints instantly.)

T-60  Run the live check against the host:
        E2E_BASE=https://signalproof.mdloglabs.org \
        E2E_ACCESS_TX=0xed00a0b6dd4ee0b4d4760665b0bedf3cdb7279dd0b5ded0124a5925021e08d30 \
        pnpm e2e:surface
      Must print "28/28 checks passed".

T-45  MetaMask account A = contributor. On Creditcoin CC3 Testnet, >= 0.05 tCTC
      (gas for claim()). After connecting, the header shows the "CC3" chip.

T-45  MetaMask account B = buyer. >= 0.1 tCTC (0.05 price + gas). A second
      account, so the leaderboard and the purchase read as two parties.

T-30  MetaMask popups must open on the recording screen (Settings → Advanced).

T-20  Close other tabs. Hide the bookmarks bar. Disable notifications.
      Pre-open three tabs: (1) the app, (2) GitHub README at #architecture,
      (3) GitHub contracts/src/SignalProofSettlement.sol scrolled to the two
      revert lines. Optional 4th: contracts/test/EndToEnd.t.sol.

T-9   PRE-WARM: with account A, click "Run a test" → "Run valid test" once and
      let it reach "N blocks to attestation". Note the clock time.
      Attestation reaches the block ~7–9 min after it is mined; the worker
      settles on the next 15 s tick. Start recording at T-2 so the flip lands
      around shot 7 (2:50).

T-2   Start the screen recorder. First screen:
      https://signalproof.mdloglabs.org/verify/0x60d9e438e8549a101b144bd1e474475301c696640062601ddfd18f788e6aa2b5
```

Never run a local `pnpm dev` with the same relayer keys while the host is running —
two proof workers race on nonces.

## 2. Screens, in order

```text
 1  Verifier, a settled measurement        pre-opened URL above
 2  Console — Coverage overview            sidebar "Coverage overview"
 3  GitHub README — Architecture diagram   tab 2
 4  Console — Run a test                   sidebar "Run a test"
 5  MetaMask popups (connect, sign)        triggered by the app
 6  Console — Proof queue → View proof     sidebar "Proof queue"
 7  Blockscout, settlement tx, Logs tab    "Open on explorer" on a settled card
 8  GitHub — SignalProofSettlement.sol     tab 3
 9  Console — Proof queue (card flips)     sidebar "Proof queue"
10  Console — Data products → Buy access   sidebar "Data products"
11  Area page /area/qqguw6                 click the area card title
12  Operations /ops                        sidebar "Operations"
13  Contributors /contributors             sidebar "Contributors"
14  End card                               deck slide 12 or a still
```

## 3. The script — screen, action and words, in sync

One cue per sentence. SCREEN is what must be visible while the sentence is spoken,
DO is what your hand does, SAY is the exact narration. Move to the next cue on the
last word of the previous sentence. Speak at ~155 words per minute; the main path
is about 620 words ≈ 4:00 including the pauses.

### Shot 1 — cold open · 0:00–0:14 · Verifier page (pre-opened)

```text
[0:00]
  SCREEN Verifier result card. Header "Settled on Creditcoin", green pill SETTLED,
         line "Area qqguw6 · contributor 0x5360…8c93".
  DO     Nothing for 2 seconds — let it sit.
  SAY    (pause)

[0:02]
  SCREEN Same card. Cursor on step 1 "Measurement root" (green check) and its hash.
  DO     Rest the cursor on the root hash.
  SAY    "This measurement was taken on a phone in Jakarta,"

[0:05]
  SCREEN The rail: "Committed on Ethereum Sepolia" → "Attested by Creditcoin" →
         "Settled on Creditcoin CC3", each with a green check.
  DO     Trace the four steps top to bottom.
  SAY    "committed on Ethereum Sepolia, proven by the Attestcoin Protocol, and
         settled on Creditcoin —"

[0:09]
  SCREEN Panel "Attestcoin proof — what the precompile verified": rows Attested
         height, Transaction, Merkle inclusion, Continuity, execute().
  DO     Scroll so the whole panel is visible.
  SAY    "where a smart contract, not a server, decided it was real."

[0:12]
  SCREEN An "explorer ↗" link next to a hash.
  DO     Hover it, do not click.
  SAY    "Every step is a transaction you can open. This is SignalProof."
```

### Shot 2 — the problem · 0:14–0:36 · Coverage overview

```text
[0:14]
  SCREEN Console after clicking sidebar "Coverage overview": hero "Know where the
         signal breaks before users do." and the four KPI cards (Verified coverage
         100 %, Measurements, Median latency, Rewards settled).
  DO     Click the sidebar item. Keep the cursor off the cards.
  SAY    "Anyone can claim coverage numbers. Nobody can prove them."

[0:19]
  SCREEN Card "Coverage signal map": logo pins on the map with shaded cells around
         them.
  DO     Scroll one screen down.
  SAY    "SignalProof turns each phone measurement into a claim a contract can check,
         and aggregates it per area."

[0:25]
  SCREEN The shaded rectangle around the qqguw6 pin, clearly visible.
  DO     Click "+" on the map once, rest the cursor on the edge of the box.
  SAY    "Each box is a geohash cell about one kilometre wide — a contributor is
         somewhere inside it, never at a point."

[0:32]
  SCREEN Tooltip "qqguw6 · quality 94" over the pin; legend "shaded box = geohash
         cell" bottom-left.
  DO     Hover the pin.
  SAY    "The raw coordinate never leaves the phone."
```

### Shot 3 — how it works · 0:36–1:08 · GitHub README, Architecture diagram

```text
[0:36]
  SCREEN GitHub tab. The Mermaid flowchart fully visible: boxes "Contributor device",
         "SignalProof server", "Ethereum Sepolia", "Attestcoin Protocol", "Creditcoin
         CC3 Testnet", "Consumers".
  DO     Switch tab. Cursor on "Measure", then "Wallet" inside the device box.
  SAY    "The pipeline. The phone measures and signs;"

[0:40]
  SCREEN Cursor on "Gateway (tRPC)", following the arrow to "Relayer" and on to
         "SourceBatchRegistry".
  DO     Trace the arrow slowly.
  SAY    "the gateway checks the signature and relays to a registry on Sepolia, which
         recovers the signature again on-chain."

[0:47]
  SCREEN Cursor on "Attestation", then "Proof service" inside the Attestcoin box.
  DO     Trace the dotted "block attested" arrow.
  SAY    "Attestcoin attests Sepolia blocks on Creditcoin; once our block is attested,
         the proof service returns a Merkle inclusion proof and a continuity proof."

[0:55]
  SCREEN Cursor on "Proof worker" → arrow "execute(proof)" → "BlockProver precompile"
         → "SignalProofSettlement" → "Reward pool".
  DO     Trace into the CC3 box.
  SAY    "Our settlement contract hands that proof to the BlockProver precompile — and
         only if it verifies does the contributor earn a reward."

[1:03]
  SCREEN The arrow "Buyer → 0.05 CTC → Reward pool" at the bottom right.
  DO     Rest on the arrow.
  SAY    "Buyers pay into that same pool. Two chains, no oracle operator in the
         middle."
```

### Shot 4 — connect and measure · 1:08–1:50 · Run a test

```text
[1:08]
  SCREEN App tab. Header button "Connect wallet" → RainbowKit dialog "Connect a
         Wallet" with the "Installed" list (MetaMask in it).
  DO     Click "Connect wallet", then "MetaMask".
  SAY    "A real one. I connect a wallet —"

[1:12]
  SCREEN MetaMask popup "Connect with MetaMask". After approval the header shows the
         green "CC3" chip and your short address.
  DO     Approve in MetaMask.
  SAY    "it needs no balance; the relayer pays gas on both chains."

[1:16]
  SCREEN Sidebar "Run a test". Card "Capture a signal snapshot.", the dial with the
         logo, button "Run valid test".
  DO     Click "Run a test", then "Run valid test".
  SAY    "Run valid test:"

[1:19]
  SCREEN Dial ring spinning in colour, status "Sampling network…". Tiles fill in
         order: Coarse area (qqguw6, "±NN m → cell 1216×607 m · coordinate
         discarded"), Network class, Latency ("median of 7 round trips"), Throughput
         ("3.00 MB over 0.6 s").
  DO     Hover each tile as it fills.
  SAY    "the browser measures latency as the median of seven timed round trips,
         throughput from a three-megabyte incompressible download, and turns my
         position into a six-character geohash before anything leaves the device."

[1:31]
  SCREEN MetaMask popup "Signature request" showing the text "SignalProof measurement
         …".
  DO     Approve.
  SAY    "My wallet signs the measurement — free, no gas."

[1:35]
  SCREEN Label "Evidence pipeline" changes to "sent to gateway"; step 02 "Source-chain
         event" turns green; then the label reads "N blocks to attestation · ~M min".
  DO     Rest the cursor on the countdown label.
  SAY    "The gateway recomputes the hash, recovers the signer, and relays it to
         Sepolia."

[1:41]
  SCREEN The countdown box: "attested height", "your block", and the note "Creditcoin
         attests Sepolia in batches of ~10 blocks, about every 2 minutes."
  DO     Hover the box.
  SAY    "Now the honest part: Creditcoin attests Sepolia about ten blocks every two
         minutes, so this settles in roughly eight minutes. We'll come back to it."
```

### Shot 5 — the proof, on screen · 1:50–2:12 · Proof queue → View proof

```text
[1:50]
  SCREEN Sidebar "Proof queue". Filter "All (N) · Settled · Awaiting". Top card is
         Settled: green check, "Proof verified on Creditcoin. Reward 0.001 CTC
         released."
  DO     Click "Proof queue", then "View proof" on the first settled card.
  SAY    "This is what the precompile is given, fetched live with no key:"

[1:54]
  SCREEN Proof panel, row "Attested height 11,681,452 (Sepolia block, tx index 96)".
  DO     Cursor on the row.
  SAY    "the attested Sepolia height,"

[1:57]
  SCREEN Row "Merkle inclusion": root 0x145d… · 7 siblings: R 0x8b77…, L 0xbf56…
  DO     Cursor on the row.
  SAY    "seven Merkle siblings up to the block's transaction root,"

[2:01]
  SCREEN Row "Continuity": 49 roots from lower endpoint 0x3e60…
  DO     Cursor on the row.
  SAY    "and the continuity roots that chain the block back to an attestation
         checkpoint —"

[2:05]
  SCREEN Row "execute()": selector 0xc6339bf7 · action 0 · calldata 4,484 bytes · gas
         ceiling 858,000.
  DO     Cursor on the row.
  SAY    "packed into one execute call."

[2:08]
  SCREEN Footnote under the panel: "Anyone holding this proof may call execute(); the
         settlement contract then checks…"
  DO     Rest on the footnote.
  SAY    "Anyone holding this proof may call it. That is by design."
```

### Shot 6 — what the precompile does not check · 2:12–2:50 · Blockscout logs → the contract

```text
[2:12]
  SCREEN Blockscout, the settlement transaction, tab "Logs": MeasurementVerified
         decoded with measurementRoot, areaHash, contributor, rewardAmount.
  DO     Click "Open on explorer" on the settled card, open the "Logs" tab.
  SAY    "The settlement on Creditcoin: MeasurementVerified, with the root, the area,
         the contributor and the reward."

[2:20]
  SCREEN Same log. Cursor on the emitting contract address 0x8F14…b584.
  DO     Hover the address.
  SAY    "The precompile proves inclusion in an attested block — and only that."

[2:24]
  SCREEN GitHub tab: contracts/src/SignalProofSettlement.sol scrolled to the two
         revert lines (SourceTransactionFailed, WrongEmitter).
  DO     Switch tab.
  SAY    "It does not prove the transaction succeeded, or which contract emitted the
         log."

[2:29]
  SCREEN Line: if (receipt.receiptStatus != 1) revert SourceTransactionFailed(…)
  DO     Select the line so it is highlighted.
  SAY    "So we check both: receipt status must be one,"

[2:32]
  SCREEN Line: if (log.address_ != sourceRegistry) revert WrongEmitter(…)
  DO     Select the line.
  SAY    "and the log must come from our registry."

[2:35]
  SCREEN The comment block above the hook that names the missing check in the docs
         example.
  DO     Scroll up two screens.
  SAY    "That second check is missing from the SimpleMinterASC example in the
         Attestcoin docs; without it, anyone can prove a forged event from a lookalike
         registry and drain the pool."

[2:44]
  SCREEN contracts/test/EndToEnd.t.sol with the function name
         test_forgedRegistryCannotSettleEvenWithValidProof visible.
  DO     Switch to the pre-opened third tab.
  SAY    "Our end-to-end test runs that attack, and only the emitter binding stops
         it."
```

### Shot 7 — settlement on camera · 2:50–3:03 · Proof queue

```text
[2:50]
  SCREEN App tab, "Proof queue". The pre-warmed card at the top flips: pill "Awaiting
         attestation" → "Settled"; detail "Proof verified on Creditcoin. Reward 0.001
         CTC released."; the sidebar badge count drops.
  DO     Click "Proof queue". Wait for the 15 s poll if needed.
  SAY    "And the measurement I submitted before recording has just settled: proof
         verified, reward accrued."

[2:57]
  SCREEN Sidebar footer "Live · N settled on CC3" and header badge "CC3 TESTNET ·
         LIVE".
  DO     Rest the cursor on the footer.
  SAY    "Nothing here comes from a database — the dashboard is a join of the two
         chains' logs."
```

FALLBACK if the card is still amber: screen shows the amber card with "N blocks to attestation",
cursor on the countdown. Say: "The measurement I submitted before recording is still a few blocks
from attestation — that is the real cadence of the protocol, so I won't fake it. Here is the one that
settled just before we started." Then click "View proof" on the settled card below it.


### Shot 8 — the buyer pays the contributors · 3:03–3:38 · Data products → area page

```text
[3:03]
  SCREEN MetaMask switched to account B (buyer). Sidebar "Data products". Card "API
         ACCESS — 0.05 CTC for 30 days, paid into the reward pool." with the three
         numbered steps.
  DO     Switch account in MetaMask, click "Data products".
  SAY    "The other side of the market. A buyer pays 0.05 CTC for thirty days of
         access —"

[3:09]
  SCREEN Button reads "Confirm the payment in your wallet…"; MetaMask popup "Send 0.05
         CTC to 0x8F14…b584".
  DO     Click "Buy API access — 0.05 CTC", confirm in MetaMask.
  SAY    "a plain transfer into the settlement contract, the same pool contributors
         claim from."

[3:15]
  SCREEN Button reads "Waiting for the block…", then MetaMask "Signature request":
         "SignalProof API access / Transaction: 0x… / Address: 0x…".
  DO     Sign.
  SAY    "The buyer signs the transaction hash,"

[3:19]
  SCREEN Green card "Key active until <date>", the sp1_… key, links "Copy key · Copy
         curl · Payment on Blockscout".
  DO     Rest the cursor on the key.
  SAY    "the server verifies the payment on chain and returns a key derived from it;
         nothing is stored."

[3:24]
  SCREEN Area card qqguw6 → dialog "Area brief — qqguw6" with the markdown and its
         provenance table.
  DO     Click "Area brief", scroll the dialog once, close it.
  SAY    "What is metered is the service — per-area samples with provenance, briefs,
         exports — not the data, which is public on two chains."

[3:31]
  SCREEN Page /area/qqguw6: title "qqguw6 · quality NN", KPI strip, card "The cell"
         (map), card "Quality over time" (chart), table "Every sample" with Verify
         links.
  DO     Click the area card title.
  SAY    "Here is an area: the cell, quality over time, every sample with its two
         transactions,"

[3:36]
  SCREEN Browser download bar: signalproof-qqguw6.csv
  DO     Click "CSV".
  SAY    "and a CSV."
```

### Shot 9 — the network, operated · 3:38–3:52 · Operations → Contributors

```text
[3:38]
  SCREEN Page /ops, card "Reward pool": Pool balance, Reward per measurement 0.001
         CTC, "Runway N settlements" — 50 higher than before shot 8.
  DO     Click "Operations", cursor on "Runway".
  SAY    "Operations shows the pool's runway in settlements — it just went up by fifty
         —"

[3:44]
  SCREEN Card "Relayer gas": Sepolia ETH and Creditcoin CTC balances.
  DO     Cursor on the balances.
  SAY    "and relayer gas on both chains."

[3:47]
  SCREEN Page /contributors: headline "9 contributors, N settled measurements across 4
         cells." and the Leaderboard table (rank, address, settled, cells, accrued).
  DO     Click "Contributors".
  SAY    "Contributors shows the network: nine addresses across four cells, each with
         claimable rewards."
```

### Shot 10 — close · 3:52–4:00 · End card

```text
[3:52]
  SCREEN End card: the logo, "signalproof.mdloglabs.org",
         "github.com/mdlog/signalproof", "BUIDL CTC 2026 Fall · DePIN track" (deck
         slide 12 works).
  DO     Cut to the still.
  SAY    "SignalProof — verifiable connectivity data, settled on Creditcoin."

[3:56]
  SCREEN Same card.
  DO     Hold 4 seconds.
  SAY    "Everything you saw is live on testnet; the repository, the deck and the
         verifier are linked below."
```

## 4. Lower-third captions (optional, one per shot, mono font)

```text
1  verify/<hash> · commitment → attestation → proof → settlement
2  geohash-6 cells · ~1.2 km × 0.6 km · no coordinates on chain
3  Sepolia registry → Attestcoin proof → Creditcoin settlement → reward
4  measured, not asked · signed by the contributor · relayer pays gas
5  Merkle inclusion + continuity roots → execute() → BlockProver 0x…0FD2
6  receiptStatus == 1 · log.address == registry
7  MeasurementVerified · 0.001 CTC accrued
8  0.05 CTC → reward pool → key · service, not data
9  runway 5,1xx settlements · 9 contributors · 4 cells
```

## 5. Fallbacks, one per live dependency

```text
MetaMask lists the wrong account
  → Cancel, switch account in MetaMask, click "Connect wallet" again.
    RainbowKit reconnects the last-used wallet without a reload.

Header says "Prototype mode"
  → The host's first chain read after a restart takes ~20 s. Wait, reload once.
    Never record over it.

The pre-warm has not settled by shot 7
  → Use the fallback line under shot 7, or click "Settle from my wallet" if the
    row already reads "attested · fetching proof".

The "Buy API access" card is missing
  → BUYER_ACCESS_SECRET is not set on the host, so the gate is open by design.
    Redeploy with the secret. Do not record the beat without it.

The purchase shows "Waiting for the block…" for more than a minute
  → Keep talking through shot 8. The poll retries every 5 s for three minutes.
    Do not click twice.

Geolocation refused on the laptop
  → Chrome DevTools → Sensors → set a location to the cell you are actually in,
    or record shot 4 on a phone over the HTTPS host.
```

## 6. After recording

```text
1  Trim to <= 4:00. Export 1080p. Upload unlisted (YouTube) or a public Drive link.
2  Paste the URL into DoraHacks form field 8 (docs/SUBMISSION.md → Field 8).
3  docs/deck/SignalProof-deck.html, slide 12: replace "linked from the BUIDL page
   on DoraHacks" with the URL. Re-render:
     cd docs/deck && google-chrome --headless=new --no-pdf-header-footer \
       --print-to-pdf=SignalProof-deck.pdf SignalProof-deck.html
   Commit and push — the deck URL on the form stays the same.
```
