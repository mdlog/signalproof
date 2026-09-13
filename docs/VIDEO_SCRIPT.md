# SignalProof — demo video script

> Published 2026-09-13: https://youtu.be/a8pT_0w3Qa8 (4:07). Shots 1–3 and 5–10 were produced from this script by an automated pipeline against the live host; shot 4 was recorded by hand.

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

One cue per sentence. SCREEN (bahasa Indonesia) = apa yang harus terlihat di layar saat
kalimat itu diucapkan; DO (bahasa Indonesia) = yang dilakukan tangan Anda; SAY = narasi persis,
dalam bahasa Inggris untuk juri. Move to the next cue on the
last word of the previous sentence. Speak at ~155 words per minute; the main path
is about 620 words ≈ 4:00 including the pauses.

### Shot 1 — cold open · 0:00–0:14 · Verifier page (pre-opened)

```text
[0:00]
  SCREEN Kartu hasil verifier. Judul "Settled on Creditcoin", pil hijau SETTLED, baris
         "Area qqguw6 · contributor 0x5360…8c93".
  DO     Diam 2 detik — biarkan layar apa adanya.
  SAY    (pause)

[0:02]
  SCREEN Kartu yang sama. Kursor di langkah 1 "Measurement root" (centang hijau)
         beserta hash-nya.
  DO     Diamkan kursor di hash root.
  SAY    "This measurement was taken on a phone in Jakarta,"

[0:05]
  SCREEN Rel langkah: "Committed on Ethereum Sepolia" → "Attested by Creditcoin" →
         "Settled on Creditcoin CC3", masing-masing bercentang hijau.
  DO     Telusuri empat langkah itu dari atas ke bawah dengan kursor.
  SAY    "committed on Ethereum Sepolia, proven by the Attestcoin Protocol, and
         settled on Creditcoin —"

[0:09]
  SCREEN Panel "Attestcoin proof — what the precompile verified": baris Attested
         height, Transaction, Merkle inclusion, Continuity, execute().
  DO     Scroll sampai seluruh panel terlihat.
  SAY    "where a smart contract, not a server, decided it was real."

[0:12]
  SCREEN Tautan "explorer ↗" di samping sebuah hash.
  DO     Arahkan kursor ke tautannya, jangan diklik.
  SAY    "Every step is a transaction you can open. This is SignalProof."
```

### Shot 2 — the problem · 0:14–0:36 · Coverage overview

```text
[0:14]
  SCREEN Konsol setelah klik sidebar "Coverage overview": hero "Know where the signal
         breaks before users do." dan empat kartu KPI (Verified coverage 100 %,
         Measurements, Median latency, Rewards settled).
  DO     Klik item sidebar itu. Jauhkan kursor dari kartu-kartu KPI.
  SAY    "Anyone can claim coverage numbers. Nobody can prove them."

[0:19]
  SCREEN Kartu "Coverage signal map": pin berlogo di peta dengan kotak cell berbayang
         di sekelilingnya.
  DO     Scroll turun satu layar.
  SAY    "SignalProof turns each phone measurement into a claim a contract can check,
         and aggregates it per area."

[0:25]
  SCREEN Kotak berbayang di sekeliling pin qqguw6 terlihat jelas.
  DO     Klik "+" di peta satu kali, lalu diamkan kursor di tepi kotak cell.
  SAY    "Each box is a geohash cell about one kilometre wide — a contributor is
         somewhere inside it, never at a point."

[0:32]
  SCREEN Tooltip "qqguw6 · quality 94" di atas pin; legenda "shaded box = geohash
         cell" di kiri bawah.
  DO     Arahkan kursor ke pin.
  SAY    "The raw coordinate never leaves the phone."
```

### Shot 3 — how it works · 0:36–1:08 · GitHub README, Architecture diagram

