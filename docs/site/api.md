# API reference

Two surfaces. The **buyer API** is plain JSON on plain paths under `/v1`, meant to be `curl`ed by an operator's analyst. The **tRPC gateway** under `/api/trpc` is what the dashboard uses; it is public and documented here for completeness.

All data comes from the on-chain read model — a join of `MeasurementSubmitted` (Sepolia) and `MeasurementVerified` (Creditcoin). Nothing is served that the two chains do not agree on, and nothing session-binding (`signature`, `nonce`, `sessionHash`) is ever returned.

## Buyer API (`/v1`)

| Method | Path | Metered | Purpose |
|---|---|---|---|
| GET | `/v1/areas` | free | Every measured cell, most samples first |
| GET | `/v1/areas/{area}` | key | One cell: aggregates plus every sample with its provenance |
| GET | `/v1/areas/{area}/brief` | key | The same as a markdown brief a buyer can forward |
| GET | `/v1/areas/{area}/export.csv` | key | Every sample as CSV |
| GET | `/v1/areas/{area}/export.json` | key | Every sample as JSON, with the aggregate |
| GET | `/v1/areas/{area}/badge.svg` | free | An embeddable quality badge linking to the verifier |
| GET | `/v1/verify/{hash}` | free | Resolve a measurement root or transaction hash across both chains |
| GET | `/v1/access` | free | Terms for a metered key |
| POST | `/v1/access/redeem` | free | Turn a CTC payment into a key |

`{area}` is a geohash such as `qqguw6` (lowercase, `[a-z0-9-]`, max 32). Anything else answers `400 { "error": "INVALID_AREA" }`; a cell nobody has measured answers `404 { "error": "AREA_NOT_FOUND" }`.

Responses carry `Cache-Control: public, max-age=15` (60 s for badges and access terms); the underlying snapshot refreshes on a 15 s cadence.

### Access keys

Metered endpoints are gated only when the deployment sets `BUYER_ACCESS_SECRET` (or falls back to `JWT_SECRET`); a keyless clone leaves every endpoint open. What is sold is the service — aggregation, the provenance join, briefs, exports — not the data, which is public on two chains and stays free on the dashboard.

A key is bought with a plain CTC transfer to `SignalProofSettlement` on CC3 Testnet. The contract's `receive()` credits the **reward pool**, so a buyer's payment is, byte for byte, the money contributors later `claim()`.

1. `GET /v1/access` → price (`0.05 CTC` by default), `payTo`, `days` (30 by default) and the message to sign.
2. Send `priceWei` (or more) to `payTo` from the buyer's wallet.
3. Sign, with the same wallet, the EIP-191 message
   `SignalProof API access\nTransaction: <txHash>\nAddress: <address>`.
4. `POST /v1/access/redeem` with `{ "txHash", "address", "signature" }`.

```bash
curl -s -X POST https://<host>/v1/access/redeem \
  -H 'content-type: application/json' \
  -d '{"txHash":"0x…","address":"0x…","signature":"0x…"}'
# → { "key": "sp1_<expiry>_<txHash>_<hmac>", "expiresAt": "2026-10-13T…", "txHash": "0x…", "curl": "…" }

curl -s -H 'Authorization: Bearer sp1_…' https://<host>/v1/areas/qqguw6
```

Keys are stateless HMACs over `txHash|expiry`: the same transaction always yields the same key, "I lost my key" means "sign again", and a single key cannot be revoked — only the secret can be rotated. The redeemer must prove they sent the payment (the signature must recover to `tx.from`), otherwise anyone reading a `Funded` event could redeem someone else's purchase.

| Status | Body | Meaning |
|---|---|---|
| 401 | `{ "error": "ACCESS_REQUIRED", … }` | No key, or key refused (expired, bad HMAC) |
| 402 | `{ "error": "UNDERPAID" \| "WRONG_RECIPIENT" \| "TX_NOT_FOUND" \| "TX_FAILED" \| "SIGNER_MISMATCH", "price", "payTo" }` | The payment could not be verified |
| 409 | `{ "error": "ACCESS_NOT_CONFIGURED" }` | This deployment does not meter the API |
| 503 | `{ "error": "CHAIN_NOT_CONFIGURED" }` | No RPC configured |

