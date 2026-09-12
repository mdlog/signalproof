/**
 * Buyer API v1 — read-only views of one geohash cell, derived from the on-chain snapshot.
 *
 * This is the product surface an operator, venue or public programme would query: an area's
 * aggregate quality, and every sample behind it with the transactions that prove it. Nothing is
 * served that the two chains do not already agree on, and nothing session-binding (signature,
 * nonce, sessionHash) exists in the snapshot to leak. Per-area views are metered by a key bought with
 * CTC that funds the reward pool (`access.ts`); no retention policy yet — README says so.
 */

import { decodeGeohash, decodeGeohashBounds, geohashCellSize, type GeoBounds } from "../../shared/geohash";
import { qualityScore } from "../../shared/quality";
import type { OnchainMeasurement, OnchainSnapshot } from "./chainRead";
import { verifyUrlFor } from "./verify";

const SEPOLIA_TX = "https://sepolia.etherscan.io/tx/";
const CC3_TX = "https://creditcoin-testnet.blockscout.com/tx/";

export type AreaSample = {
  measurementRoot: string;
  status: OnchainMeasurement["status"];
  contributor: string;
  timestamp: number | null;
  latencyMs: number | null;
  downloadMbps: number | null;
  sourceTxHash: string | null;
  creditcoinTxHash: string | null;
  rewardAmountWei: string | null;
  explorer: { source: string | null; settlement: string | null };
  /** The public verifier page for this sample: any of its hashes resolves there. */
  verifyUrl: string;
};

export type AreaCell = {
  center: { lat: number; lon: number };
  bounds: GeoBounds;
  widthM: number;
  heightM: number;
};

export type AreaSummary = {
  areaHash: string;
  cell: AreaCell | null;
  sampleCount: number;
  settledCount: number;
  awaitingCount: number;
  avgLatencyMs: number | null;
  avgDownloadMbps: number | null;
  quality: number;
  lastUpdatedMs: number | null;
};

export type AreaView = AreaSummary & {
  samples: AreaSample[];
  provenance: {
    registry: string;
    settlement: string;
    batchSettlement: string;
    sepoliaChainId: number;
    creditcoinChainId: number;
  };
};

function cellFor(areaHash: string): AreaCell | null {
  const center = decodeGeohash(areaHash);
  const bounds = decodeGeohashBounds(areaHash);
  const size = geohashCellSize(areaHash);
  if (!center || !bounds || !size) return null;
  return { center, bounds, widthM: size.widthM, heightM: size.heightM };
}

