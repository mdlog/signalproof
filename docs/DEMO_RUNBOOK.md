<!-- trace: idea="SignalProof — verifiable connectivity data for DePIN: phone measurements committed on Ethereum Sepolia, proven by the Attestcoin Protocol, settled and rewarded on Creditcoin CC3 Testnet." | event="BUIDL CTC 2026 Fall" | deadline="2026-09-13 23:59 ET (2026-09-14 03:59 UTC) — re-verified live 2026-09-11 09:36 UTC: payload timelineEnd=1789358340, isExtended=true" | source=submission-packager -->
# Demo runbook — SignalProof

**Format:** there is no stage. BUIDL CTC 2026 Fall is online; the form takes a **Prototype Demo
Video URL** and no length limit is published. This runbook is for **recording the ~3-minute video**
and for the judge who clones the repo and clicks through it. Anything that would break on camera
would break for that judge too.

**Target:** 3:00 recorded (hard self-imposed cap 3:30). **Wow beat at 1:30–2:00:** a measurement
submitted before recording flips to **Settled** on camera, with the Creditcoin transaction one click
away. The beat is **REAL** — the BlockProver precompile verifies the inclusion proof on CC3 Testnet
and the contract accrues the reward. Nothing on the demo path is mocked; the only fixture-shaped
element in the UI is the disabled "Create area brief (not built)" button, which says so on its face.

**The constraint that shapes everything:** end-to-end is 9–13 minutes (attestation ~7–9 min, worker
ticks every 15 s). A measurement started on camera cannot settle on camera. So the demo shows
**two measurements**: one submitted ~10 minutes before recording (it settles during the take) and one
submitted live (it reaches "Awaiting attestation" with the block countdown). Both are real.

---

## Pre-demo setup (do this before you press record)

### T-60 min — environment
- [ ] `.env` on the recording machine has **both relayer keys** (`SEPOLIA_RELAYER_PRIVATE_KEY`, `CREDITCOIN_RELAYER_PRIVATE_KEY`), funded burners. Without them the sidebar "Protocol rail" reads **"Chain not configured"** even though the dashboard is live, and the measurement you submit on camera never leaves the gateway.
- [ ] `SEPOLIA_RPC_URL=https://sepolia.gateway.tenderly.co` (the template value; PublicNode returned empty `eth_getLogs` on 4 of 8 identical calls on 2026-09-11 and flipped the dashboard to "Prototype mode"). Keep a second Sepolia URL in a comment for a between-takes swap.
- [ ] `pnpm smoke` passes. Note the printed **lag behind Sepolia head** (was 44 blocks ≈ 8.8 min today). If it prints > 60 blocks, move the pre-warm earlier by the difference.
- [ ] `pnpm dev` → console prints the port (it falls forward from 3000 if 3000 is busy — read the line, do not assume). Open the printed URL.
- [ ] Sidebar reads **"Attestcoin ready"** with the glowing dot, footer reads **"Live · N settled on CC3"**, header badge reads **"CC3 TESTNET · LIVE"**, KPI cards show numbers, not em-dashes. If the footer says **"Prototype mode · fixture data"**, the Sepolia read failed — see fallbacks.
- [ ] Reward pool: the contract at `0x8F14B2cC1b807203d332DE6E3DA6274176FDb584` held 4.997 CTC on 2026-09-11. Each settlement accrues 0.001 CTC. Fine for any number of takes.
- [ ] **Do not restart `pnpm dev` between the pre-warm and the take** unless `DATABASE_URL` is set: the in-memory store loses the pending row's tracker (the chain-read dashboard still shows it, but the "Run a measurement" panel stops following it). If you must restart, pre-warm again.

### T-45 min — wallet
- [ ] MetaMask (or any EIP-6963 wallet) in the recording browser profile, with the **contributor account** you will show. It needs **no balance** to submit; it needs a little **CTC on CC3 Testnet** to `claim()` (faucet: Creditcoin Discord `#token-faucet`, `/faucet address:<burner>` — the dispense amount is undocumented, ask early).
- [ ] CC3 Testnet is added to the wallet, or let the app add it: the "Switch to CC3 Testnet" button calls `wallet_addEthereumChain` with chainId `0x18e8f` (102031), RPC `https://rpc.cc3-testnet.creditcoin.network`, explorer `https://creditcoin-testnet.blockscout.com`.
- [ ] Wallet popups open on the **same screen** you are recording (MetaMask "notification" window position).

