# SignalProof — product surface spec

**Date:** 2026-09-12 · **Deadline:** 2026-09-14 03:59 UTC · **Status:** approved by the team
("tambahkan semua fitur … mulai dari fitur 1 sampai fitur 6", then "lanjutkan hingga selesai")

## Why

`docs/RUBRIC_SCORECARD.md` puts the weakest criterion at C3, *real-world use case and path to a
product* (3.3/5): a working rail with no customer. Everything below turns the rail into something a
buyer, a contributor, and an operator can each use without reading the code — and each item is
demonstrable on screen. None of it touches the contracts.

## What ships (six items, in build order)

| # | Item | Who it serves | Judge-visible outcome |
|---|------|---------------|-----------------------|
| 0 | Real routes + shared `AppShell` | everyone | Deep links exist; `Home.tsx` stops growing |
| 1 | Buyer pays CTC → API key → pool | buyer, contributor | The DePIN loop closes on screen: a payment lands in the reward pool that contributors claim from |
| 2 | Public verifier `/verify/:hash` | anyone | Paste a hash, see both chains and the Attestcoin proof; shareable |
| 6 | Area page `/area/:geohash` + CSV/JSON export + badge | buyer, venue | A deliverable a customer actually receives and can embed |
| 3 | Contributors leaderboard + profile | contributor | The network looks like a network |
| 5 | Ops panel `/ops` | operator | Balances, pool runway, worker and RPC health — visibly operated |
| 4 | Auto-measure in the PWA | contributor | Install, toggle, leave it running |

Order rationale: #6 depends on #1's gate; #4 is last because it touches the measure flow, the one
part of the client that must not regress before the video.

## 0. Routes and shell

- `wouter` routes in `client/src/App.tsx`: `/` (existing Home, unchanged modes), `/verify`,
  `/verify/:hash`, `/area/:geohash`, `/contributors`, `/contributors/:address`, `/ops`.
- `client/src/components/AppShell.tsx` owns the sidebar, header, wallet control and the wrong-chain
  banner. Home keeps its four modes and renders inside the shell; the shell's nav links to the new
  pages. Nothing inside Home's modes is rewritten.
- Wallet state comes from a `WalletProvider` context so the shell, Home and the new pages share one
  connection (today `useWallet()` is instantiated once inside Home).

Alternative considered: more `mode`s inside `Home.tsx`. Rejected — no deep links, and the file is
already 770 lines of one component.

## 1. Buyer access — paid, stateless keys

**Purchase.** Data products → *Buy API access*: the wallet switches to CC3 (`switchToCreditcoin`),
sends `eth_sendTransaction { to: SignalProofSettlement, value: price }`. The transfer hits
`receive()` and emits `Funded(from, amount)` — the reward pool grows by exactly what the buyer paid.

**Redemption.** After the receipt, the wallet signs (EIP-191, `personal_sign`) the text

```
SignalProof API access
Transaction: <txHash>
Address: <address>
```