```text
[0:36]
  SCREEN Tab GitHub. Diagram alir Mermaid terlihat utuh: kotak "Contributor device",
         "SignalProof server", "Ethereum Sepolia", "Attestcoin Protocol", "Creditcoin
         CC3 Testnet", "Consumers".
  DO     Pindah tab. Kursor ke "Measure", lalu ke "Wallet" di dalam kotak device.
  SAY    "The pipeline. The phone measures and signs;"

[0:40]
  SCREEN Kursor di "Gateway (tRPC)", mengikuti panah ke "Relayer" lalu ke
         "SourceBatchRegistry".
  DO     Telusuri panahnya perlahan.
  SAY    "the gateway checks the signature and relays to a registry on Sepolia, which
         recovers the signature again on-chain."

[0:47]
  SCREEN Kursor di "Attestation", lalu "Proof service" di dalam kotak Attestcoin.
  DO     Telusuri panah putus-putus "block attested".
  SAY    "Attestcoin attests Sepolia blocks on Creditcoin; once our block is attested,
         the proof service returns a Merkle inclusion proof and a continuity proof."

[0:55]
  SCREEN Kursor di "Proof worker" → panah "execute(proof)" → "BlockProver precompile"
         → "SignalProofSettlement" → "Reward pool".
  DO     Telusuri panah masuk ke kotak CC3.
  SAY    "Our settlement contract hands that proof to the BlockProver precompile — and
         only if it verifies does the contributor earn a reward."

[1:03]
  SCREEN Panah "Buyer → 0.05 CTC → Reward pool" di kanan bawah.
  DO     Diamkan kursor di panah itu.
  SAY    "Buyers pay into that same pool. Two chains, no oracle operator in the
         middle."
```

### Shot 4 — connect and measure · 1:08–1:50 · Run a test

```text
[1:08]
  SCREEN Tab aplikasi. Tombol header "Connect wallet" → dialog RainbowKit "Connect a
         Wallet" dengan daftar "Installed" (MetaMask ada di dalamnya).
  DO     Klik "Connect wallet", lalu pilih "MetaMask".
  SAY    "A real one. I connect a wallet —"

[1:12]
  SCREEN Popup MetaMask "Connect with MetaMask". Setelah disetujui, header menampilkan
         chip hijau "CC3" dan alamat singkat Anda.
  DO     Setujui di MetaMask.
  SAY    "it needs no balance; the relayer pays gas on both chains."

[1:16]
  SCREEN Sidebar "Run a test". Kartu "Capture a signal snapshot.", dial berlogo,
         tombol "Run valid test".
  DO     Klik "Run a test", lalu "Run valid test".
  SAY    "Run valid test:"

[1:19]
  SCREEN Cincin dial berputar berwarna, status "Sampling network…". Tile terisi
         berurutan: Coarse area (qqguw6, "±NN m → cell 1216×607 m · coordinate
         discarded"), Network class, Latency ("median of 7 round trips"), Throughput
         ("3.00 MB over 0.6 s").
  DO     Arahkan kursor ke tiap tile begitu terisi.
  SAY    "the browser measures latency as the median of seven timed round trips,
         throughput from a three-megabyte incompressible download, and turns my
         position into a six-character geohash before anything leaves the device."

[1:31]
  SCREEN Popup MetaMask "Signature request" menampilkan teks "SignalProof measurement
         …".
  DO     Setujui tanda tangan di MetaMask.
  SAY    "My wallet signs the measurement — free, no gas."

[1:35]
  SCREEN Label "Evidence pipeline" berubah menjadi "sent to gateway"; langkah 02
         "Source-chain event" menjadi hijau; lalu label berbunyi "N blocks to
         attestation · ~M min".
  DO     Diamkan kursor di label hitung mundur.
  SAY    "The gateway recomputes the hash, recovers the signer, and relays it to
         Sepolia."

[1:41]
  SCREEN Kotak hitung mundur: "attested height", "your block", dan catatan "Creditcoin
         attests Sepolia in batches of ~10 blocks, about every 2 minutes."
  DO     Arahkan kursor ke kotak hitung mundur.
  SAY    "Now the honest part: Creditcoin attests Sepolia about ten blocks every two
         minutes, so this settles in roughly eight minutes. We'll come back to it."
```

### Shot 5 — the proof, on screen · 1:50–2:12 · Proof queue → View proof