### T-45 min — location and measurement
- [ ] Record from **`http://localhost:<port>`** on the laptop. `localhost` is a secure context; `http://192.168.x.x` is not, and the UI will say **"Location needs a secure context. Open this over HTTPS, or on localhost."** and stop.
- [ ] If you want the phone on camera: `cloudflared tunnel --url http://localhost:<port>` and open the `https://…trycloudflare.com` URL on the phone. `server/_core/vite.ts` already sets `allowedHosts: true`. Check the throughput card afterwards: if it reads **"compressed, unreliable"** the tunnel compressed the payload — use it for the location/latency shot only and take the throughput shot on the laptop.
- [ ] Browser site permission for geolocation is **not** set to "Block" from an earlier take (the message would be "You declined location. Nothing was sent.").

### T-11 min and T-9 min — pre-warm (two, not one)

- [ ] The gateway allows **3 measurements per wallet per cell per 10 minutes**. Two pre-warms plus
      the on-camera test from the same wallet in the same cell is exactly the limit; a fourth
      inside the window is refused with "Rate limited…". Use a second wallet or a second cell for
      extra takes.
- [ ] Decide the WOW beat: `PROOF_WORKER_MODE=full` (default; the relayer settles on camera) or
      `PROOF_WORKER_MODE=relay-only` (you settle from the wallet on camera — the stronger story).
      Restart the server after changing it.
- [ ] Connect wallet → sidebar **"Run a test"** → **"Run valid test"** → allow location → sign the `personal_sign` prompt → state reaches **"Awaiting attestation…"**. Note the geohash shown under **Coarse area** and the time.
- [ ] Two minutes later: **"Run another test"** is not offered while a row is attesting, so open a **second tab** on the same URL, connect the same wallet, and submit pre-warm #2. Two pre-warms give a window: whichever settles first between 1:30 and 3:00 of the take is the wow beat.
- [ ] Sidebar **"Proof queue"** now shows both as **"Awaiting attestation"** linking to their Sepolia transactions. Keep this tab as the recording tab.

