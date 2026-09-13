# Introduction

SignalProof turns a phone's network measurement into a claim that a smart contract on Creditcoin can check without trusting anyone in the middle.

A contributor's browser measures latency, throughput, network class and a coarse area. The measurement is committed as a hash on **Ethereum Sepolia**, proven to exist there by the **Attestcoin Protocol**, and settled on **Creditcoin CC3 Testnet**, where a contract verifies the cross-chain proof and accrues a reward to the contributor. Operators, venues and public programmes can then query verified coverage per area, with every number traceable to the two transactions that proved it.

```
phone ──► gateway ──► SourceBatchRegistry ──► Attestcoin ──► SignalProofSettlement ──► reward
          (tRPC)      Ethereum Sepolia        proof          Creditcoin CC3            claim()
                      11155111                ~8 min         102031
```

## Who this is for

| Reader | Start with |
|---|---|
| Someone running or judging the demo | [Quickstart](quickstart.md), then the [Concepts](concepts.md) page |
| A developer integrating the buyer API | [API reference](api.md) |
| A protocol engineer reviewing the Attestcoin integration | [Attestcoin integration](attestcoin.md) and [Smart contracts](contracts.md) |
| A security reviewer | [Security model](security.md) |
| Whoever operates a deployment | [Operations](operations.md) |

## What is real

Everything the dashboard shows is derived from chain state: the read model is a join of `MeasurementSubmitted` events on Sepolia with `MeasurementVerified` events on Creditcoin. There is no fixture data and no database is required to run the dashboard. Measurements are taken in the browser with timed requests, not read from `navigator.connection` estimates. The contracts are deployed and verified on both testnets, and the transaction hashes in these docs open on public explorers.

## Status

This is a hackathon build for **BUIDL CTC 2026 Fall** (DePIN track), deployed on testnets. It is not audited and not on mainnet. The [Security model](security.md) page lists what is known to be incomplete, and the [Changelog](changelog.md) records what shipped when.

## Where things live

| Path | What |
|---|---|
| `contracts/` | Foundry project: source registry, settlement contracts, tests |
| `server/signalproof/` | Relayer, proof worker, on-chain read model, buyer API |
| `server/routers.ts` | tRPC gateway |
| `client/` | React dashboard (Vite, PWA) |
| `shared/` | Code shared by client and server: measurement canonicalisation, geohash, quality score |
| `docs/` | Architecture, submission material, and the source of these pages (`docs/site/`) |