Successful metered responses carry `X-SignalProof-Access-Expires`.

### `GET /v1/areas`

```json
{
  "generatedAt": "2026-09-13T01:20:00.000Z",
  "configured": true,
  "error": null,
  "provenance": {
    "registry": "0x32c0923cD58523864D2727FCaaB109783664c236",
    "settlement": "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584",
    "batchSettlement": "0x3B90e22f246bBa68f6de682b564c33b121D68C85",
    "sepoliaChainId": 11155111,
    "creditcoinChainId": 102031
  },
  "areas": [
    {
      "areaHash": "qqguw6",
      "cell": { "center": { "lat": -6.2265, "lon": 106.8036 }, "bounds": { "minLat": …, "maxLat": …, "minLon": …, "maxLon": … }, "widthM": 1216, "heightM": 607 },
      "sampleCount": 9, "settledCount": 9, "awaitingCount": 0,
      "avgLatencyMs": 29, "avgDownloadMbps": 87, "quality": 86,
      "lastUpdatedMs": 1789260000000
    }
  ]
}
```

`cell` is `null` for a label that is not a geohash.

### `GET /v1/areas/{area}`

The area summary above plus `samples[]` and `provenance`:

```json
{
  "areaHash": "qqguw6", "sampleCount": 9, "settledCount": 9, "awaitingCount": 0,
  "avgLatencyMs": 29, "avgDownloadMbps": 87, "quality": 86, "lastUpdatedMs": 1789260000000,
  "cell": { … },
  "samples": [
    {
      "measurementRoot": "0xf346…12a0",
      "status": "SETTLED",
      "contributor": "0x5360…8c93",
      "timestamp": 1789259000,
      "latencyMs": 28, "downloadMbps": 91,
      "sourceTxHash": "0xbd72…7223",
      "creditcoinTxHash": "0x60d9…a2b5",
      "rewardAmountWei": "1000000000000000",
      "explorer": {
        "source": "https://sepolia.etherscan.io/tx/0xbd72…7223",
        "settlement": "https://creditcoin-testnet.blockscout.com/tx/0x60d9…a2b5"
      }
    }
  ],
  "provenance": { "registry": "0x32c0…", "settlement": "0x8F14…", "batchSettlement": "0x3B90…", "sepoliaChainId": 11155111, "creditcoinChainId": 102031 }
}
```

`status` is `SETTLED` or `AWAITING_ATTESTATION`; for the latter `creditcoinTxHash`, `rewardAmountWei` and `explorer.settlement` are `null`. Samples are newest first.

### `GET /v1/areas/{area}/brief`

`text/markdown`. A forwardable brief: what the cell is, what was measured, and a per-sample table of explorer links. The dashboard's **Area brief** button renders this endpoint.

### Exports

`export.csv` has one row per sample with the header `measurementRoot, status, contributor, timestamp, latencyMs, downloadMbps, quality, sourceTxHash, creditcoinTxHash, rewardWei` (CRLF line endings, `Content-Disposition: attachment`). `export.json` returns `{ area, generatedAt, cell, quality, sampleCount, settledCount, awaitingCount, avgLatencyMs, avgDownloadMbps, provenance, samples }` — the area view keyed for archiving.

### `GET /v1/areas/{area}/badge.svg`

An SVG badge (`image/svg+xml`) with the cell's quality score and colour, linking to the verifier. Free, so it can sit in a README or on an operator's status page.

### `GET /v1/verify/{hash}`

`{hash}` may be a measurement root, a Sepolia transaction hash or a Creditcoin transaction hash.