### T-5 min — recording hygiene
- [ ] 1920×1080, browser zoom 110–125% so the mono labels are legible, OS notifications off, other tabs closed, a terminal ready at ≥ 16 pt font if you show `pnpm smoke`.
- [ ] Explorer pages pre-opened in tabs (they load slowly on camera): the registry on Etherscan, the settlement contract and the batch contract on Blockscout, and the transactions listed under "Explorer links to have open" in `docs/VIDEO_SCRIPT.md`.
- [ ] **Backup recording exists** (see Murphy's law): a complete earlier pass, plus screenshots of the explorer pages.

### Reset between takes
- On-chain: nothing to reset; every take adds real rows.
- UI: **"Run another test"** (after settled) or **"Reset scenario"** (after rejected) returns the measure panel to **"Ready to measure"**. The proof queue keeps history; that is fine, it is real.
- If a take slipped past the pre-warm window, submit two new pre-warms and wait 9 minutes. Do not fake it with an old row and call it new.

---

## Click path (timed, bound to `client/src/pages/Home.tsx` as built)

Mode names, button labels and status strings below are the exact strings in the component.
Nobody has driven this in a browser from this document yet — every row is
**UNVERIFIED-IN-BROWSER** until the rehearsal log says otherwise.

| Time | Action (exact click / route) | What the judge sees | REAL or MOCKED | Verified |
|---|---|---|---|---|
| 0:00–0:15 | Open `http://localhost:<port>`; default mode **"Coverage overview"**. Say the hook. | Header **"CC3 TESTNET · LIVE"**; sidebar footer **"Live · N settled on CC3"**; KPI cards **Verified coverage / Measurements / Median latency / Rewards settled**; the 4-step "Operational proof spine" strip with **"N waiting · N settled"** | REAL (read from both chains, no database) | UNVERIFIED-IN-BROWSER |
| 0:15–0:40 | Sidebar **"Proof queue"**. On the top **"Settled"** card click **"View proof"**, then **"Open on explorer"**. | Card text **"Proof verified on Creditcoin. Reward 0.001 CTC released."**; the proof panel **"Attestcoin proof — what the precompile verified"** with **Attested height**, **Merkle inclusion** (N siblings, L/R), **Continuity** (N roots), **execute()** (selector `0xc6339bf7`, calldata size, gas ceiling). Explorer tab: the `execute` call on `0x8F14…b584`, **Logs** shows `MeasurementVerified` | REAL (proof fetched live from the Attestcoin proof service, no key) | VERIFIED-IN-BROWSER 2026-09-11 (keyless clone) |
| 0:40–1:10 | Header **"Connect wallet"** → approve. Sidebar **"Run a test"** → mode title **"Run a measurement"**, badge **"LIVE MEASUREMENT · TESTNET SETTLEMENT"**. Click **"Run valid test"** → allow location → wait for the four cards → sign the wallet prompt. | Circle label goes **"Sampling network…"** → **"Measurement submitted"** → **"Awaiting attestation…"**. Cards fill: **Coarse area** (geohash, "coordinate discarded"), **Latency** ("median of 7 round trips"), **Throughput** ("3.00 MB over Ns"), **Network class**. **"What the app sends"** shows the exact JSON | REAL (measured on this device; relayed to Sepolia by the worker within 15 s) | UNVERIFIED-IN-BROWSER |
| 1:10–1:30 | Stay on the panel: the **Evidence pipeline** label goes **"sent to gateway"** → **"awaiting Creditcoin attestation · ~8 min"** → **"N blocks to attestation · ~M min"** (the countdown appears on the first `attestationProgress` poll, ≤ 20 s after the relayer's 15 s tick has put the row on Sepolia). Then sidebar **"Proof queue"**, click the new **"Awaiting attestation"** card. | The **attested height / your block** box; card text **"Source block is mined; waiting for Creditcoin attestation."** New tab (Etherscan): `submitMeasurement` from the relayer to `0x32c0…c236` — the 8th argument is the contributor's signature, recovered on-chain — `MeasurementSubmitted` with `contributor` = the connected wallet | REAL | UNVERIFIED-IN-BROWSER |
| 1:30–2:00 | **WOW.** Either the pre-warm card flips to **"Settled"** on the 15 s poll, or — with `PROOF_WORKER_MODE=relay-only` — you press **"Settle from my wallet"** on the attested card, confirm in the wallet, and watch it flip. Click it → Blockscout. Then sidebar **"Contributors"** → your row reads **"You"** → open it: the **Contributor reward** card shows the accrued balance, **"Claim 0.001 CTC"** → confirm in wallet (on CC3) → **"Claim sent — view on Blockscout"**. | A phone measurement, proven by the Attestcoin precompile, paid on Creditcoin, claimed by the contributor's own wallet — in one screen | **REAL — must be.** If no pre-warm has settled by 2:00, use fallback F1 below | UNVERIFIED-IN-BROWSER |
| 2:00–2:30 | Still in **"Proof queue"**: right column **"Trust boundary"** card. Read the three rows. Optional 10 s: back to **"Run a test"** → link **"Demo: submit a tampered payload (gateway rejects it)"** → sign → red message. | Rows **"Source registry is gated"**, **"Emitter binding"**, **"Batch route, same checks"**, each linking to the contract. Tamper demo prints **"Rejected by the gateway: MEASUREMENT_ROOT_MISMATCH…"** | REAL (the rejection is the server's, not a `setState`) | UNVERIFIED-IN-BROWSER |
| 2:30–2:50 | Sidebar **"Coverage overview"** → the map; then **"Data products"** → **"Area brief"** on the card → **"JSON with provenance"**. | Map subtitle **"aggregated from on-chain submissions"**; cells drawn from decoded geohashes; **"Weakest zones"** + **"Operator cue"**. Data products: the brief dialog with the per-sample provenance table; `/v1/areas/qqguw6` JSON in a new tab; footer **"Area cards and the read-only buyer API are live"** | REAL (map, API) — authentication and retention are labelled not built | VERIFIED-IN-BROWSER 2026-09-11 |
| 2:50–3:00 | End card. | Repo URL, the one-liner, what is next | — | UNVERIFIED-IN-BROWSER |

Wow beat check: it exercises real inference of a real proof (BlockProver precompile at
`0x…0FD2` verifying Merkle inclusion + continuity for a real Sepolia transaction) and a real value
transfer (`claim()`). It does not touch `src/lib/mock-data` — there is no such module in this repo.

---

## Murphy's-law fallbacks (one per live dependency on the demo path)

| # | If this breaks | Symptom on screen | Fallback (pre-wired) |
|---|---|---|---|
| F1 | **Attestation slower than planned** (lag > 60 blocks, or worker backoff) | Pre-warm still **"Awaiting attestation"** at 2:00; label reads "N blocks to attestation" with N not shrinking | Reorder, do not wait: film 2:00–2:50 first, come back to the queue at the end; if it still has not settled, cut in the **backup recording** of a flip and say on the voiceover that it settled N minutes later — then show the real Blockscout tx when the take is edited. Never present an already-settled row as "just settled". |
| F2 | **Sepolia RPC returns empty `eth_getLogs`** (PublicNode did this on 2026-09-11) | Header loses **"· LIVE"**; footer **"Prototype mode · fixture data"**; KPI em-dashes | `chainRead.ts` now re-asks an empty answer twice and refuses to let a re-read shrink a served snapshot, so a flap during a take self-heals on the next 15 s poll. If it persists: swap `SEPOLIA_RPC_URL` and restart **between takes only** (restart loses the in-memory pre-warm tracker). |
| F3 | **CC3 RPC** (`rpc.cc3-testnet.creditcoin.network`) unreachable | `pnpm smoke` step [1] fails; settlements stop; rewards card **"—"** | No second public CC3 endpoint is documented. Use the backup recording for 1:30–2:00 and the pre-opened Blockscout tabs for the explorer shots. Say "the CC3 RPC is down at the moment of recording" rather than hiding it. |
| F4 | **Proof service** (`prover.cc3-testnet.creditcoin.network`) slow or down | Label stuck at **"attested · fetching proof"**; server log shows `ProofBuilder` timeouts and backoff | The worker retries with exponential backoff and a 120 s timeout; nothing is lost. Same on-camera treatment as F1. |
| F5 | **Wallet not detected** | Header shows **"No wallet found"** link | Use the browser profile with MetaMask installed; EIP-6963 discovery has a 400 ms window, so reload once after unlocking the wallet. |
| F6 | **Wallet on the wrong network at claim time** | Amber banner **"Your wallet is on <chain>, not Creditcoin CC3 Testnet."**; **"Switch to CC3 Testnet"** button | Click it — it adds the chain if missing. Submitting does not need CC3, only `claim()` does. |
| F7 | **User rejects the signature** or closes the popup | **"Payload rejected"** with "You declined to sign the measurement." | **"Reset scenario"** → **"Run valid test"** again. Nothing reached any chain. |
| F8 | **Geolocation blocked** | "You declined location. Nothing was sent." / "Location needs a secure context…" | Reset the site permission (padlock icon) or move to `localhost`. For a phone, the `cloudflared` HTTPS tunnel. |
| F9 | **Throughput shows "compressed, unreliable"** | Throughput card footer | The tunnel compressed the 3 MB payload; take the throughput shot on `localhost`. |
| F10 | **Reward pool below what is owed** | Red box **"The reward pool holds X CTC, less than you are owed. Claiming would revert."** | `pnpm deploy:fund` or send CTC to `0x8F14…b584` from the deployer. Pool was 4.997 CTC on 2026-09-11 — only relevant after ~5,000 settlements. |
| F11 | **No CTC for claim gas** | Wallet estimates gas and fails | Fund the contributor wallet from the Discord faucet the day before; if unavailable, show the recorded claim `0x14853610…e0030` and say so. |
| F12 | **Server restarted after the pre-warm** (no `DATABASE_URL`) | Measure panel stops following the row; proof queue still shows it from chain state | Pre-warm again; or set `DATABASE_URL` and `pnpm db:push` before the session so rows survive restarts. |
| F13 | **Browser throttles the background tab** | Poll slows from 15 s to minutes; card does not flip | Keep the recording tab in the foreground; alt-tab to explorer tabs briefly. |
| F14 | **A judge clones with `.env.example` only (no keys)** | Dashboard live, but "Protocol rail" says **"Chain not configured"** | Expected: readiness reflects the relayer key. Pre-answered in `docs/JUDGE_QA.md` (Q18). Optional 10-minute code fix: relabel that state "Read-only — relayer key not set". |

Network-independent insurance: **record one complete successful pass end-to-end before the "real"
take** (screen recorder on the same machine) and keep the explorer screenshots. If the venue of
your own desk loses connectivity, the backup is what ships.

---

## Judge-clone path (what a judge can do without any key)

```bash
git clone --recursive https://github.com/mdlog/signalproof   # forge-std is a submodule; or `forge install` in contracts/
pnpm install
cp .env.example .env                  # pre-filled with the live deployment, no key needed to read
pnpm dev                              # dashboard shows the real settlements
pnpm smoke                            # resolved chainKey + attestation lag, ~10 s
pnpm verify                           # tsc + vitest (93) + forge test (67)
```

Before pushing, run exactly this from an empty directory. A judge who hits a missing submodule or a
failing `forge test` on the first try stops reading.

---

## Rehearsal log (REQUIRED before submission — 3 passes)

All three must come in under 3:30 with the wow beat landing inside the take, or the pre-warm
timing moves earlier and the pass is repeated.

- [ ] Pass 1: ___ min ___ s — pre-warm submitted at T-___ min — settled at ___:___ of the take — issues: ______________________
- [ ] Pass 2: ___ min ___ s — pre-warm submitted at T-___ min — settled at ___:___ of the take — issues: ______________________
- [ ] Pass 3: ___ min ___ s — pre-warm submitted at T-___ min — settled at ___:___ of the take — issues: ______________________
- [ ] After pass 3, flip every **UNVERIFIED-IN-BROWSER** above that behaved as written to **browser**, and fix the row text where the screen said something else.