and the client calls `POST /v1/access/redeem { txHash, address, signature }`. The server checks,
against the CC3 RPC: `tx.to == settlement`, `tx.value >= price`, `receipt.status == 1`, and that
the recovered signer equals `tx.from` (so a stranger who reads a `Funded` event on Blockscout cannot
redeem someone else's payment). It replies with the key, the expiry, and a `curl` example.

**Key format.** `sp1_<expiryUnix>_<txHash>_<hmac>` where `hmac` is the first 16 bytes (hex) of
HMAC-SHA256(`BUYER_ACCESS_SECRET`, `${txHash}|${expiryUnix}`). Expiry = the payment block's
timestamp + `BUYER_ACCESS_DAYS`. Verification is offline: parse, `expiry > now`, recompute the HMAC.

Why stateless: no table, survives restarts, and **replay is a non-issue** — redeeming the same
transaction twice yields the same key, so "I lost my key" is "sign again". Cost: no per-key
revocation (rotating the secret revokes all). Stated in README.

**Gate.** `Authorization: Bearer sp1_…` on `/v1/areas/:area`, `/v1/areas/:area/brief`,
`/v1/areas/:area/export.csv`, `/v1/areas/:area/export.json`. A missing or invalid key returns
`401 { error: "ACCESS_REQUIRED", price, days, howTo }`. Free: `/v1/areas` (catalog),
`/v1/access` (terms), `/v1/access/redeem`, `/v1/verify/:hash`, `/v1/areas/:area/badge.svg`.
The dashboard keeps reading tRPC for free.

What is sold is the *service* — aggregation, the provenance join, briefs, exports, uptime — not
the data, which is public on two chains. README and the judge Q&A say this in one sentence.

**Client.** Price card; after purchase the key is shown once with copy + `curl`, stored in
`localStorage` under `signalproof.accessKey`, and sent by the dashboard's own brief/export calls.
Without a key those calls show the 401 as-is and offer the purchase.

**Env.** `BUYER_ACCESS_PRICE_CTC=0.05`, `BUYER_ACCESS_DAYS=30`, `BUYER_ACCESS_SECRET` (falls back
to `JWT_SECRET`; if both are empty, `/v1/access` reports `enabled: false` and the gate is *open* —
the API behaves as today — and the UI hides the purchase card. This keeps a keyless clone working.)

**Tests.** `access.test.ts`: issue → verify round trip; tampered hmac, tampered expiry, expired,
wrong prefix all refused; `verifyPurchase` with a fake provider: wrong `to`, value below price,
status 0, signer ≠ `from`, and the happy path; middleware returns 401 with the terms body.

## 2. Public verifier

`resolveVerification(snapshot, hash)` matches the hash (case-insensitive) against every
measurement's `measurementRoot`, `sourceTxHash`, and `creditcoinTxHash`, reporting which matched.
Output: the joined record (status, area, contributor, reward, both tx hashes, explorer links);
`attestationProgress` when still awaiting; and, when a source tx exists, the existing
`getProofSummary` (attested height, Merkle siblings, continuity roots, `execute()` calldata).
Not in the scanned window → `{ found: false, scannedFromBlock }`, never "invalid".

Routes: tRPC `signalproof.verify({ hash })` for the page; `GET /v1/verify/:hash` free JSON.
Page: input at `/verify`, result at `/verify/:hash`. Every API sample gains `verifyUrl`; the
proof-queue rows link to it.

Tests: `verify.test.ts` — match by each field, no match, malformed input.

## 3. Contributors

`listContributors(snapshot)`: group measurements by contributor → `settled`, `awaiting`, unique
`areas`, `rewardAccruedWei` (sum of settled `rewardAmount`), `firstSeen`, `lastSeen`; sorted by
settled desc, then lastSeen desc; `rank` 1-based. `/contributors` renders the table;
`/contributors/:address` reuses `getContributorStats` (already built: history, claims, areas) and
shows the claim control when the connected wallet is that address. `WalletControl` gains
*My profile*.

Tests: `contributors.test.ts` — grouping, ordering, tie-break, empty snapshot.

## 4. Auto-measure

- `useMeasurementRun()` extracted from `Home.tsx` (`runTest` and its state) so the loop and the
  button share one implementation; Home's measure mode behaves exactly as before.
- Toggle *Auto-measure every 10 min* in the measure mode (interval `AUTO_MEASURE_INTERVAL_MS =
  600_000`, under the gateway's 3 per cell per 10 min). Pure scheduler
  `nextAutoRun(lastRunAt, now, interval)` is unit-tested.
- Each cycle: measure, then the wallet prompts for `personal_sign` — unavoidable, because the
  registry recovers the contributor's signature on-chain; one sentence in the UI says so. A reading
  not signed within 14 minutes (gateway freshness is 15) is discarded and logged as
  `skipped: not signed`.
- Cycle log (time, area, result, reason) in `localStorage` under `signalproof.autoMeasure`;
  `navigator.wakeLock` requested when available; Notification API (permission asked on toggle)
  fires when a tracked measurement flips to `SETTLED`.
- Honest note on screen: background tabs are throttled — install the PWA and keep it in front.

## 5. Ops panel

`getOpsStatus()` in `server/signalproof/ops.ts`, tRPC `signalproof.ops`, page `/ops`, refresh 15 s:

- Relayer addresses (derived from the configured keys — public) and balances: Sepolia ETH, CC3 CTC.
- Pool balance and **runway** = ⌊pool / rewardAmount⌋ settlements (`poolRunway()` unit-tested,
  including `rewardAmount == 0`).
- Worker: mode, running, `lastTickAt`, last tick result `{relayed, settled, recovered}`,
  `lastError`, `consecutiveFailures` — from a small `workerHealth` record in `proofWorker.ts`.
- Snapshot/RPC: `lastSuccessAt`, `lastError`, `emptyResultsRejected` (how often
  `reconcileSnapshot` refused a regressed read — the publicnode symptom).
- Attestation: attested height vs Sepolia head, lag.

No secrets in the response. Never a 500: every probe is `try/catch` and reports `error` per row.

## 6. Area page, export, badge

- `/area/:geohash`: the cell on the map (reuse `CoverageMap`), KPIs, **quality trend**
  (`areaTrend(view)` → `{ t, quality, latencyMs, downloadMbps }` per sample, sorted by time;
  `recharts` line chart), sample table with verify links, buttons CSV / JSON / Brief (send the
  stored key; without one, show the 401 and the purchase offer), and an embed snippet for the badge.
- `GET /v1/areas/:area/export.csv` — header `measurementRoot,status,contributor,timestamp,
  latencyMs,downloadMbps,quality,sourceTxHash,creditcoinTxHash,rewardWei` — and `/export.json`
  (`{ area, generatedAt, samples }`), both gated.
- `GET /v1/areas/:area/badge.svg` — free, `Cache-Control: public, max-age=60`, a 20 px-high SVG
  "SignalProof · qqguw6 · quality 82 · 7 samples · verified on Creditcoin", colour from the same
  quality thresholds the map uses. Unknown area → a grey "no data" badge, 200.

Tests: `areaExport.test.ts` — CSV escaping and header, JSON shape, badge SVG contains the label and
the colour, trend ordering.

## Cross-cutting

- **Untouched:** contracts (75 Foundry tests stay), relay/settle worker logic, the measurement
  code in `client/src/lib/measure.ts`, the signing message.
- **Every feature is one commit**, `pnpm check` + `pnpm test` + `pnpm build` green before the next.
  Plain commit messages, no attribution trailers.
- **Docs:** README subsections (buyer access — including the "service, not data" sentence —,
  verify, area page/export/badge, contributors, ops, auto-measure), `.env.example`,
  `docs/TECHNICAL_ARCHITECTURE.md`, `todo.md`, `docs/JUDGE_QA.md` (one Q on the paid API).
- **Honesty rules carry over:** nothing rendered that the chain does not say; a keyless clone
  still works (open gate, purchase card hidden); every 401 shows the real response.
- **Code freeze:** 2026-09-13 15:59 UTC, as in the previous spec. Whatever is not green is cut.

## Non-goals

Per-key revocation, buyer accounts, retention policy, anti-Sybil beyond the rate limit, native
client, session-key delegation for silent auto-measure (would need a delegation registry on-chain),
webhooks/alerts, realtime push.