```text
[1:50]
  SCREEN Sidebar "Proof queue". Filter "All (N) · Settled · Awaiting". Kartu teratas
         Settled: centang hijau, "Proof verified on Creditcoin. Reward 0.001 CTC
         released."
  DO     Klik "Proof queue", lalu "View proof" pada kartu Settled paling atas.
  SAY    "This is what the precompile is given, fetched live with no key:"

[1:54]
  SCREEN Panel proof, baris "Attested height 11,681,452 (Sepolia block, tx index 96)".
  DO     Kursor di baris ini.
  SAY    "the attested Sepolia height,"

[1:57]
  SCREEN Baris "Merkle inclusion": root 0x145d… · 7 siblings: R 0x8b77…, L 0xbf56…
  DO     Kursor di baris ini.
  SAY    "seven Merkle siblings up to the block's transaction root,"

[2:01]
  SCREEN Baris "Continuity": 49 roots from lower endpoint 0x3e60…
  DO     Kursor di baris ini.
  SAY    "and the continuity roots that chain the block back to an attestation
         checkpoint —"

[2:05]
  SCREEN Baris "execute()": selector 0xc6339bf7 · action 0 · calldata 4,484 bytes ·
         gas ceiling 858,000.
  DO     Kursor di baris ini.
  SAY    "packed into one execute call."

[2:08]
  SCREEN Catatan kaki di bawah panel: "Anyone holding this proof may call execute();
         the settlement contract then checks…"
  DO     Diamkan kursor di catatan kaki.
  SAY    "Anyone holding this proof may call it. That is by design."
```

### Shot 6 — what the precompile does not check · 2:12–2:50 · Blockscout logs → the contract

```text
[2:12]
  SCREEN Blockscout, transaksi settlement, tab "Logs": MeasurementVerified ter-decode
         dengan measurementRoot, areaHash, contributor, rewardAmount.
  DO     Klik "Open on explorer" pada kartu Settled, lalu buka tab "Logs".
  SAY    "The settlement on Creditcoin: MeasurementVerified, with the root, the area,
         the contributor and the reward."

[2:20]
  SCREEN Log yang sama. Kursor di alamat kontrak penerbit 0x8F14…b584.
  DO     Arahkan kursor ke alamat kontrak.
  SAY    "The precompile proves inclusion in an attested block — and only that."

[2:24]
  SCREEN Tab GitHub: contracts/src/SignalProofSettlement.sol di-scroll ke dua baris
         revert (SourceTransactionFailed, WrongEmitter).
  DO     Pindah ke tab GitHub.
  SAY    "It does not prove the transaction succeeded, or which contract emitted the
         log."

[2:29]
  SCREEN Baris: if (receipt.receiptStatus != 1) revert SourceTransactionFailed(…)
  DO     Blok (select) baris ini agar tersorot.
  SAY    "So we check both: receipt status must be one,"

[2:32]
  SCREEN Baris: if (log.address_ != sourceRegistry) revert WrongEmitter(…)
  DO     Blok baris ini.
  SAY    "and the log must come from our registry."

[2:35]
  SCREEN Blok komentar di atas hook yang menyebut cek yang hilang dari contoh di docs.
  DO     Scroll naik dua layar.
  SAY    "That second check is missing from the SimpleMinterASC example in the
         Attestcoin docs; without it, anyone can prove a forged event from a lookalike
         registry and drain the pool."

[2:44]
  SCREEN contracts/test/EndToEnd.t.sol dengan nama fungsi
         test_forgedRegistryCannotSettleEvenWithValidProof terlihat.
  DO     Pindah ke tab ketiga yang sudah dibuka sebelumnya.
  SAY    "Our end-to-end test runs that attack, and only the emitter binding stops
         it."
```

### Shot 7 — settlement on camera · 2:50–3:03 · Proof queue

```text
[2:50]
  SCREEN Tab aplikasi, "Proof queue". Kartu pre-warm di paling atas berubah: pil
         "Awaiting attestation" → "Settled"; detail "Proof verified on Creditcoin.
         Reward 0.001 CTC released."; angka badge di sidebar berkurang.
  DO     Klik "Proof queue". Kalau perlu, tunggu poll 15 detik berikutnya.
  SAY    "And the measurement I submitted before recording has just settled: proof
         verified, reward accrued."

[2:57]
  SCREEN Footer sidebar "Live · N settled on CC3" dan badge header "CC3 TESTNET ·
         LIVE".
  DO     Diamkan kursor di footer sidebar.
  SAY    "Nothing here comes from a database — the dashboard is a join of the two
         chains' logs."
```

