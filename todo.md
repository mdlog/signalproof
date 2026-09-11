# SignalProof — status and remaining work

Track: **DePIN** · Deadline: **2026-09-13 23:59 ET (2026-09-14 03:59 UTC)** — already extended
once; re-check the DoraHacks page before submitting.

## Done and verified (2026-09-11)

- [x] Contracts deployed and verified: `SourceBatchRegistry` (Sepolia), `SignalProofSettlement`
      and `SignalProofBatchSettlement` (CC3 Testnet). Addresses in `README.md` and `.env.example`.
- [x] Real cross-chain settlements on-chain, single and batch routes — transaction hashes in
      `README.md`. Reward pool funded (≈5 CTC).
- [x] `pnpm check` clean · `pnpm test` 93/93 · `forge test` 67/67 · `pnpm build` clean ·
      `pnpm smoke` passing against CC3 Testnet.
- [x] Dashboard reads the chain directly; no database needed to demo. Defended against public
      RPCs that return empty log sets (`chainRead.ts`, tests in `chainRead.test.ts`).
- [x] Browser measurement client: real latency, throughput, network class, geohash-6 area;
      wallet-gated; `claim()` from the UI.
- [x] `docs/TECHNICAL_ARCHITECTURE.md` rewritten as-built (the pre-build draft described a
      static prototype, a REST API, and a native app that do not exist).
- [x] `.env.example` pre-filled with the public deployment so a clone shows live data.

## Remaining before submission

- [ ] Public GitHub repository (the form requires the URL; README must be at the root).
- [ ] Project deck or whitepaper — **PDF URL** is a required field.
- [ ] Demo video — **URL** is a required field. Pre-warm a proof: the ~8 min attestation wait
      makes a live real-time demo impossible.
- [ ] Every team member registers on DoraHacks individually (Country of Residence and Country of
      Citizenship are required and cannot be filled in on someone's behalf).
- [ ] Attestcoin Protocol Integration Summary — paste from `docs/SUBMISSION.md`.

## Not started (known limitations, stated in README)

- [ ] Carry contributor signatures on-chain. They are verified at the gateway (signer recovery),
      but the settlement contract still trusts the relayer's admission decision.
- [ ] Native mobile client — the browser/PWA client is the measurement client.
- [ ] Anti-Sybil scoring, platform attestation, retention policy.
