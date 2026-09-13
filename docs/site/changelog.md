# Changelog

What shipped, newest first. Dates are commit dates on `main`.

## 2026-09-13

- Docs: these pages, served at `/docs` from `docs/site/*.md`.
- Proof queue lists every measurement, filtered (All / Settled / Awaiting) and paged eight at a time; the filter sits beside the title. Each row carries area, throughput, latency and age. The Recent measurements table left the overview and the reward card left the queue's side column.
- Contributors: the connected wallet's row reads **You** with its full address; leaderboard paged ten addresses at a time; rank numbers set small.
- Wallet: with several extensions installed the header asks which one, remembers the choice, and a refusal names the wallet that refused. Silent reconnect no longer reports "No wallet found" when wallets exist.
- Coverage map: the areas/mapped label moved to the top-right, clear of the zoom control.
- Geolocation "too coarse" message explains desktop fallbacks.

## 2026-09-12

- Product surface: paid buyer access (a CTC payment into the reward pool redeems a stateless API key), public verifier (`/verify`, `/v1/verify/:hash`), area page with quality trend, CSV/JSON export and an embeddable badge, contributors leaderboard and per-address profile, ops panel, auto-measure (ten-minute cycle with wallet signing).
- Read model: single-flight, stale-while-revalidate snapshot; dev-only test wallet seam; decline messages name the action.
- `pnpm e2e:surface`: live end-to-end check of the product surface.

## 2026-09-11 — hardening pass

- `SourceBatchRegistry` redeployed: the contributor's EIP-191 signature is recovered on chain (`0x32c0…c236`); settlement contracts repointed; the retired registry's history still read.
- Gateway rate limit: 3 measurements per contributor per cell per 10 minutes.
- Buyer API v1: `/v1/areas`, `/v1/areas/:area`, `/brief`; "Create area brief" works.
- Proof inspector ("View proof") and "Settle from my wallet"; `PROOF_WORKER_MODE=relay-only`.
- Sepolia transactions sent one JSON-RPC request at a time after a gateway hung batched sends.
- Container (Dockerfile), `fly.toml`, `render.yaml`; production bundle no longer imports Vite.
- Read-model hardening: empty log answers re-asked; a re-read may never shrink a served snapshot.
- Docs corrected: signatures were always verified at the gateway; the real limitation was that they were not carried on chain — now they are.
- Hackathon package: brief, deck, portal writeup, judge Q&A, rubric scorecard, demo runbook, video script.

## 2026-09-08 → 2026-09-10

- `SignalProofBatchSettlement`: many measurements, one continuity proof; sibling cross-check closes double settlement; foreign logs skipped, not fatal; gas probe (`BatchGasProbe.t.sol`).
- Registry gated to the relayer after the permissionless-registry finding; first redeploy.
- Dashboard reads the chain directly; no database needed to demo; coverage map draws decoded geohash cells.
- Browser measurement client: timed latency, streamed throughput, network class, geohash-6 area, wallet as identity; PWA manifest and service worker.
- Live end-to-end settlements recorded (8.5 min single; 3-in-1 batch).

## 2026-09-07

- Chain core: `SourceBatchRegistry` (Sepolia), `SignalProofSettlement` (`ASCBase` consumer, both precompile-complement checks, pull-payment rewards), relayer, proof worker, status machine, Foundry suite; first deployments to Sepolia and CC3 Testnet.
