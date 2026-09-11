# SignalProof — status and remaining work

Track: **DePIN** · Deadline: **2026-09-13 23:59 ET (2026-09-14 03:59 UTC)** — already extended
once; re-check the DoraHacks page before submitting.

## Done and verified (2026-09-11, hardening pass)

- [x] Contracts deployed and verified: `SourceBatchRegistry` `0x32c0…c236` (Sepolia — recovers the
      contributor's signature on-chain; retired `0x15F3…59Dc` still read), `SignalProofSettlement`
      and `SignalProofBatchSettlement` (CC3 Testnet). Addresses in `README.md` and `.env.example`.
- [x] Real cross-chain settlements on-chain, single and batch routes, including a 9.8-minute run
      through the signed registry — transaction hashes in `README.md`. Reward pool funded (≈5 CTC).
- [x] `pnpm check` clean · `pnpm test` 127/127 · `forge test` 75/75 · `pnpm build` clean ·
      `pnpm smoke` passing against CC3 Testnet · Docker image builds and serves keyless.
- [x] Dashboard reads the chain directly; proof inspector ("View proof") and "Settle from my
      wallet" on every queue row; `PROOF_WORKER_MODE=relay-only` for the wallet-settle demo.
- [x] Buyer API v1 (`/v1/areas`, `/v1/areas/{geohash}`, `/brief`) and a working "Create area brief".
- [x] Gateway rate limit: 3 measurements per contributor per cell per 10 minutes (policy).
- [x] Browser measurement client: real latency, throughput, network class, geohash-6 area;
      wallet-gated; `claim()` from the UI.
- [x] `docs/TECHNICAL_ARCHITECTURE.md` as-built; `.env.example` pre-filled with the public
      deployment; `Dockerfile`, `fly.toml`, `render.yaml`.

## Remaining before submission

- [ ] Public GitHub repository (the form requires the URL; README must be at the root).
- [ ] Project deck or whitepaper — **PDF URL** is a required field.
- [ ] Demo video — **URL** is a required field. Pre-warm a proof: the ~8 min attestation wait
      makes a live real-time demo impossible.
- [ ] Every team member registers on DoraHacks individually (Country of Residence and Country of
      Citizenship are required and cannot be filled in on someone's behalf).
- [ ] Attestcoin Protocol Integration Summary — paste from `docs/SUBMISSION.md`.

## Remaining, optional

- [ ] Deploy the container to a public HTTPS host and put the URL in the README and the form.
- [ ] 2–3 outside contributors measuring from different cells before recording.

## Not started (known limitations, stated in README)

- [ ] Native mobile client — the browser/PWA client is the measurement client.
- [ ] Anti-Sybil beyond the rate limit: device attestation, stake-weighted rewards.
- [ ] Buyer authentication and a retention policy.