function average(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

function summarize(areaHash: string, rows: OnchainMeasurement[]): AreaSummary {
  const avgLatencyMs = average(rows.map((r) => r.latencyMs));
  const avgDownloadMbps = average(rows.map((r) => r.downloadMbps));
  const stamps = rows.map((r) => r.timestamp).filter((t): t is number => t != null);
  const settledCount = rows.filter((r) => r.status === "SETTLED").length;
  return {
    areaHash,
    cell: cellFor(areaHash),
    sampleCount: rows.length,
    settledCount,
    awaitingCount: rows.length - settledCount,
    avgLatencyMs,
    avgDownloadMbps,
    quality: qualityScore(avgLatencyMs, avgDownloadMbps),
    lastUpdatedMs: stamps.length ? Math.max(...stamps) * 1000 : null,
  };
}

/** Every measured cell, most samples first. */
export function listAreas(snapshot: OnchainSnapshot): AreaSummary[] {
  const byArea = new Map<string, OnchainMeasurement[]>();
  for (const m of snapshot.measurements) {
    byArea.set(m.areaHash, [...(byArea.get(m.areaHash) ?? []), m]);
  }
  return [...byArea.entries()]
    .map(([areaHash, rows]) => summarize(areaHash, rows))
    .sort((a, b) => b.sampleCount - a.sampleCount);
}

/** One cell with every sample and its provenance, or null when nobody has measured it. */
export function areaView(snapshot: OnchainSnapshot, areaHash: string): AreaView | null {
  const rows = snapshot.measurements.filter((m) => m.areaHash === areaHash);
  if (rows.length === 0) return null;

  const samples: AreaSample[] = [...rows]
    .sort((a, b) => (b.sourceBlockNumber ?? 0) - (a.sourceBlockNumber ?? 0))
    .map((m) => ({
      measurementRoot: m.measurementRoot,
      status: m.status,
      contributor: m.contributor,
      timestamp: m.timestamp,
      latencyMs: m.latencyMs,
      downloadMbps: m.downloadMbps,
      sourceTxHash: m.sourceTxHash,
      creditcoinTxHash: m.creditcoinTxHash,
      rewardAmountWei: m.rewardAmount,
      explorer: {
        source: m.sourceTxHash ? SEPOLIA_TX + m.sourceTxHash : null,
        settlement: m.creditcoinTxHash ? CC3_TX + m.creditcoinTxHash : null,
      },
      verifyUrl: verifyUrlFor(m.measurementRoot),
    }));

  return {
    ...summarize(areaHash, rows),
    samples,
    provenance: {
      registry: snapshot.registryAddress,
      settlement: snapshot.settlementAddress,
      batchSettlement: snapshot.batchSettlementAddress,
      sepoliaChainId: snapshot.sepoliaChainId,
      creditcoinChainId: snapshot.creditcoinChainId,
    },
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** A markdown brief a buyer can forward: what the cell is, what was measured, and how to verify it. */
export function buildAreaBrief(view: AreaView, generatedAt: Date): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const cellLine = view.cell
    ? `a geohash cell of about ${fmt(view.cell.widthM)} m × ${fmt(view.cell.heightM)} m centred on ${view.cell.center.lat.toFixed(4)}, ${view.cell.center.lon.toFixed(4)}`
    : "an area whose label is not a geohash, so it cannot be placed on a map";
  const lines = [
    `# Area brief — ${view.areaHash}`,
    "",
    `Generated ${day} from on-chain state. Every number below is a join of MeasurementSubmitted on Ethereum Sepolia (registry ${view.provenance.registry}) with MeasurementVerified on Creditcoin CC3 Testnet (settlement ${view.provenance.settlement}). No database, no self-reported figures.`,
    "",
    "## The area",
    "",
    `\`${view.areaHash}\` is ${cellLine}. Contributors are somewhere inside that cell — no precise coordinate was ever transmitted.`,
    "",
    "## What was measured",
    "",
    `- ${view.sampleCount} measurement${view.sampleCount === 1 ? "" : "s"}: ${view.settledCount} settled on Creditcoin, ${view.awaitingCount} awaiting attestation`,
    `- Average latency: ${view.avgLatencyMs == null ? "—" : `${view.avgLatencyMs} ms`}`,
    `- Average download: ${view.avgDownloadMbps == null ? "—" : `${view.avgDownloadMbps} Mbps`}`,
    `- Quality score: ${view.quality} / 100 (50 % latency penalty up to 200 ms, 50 % throughput credit up to 100 Mbps)`,
    `- Last measurement: ${view.lastUpdatedMs ? new Date(view.lastUpdatedMs).toISOString() : "—"}`,
    "",
    "## How to verify each sample",
    "",
    "| Status | Latency | Download | Source commitment (Sepolia) | Settlement (Creditcoin) |",
    "|---|---|---|---|---|",
    ...view.samples.map(
      (s) =>
        `| ${s.status === "SETTLED" ? "settled" : "awaiting attestation"} | ${s.latencyMs ?? "—"} ms | ${s.downloadMbps ?? "—"} Mbps | ${s.explorer.source ?? "—"} | ${s.explorer.settlement ?? "—"} |`,
    ),
    "",
    "A settled row was proven by the Attestcoin Protocol: the BlockProver precompile verified that the Sepolia transaction was included in an attested block, and the settlement contract checked the receipt status, the emitting contract and the contributor's signature before paying.",
    "",
    "## Not included",
    "",
    "No identities beyond reward addresses, no device trails, no raw coordinates. A retention policy is not implemented yet.",
  ];
  return lines.join("\n");
}