FALLBACK kalau kartunya masih kuning: layar menampilkan kartu kuning dengan "N blocks to attestation",
kursor di hitung mundur. Ucapkan: "The measurement I submitted before recording is still a few
blocks from attestation — that is the real cadence of the protocol, so I won't fake it. Here is the
one that settled just before we started." Lalu klik "View proof" pada kartu Settled di bawahnya.


### Shot 8 — the buyer pays the contributors · 3:03–3:38 · Data products → area page

```text
[3:03]
  SCREEN MetaMask sudah di akun B (pembeli). Sidebar "Data products". Kartu "API
         ACCESS — 0.05 CTC for 30 days, paid into the reward pool." dengan tiga
         langkah bernomor.
  DO     Ganti akun di MetaMask ke akun B, lalu klik "Data products".
  SAY    "The other side of the market. A buyer pays 0.05 CTC for thirty days of
         access —"

[3:09]
  SCREEN Tombol berbunyi "Confirm the payment in your wallet…"; popup MetaMask "Send
         0.05 CTC to 0x8F14…b584".
  DO     Klik "Buy API access — 0.05 CTC", lalu konfirmasi di MetaMask.
  SAY    "a plain transfer into the settlement contract, the same pool contributors
         claim from."

[3:15]
  SCREEN Tombol berbunyi "Waiting for the block…", lalu MetaMask "Signature request":
         "SignalProof API access / Transaction: 0x… / Address: 0x…".
  DO     Tanda tangani di MetaMask.
  SAY    "The buyer signs the transaction hash,"

[3:19]
  SCREEN Kartu hijau "Key active until <tanggal>", key sp1_…, tautan "Copy key · Copy
         curl · Payment on Blockscout".
  DO     Diamkan kursor di key-nya.
  SAY    "the server verifies the payment on chain and returns a key derived from it;
         nothing is stored."

[3:24]
  SCREEN Kartu area qqguw6 → dialog "Area brief — qqguw6" berisi markdown dan tabel
         provenance-nya.
  DO     Klik "Area brief", scroll dialognya sekali, lalu tutup.
  SAY    "What is metered is the service — per-area samples with provenance, briefs,
         exports — not the data, which is public on two chains."

[3:31]
  SCREEN Halaman /area/qqguw6: judul "qqguw6 · quality NN", strip KPI, kartu "The
         cell" (peta), kartu "Quality over time" (grafik), tabel "Every sample" dengan
         tautan Verify.
  DO     Klik judul kartu area (qqguw6).
  SAY    "Here is an area: the cell, quality over time, every sample with its two
         transactions,"

[3:36]
  SCREEN Bar unduhan browser: signalproof-qqguw6.csv
  DO     Klik "CSV".
  SAY    "and a CSV."
```

### Shot 9 — the network, operated · 3:38–3:52 · Operations → Contributors

```text
[3:38]
  SCREEN Halaman /ops, kartu "Reward pool": Pool balance, Reward per measurement 0.001
         CTC, "Runway N settlements" — 50 lebih tinggi daripada sebelum shot 8.
  DO     Klik "Operations", kursor ke "Runway".
  SAY    "Operations shows the pool's runway in settlements — it just went up by fifty
         —"

[3:44]
  SCREEN Kartu "Relayer gas": saldo Sepolia ETH dan Creditcoin CTC.
  DO     Kursor ke angka saldo.
  SAY    "and relayer gas on both chains."

[3:47]
  SCREEN Halaman /contributors: judul "9 contributors, N settled measurements across 4
         cells." dan tabel Leaderboard (rank, address, settled, cells, accrued).
  DO     Klik "Contributors".
  SAY    "Contributors shows the network: nine addresses across four cells, each with
         claimable rewards."
```

### Shot 10 — close · 3:52–4:00 · End card

```text
[3:52]
  SCREEN End card: logo, "signalproof.mdloglabs.org", "github.com/mdlog/signalproof",
         "BUIDL CTC 2026 Fall · DePIN track" (slide 12 deck bisa dipakai).
  DO     Potong ke gambar end card.
  SAY    "SignalProof — verifiable connectivity data, settled on Creditcoin."

[3:56]
  SCREEN Kartu yang sama.
  DO     Tahan 4 detik.
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
