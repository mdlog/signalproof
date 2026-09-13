# Concepts

The vocabulary the rest of these docs use, and the rules behind each term.

## Measurement

One run of the browser client. It records:

| Field | How it is obtained |
|---|---|
| `latencyMs` | Median of seven timed `HEAD /api/net/ping` round trips, read from the Resource Timing entry (`responseStart − requestStart`), after one discarded warm-up |
| `downloadMbps` | A 3 MB incompressible stream from `/api/net/payload`, time-boxed to 12 s, first 250 ms excluded so TCP slow-start does not understate a fast link; marked unreliable if a proxy compressed it |
| `networkType` | `navigator.connection.effectiveType`, labelled as the browser's own estimate (Chrome/Edge only; `unreported` elsewhere) |
| `areaHash` | A geohash of the device's coarse position, see below |
| `timestampMs`, `nonce`, `sessionHash` | Freshness, uniqueness and a per-tab session binding |
| `contributorAddress` | The connected wallet — an identity, not a signer of transactions |

The browser's own `downlink` and `rtt` are deliberately not used as measurements: Chromium caps `downlink` at 10 Mbps, rounds `rtt` to 50 ms and randomises both per host. In one run they reported 7.5 Mbps and 50 ms for a link measured at 40.8 Mbps and 68 ms.

## Area cell (geohash)

The area is a **geohash of at most six characters**, roughly a **1.2 km × 0.6 km** cell. The gateway rejects anything finer. The raw coordinate is converted in the same function that reads it and never leaves the device; on chain the cell is stored as `bytes32`. The map decodes the geohash and draws the cell — a contributor is somewhere inside the box, never at a dot. A label that is not a geohash (the first-ever measurement used `a9c-46`) is listed as *unmapped* rather than placed.

## Measurement root and signature

The canonical payload is hashed (`keccak256`) into the `measurementRoot`. The contributor signs a human-readable EIP-191 message containing the root and their address — the text the wallet displays is rebuilt byte for byte by the registry contract, which recovers the signer on chain. Attribution is therefore a claim *by the contributor*, not an assertion by whoever called the API.

## Admission and payment

Two independent decisions, made by different parties:

- **Admission** is the gateway's: freshness (60 s clock skew ahead, 15 min behind), root recomputation, signature recovery, uniqueness of `nonce` and `measurementRoot`, and the rate limit. The relayer — the only address the registry accepts — carries those checks on chain.
- **Payment** is the Creditcoin contract's, and it is permissionless: anyone holding a valid Attestcoin proof may call `execute()`. The contract then checks the receipt status, the emitting contract, the contributor's signature (already enforced on the source side), replay and freshness before accruing a reward.

Neither party trusts the other. See [Security model](security.md).

## Pipeline status

```
SUBMITTED ──relayer──► AWAITING_ATTESTATION ──proof+settle──► PROOF_VERIFIED ──► SETTLED
    │                          │                                    │
    └──────────────────────────┴────────────────────────────────────┴──► REJECTED (+ rejectionCode)
```

| Status | Meaning |
|---|---|
| `SUBMITTED` | Admitted by the gateway, not yet on Sepolia |
| `AWAITING_ATTESTATION` | Committed on Sepolia; Creditcoin has not attested that block yet |
| `PROOF_VERIFIED` | Proof accepted by the precompile; settlement transaction in flight |
| `SETTLED` | `MeasurementVerified` emitted on Creditcoin; reward accrued. Terminal |
| `REJECTED` | A permanent failure with a machine-readable code. Terminal |

The dashboard's read model knows only two of these, because only two exist on chain: a root present on both chains is `SETTLED`, a root present only on Sepolia is `AWAITING_ATTESTATION`. End to end takes **9–13 minutes**, dominated by the attestation wait (Creditcoin attests Sepolia in batches of about ten blocks every two minutes, 35–45 blocks behind the head).

## Quality score

A composite from the two on-chain metrics, defined once in `shared/quality.ts` and used by the dashboard and the API alike:

```
lat = max(0, 100 − latencyMs / 2)       // 0 ms → 100, ≥ 200 ms → 0
dl  = min(100, downloadMbps)            // ≥ 100 Mbps → 100
quality = round(0.5 · lat + 0.5 · dl)
```

A missing component counts as 50. Thresholds: **Strong** ≥ 80, **Watch** 60–79, **Attention** < 60. For an area the inputs are the averages over its samples; the sample count is shown beside every score because one sample is a weak basis for a colour.

The score is a design decision, not a measurement; its inputs are. Upload speed and packet loss are collected by the gateway but are not on chain and do not enter the score.

## Rewards

Flat: **0.001 CTC per settled measurement**, accrued to `rewards[contributor]` on the settlement contract and withdrawn with `claim()` — the only transaction a contributor ever signs. The quality score does not change the reward: paying more for good signal would penalise contributors for their operator's coverage, and paying more for bad signal would invite faking it. What is paid for is a *proven, honest* measurement.

The pool is funded by the operator and by buyers: a buyer's API payment is a plain CTC transfer to the settlement contract, whose `receive()` credits the same pool.

## Rate limit

Three measurements per contributor per geohash cell per ten minutes, enforced in the gateway. It is a stated anti-spam policy, in-process and reset on restart — not a Sybil defence. Admission runs policy → integrity → limiter, so a forged submission can never consume an honest contributor's slot.
