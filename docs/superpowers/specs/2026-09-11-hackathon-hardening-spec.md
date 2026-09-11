# SignalProof — pre-submission hardening spec

**Date:** 2026-09-11 · **Deadline:** 2026-09-14 03:59 UTC (~64 h at writing) · **Status:** approved by the team ("kerjakan semuanya")

## Why

The organizer's only published criterion is "Depth of Attestcoin Protocol utilization"; the theme
copy asks for "verified cross-chain data … without relying on centralized oracle operators"; the
top three go to CEIP due diligence ("BUIDL For The Real World"); CertiK reads the repo. Our
scorecard (`docs/RUBRIC_SCORECARD.md`) is weakest on *path to a real product* (2.7/5) and *DePIN
fit* (3.7/5), and a judge cannot see the Attestcoin mechanics without reading code.

## What ships (seven items, in dependency order)

| # | Item | Judge-visible outcome | Touches chain? |
|---|------|-----------------------|----------------|
| 6 | Contributor signature enforced **on-chain** in `SourceBatchRegistry` | A malicious relayer can no longer attribute a measurement to someone else; the source contract, not the gateway, is the authority | **Yes — registry redeploy + repoint** |
| 4 | Gateway rate limit per contributor per cell | Stated anti-Sybil policy: 3 measurements per contributor per geohash cell per 10 min | No |
| 3 | Buyer API v1 (`GET /v1/areas`, `GET /v1/areas/:geohash`) + working "Create area brief" | "Buyer API is not built" becomes a product surface with provenance per sample | No |
| 2 | "View Attestcoin proof" on settled/attested rows | The live proof (attested height, Merkle siblings, continuity roots, queryId) rendered in the UI | No (read-only) |
| 7 | "Settle from my wallet" + `PROOF_WORKER_MODE=relay-only` | Permissionless `execute()` demonstrated from a contributor's own wallet | No (user tx) |
| 1 | Public HTTPS deployment (Dockerfile + Fly/Render config) | Judges open a URL and see `CC3 TESTNET · LIVE`; phones can measure | No |
| 5 | Outside contributors before recording | ≥3 cells, ≥3 contributors on the map | No (team action) |

## Decisions

- **Registry keeps the relayer gate AND adds the signature check.** The gate stops outsiders from
  bypassing gateway validation (freshness, geohash precision, rate limit) with self-signed junk;
  the signature stops the relayer from forging attribution. Both are needed; neither alone suffices.
- **The signed message stays exactly `buildMeasurementSigningMessage`** (the human-readable
  EIP-191 text the wallet already shows). The contract rebuilds that text; a test vector produced
  by ethers pins TypeScript and Solidity to the same bytes.
- **The `MeasurementSubmitted` event does not change**, so both settlement contracts stay
  deployed and are only repointed with `setSourceRegistry` (script exists: `deploy.sh repoint`).
- **Dashboard history is kept**: the previous gated registry is scanned as a *retired* registry
  (`RETIRED_REGISTRIES=address:deployBlock,...`), the same way retired settlement routes are.
- **Rate limiting is in-process and stated as such**; it resets on restart. Good enough for a
  policy statement, not a Sybil defence — README says so.
- **Buyer API is read-only JSON derived from the on-chain snapshot**; no auth, no retention
  policy yet — README says so.
- **`proofFor` uses a keyless read context** (providers + ChainInfo + ProofBuilder); no relayer key
  is needed to fetch a proof, exactly like `pnpm smoke`.
- **Self-settle sends `execute()` from the browser wallet on CC3** with the args the server built;
  in `PROOF_WORKER_MODE=relay-only` the worker still relays to Sepolia but never settles, so the
  button is the only path to a reward — the demo mode. Default mode is unchanged (`full`).
- **Code freeze 12 h before the deadline.** Anything not green by then is cut, not rushed.

## Non-goals

Native app, anti-Sybil scoring beyond the rate limit, buyer authentication/retention, write-ability,
mainnet. All remain listed under known limitations.