```json
{
  "generatedAt": "…",
  "found": true,
  "matchedBy": "sourceTxHash",
  "measurement": { "measurementRoot": "0x…", "areaHash": "qqguw6", "contributor": "0x…", "status": "SETTLED", "sourceTxHash": "0x…", "sourceBlockNumber": 11681452, "creditcoinTxHash": "0x…", "rewardAmount": "1000000000000000", "timestamp": 1789259000, "latencyMs": 28, "downloadMbps": 91 },
  "explorer": { "source": "https://sepolia.etherscan.io/tx/0x…", "settlement": "https://creditcoin-testnet.blockscout.com/tx/0x…" },
  "verifyUrl": "https://<host>/verify/0x…",
  "attestation": { "attestedHeight": 11681460, "sourceBlockNumber": 11681452, … },
  "proof": { "ok": true, "proof": { "attestedHeight": …, "merkle": { "root": "0x…", "siblingCount": 7, "siblings": [ … ] }, "continuity": { "lowerEndpointDigest": "0x…", "rootCount": 9, "roots": [ … ] }, "execute": { "selector": "0xc6339bf7", "calldata": "0x…", "gasLimit": "400000" }, "precompile": "0x0000000000000000000000000000000000000FD2" } }
}
```

Not found: `400 { "found": false, "reason": "MALFORMED" }` for a string that is not a 32-byte hex value, `404 { "found": false, "reason": "NOT_IN_SCANNED_WINDOW", "scannedFromBlock": { … } }` otherwise. Verification is never metered.

## tRPC gateway (`/api/trpc`)

Procedures under the `signalproof` router. Reads are `GET /api/trpc/signalproof.<name>?input=<urlencoded JSON>` with superjson (`{"json": {...}}`); the dashboard uses the typed client. All procedures are public.

| Procedure | Input | Returns |
|---|---|---|
| `submitMeasurement` (mutation) | the canonical payload plus `signature`, `contributorAddress` | The public projection of the stored row |
| `listMeasurements` | `{ limit? ≤ 100 }` | Latest gateway rows (public projection) |
| `getMeasurement` | `{ measurementRoot }` | One row |
| `proofQueue` | `{ limit? ≤ 100 }` | Rows not yet settled |
| `coverage` | `{ limit? ≤ 200 }` | Per-area aggregates from the store |
| `integrationStatus` | — | `{ missing[], relayerReady, proofWorkerReady, readOnly, settleMode, rateLimit }` |
| `contributorStats` | `{ address }` | Settled / awaiting / accrued for one address |
| `attestationProgress` | `{ sourceBlockNumber }` | Attested height vs the block, blocks and minutes to go |
| `rewardsFor` | `{ address }` | Accrued, claimable balance read from the settlement contracts |
| `proofFor` | `{ sourceTxHash }` | `{ ok: true, proof }` or `{ ok: false, code: "NOT_ATTESTED_YET" \| "PROOF_SERVICE_ERROR", detail }` |
| `onchain` | `{ force? }` | The full read-model snapshot |
| `ops` | — | Relayer balances, pool runway, worker and RPC health |
| `contributors` | — | Leaderboard rows |
| `area` | `{ areaHash }` | Area view plus trend series |
| `verify` | `{ hash }` | Same resolution as `/v1/verify` |

### Submission rejections

`submitMeasurement` refuses with a tRPC error whose `message` is one of:

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_TIMESTAMP`, `TIMESTAMP_IN_FUTURE`, `STALE_MEASUREMENT` | 400 | Not a 13-digit epoch ms; more than 60 s ahead; older than 15 min |
| `MEASUREMENT_ROOT_MISMATCH` | 400 | The root is not the hash of the payload it claims to commit to |
| `INVALID_CONTRIBUTOR_ADDRESS`, `SIGNATURE_MALFORMED`, `SIGNATURE_MISMATCH` | 400 | Bad checksum; unparsable signature; signer ≠ contributor |
| `RATE_LIMITED` | 429 | More than 3 per contributor per cell in 10 minutes |
| `DUPLICATE_MEASUREMENT_ROOT` | 409 | Already submitted |

## Measurement endpoints

The browser client measures against the same origin, which is what Resource Timing needs:

| Method | Path | Purpose |
|---|---|---|
| HEAD | `/api/net/ping` | `204`, `Cache-Control: no-store`; timed seven times for latency |
| GET | `/api/net/payload?bytes=3000000` | Incompressible bytes with `Content-Encoding: identity`, clamped to 8 MB, for throughput |
