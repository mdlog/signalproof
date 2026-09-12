/**
 * Deliverables for one area: a quality trend, CSV and JSON exports, and an embeddable badge.
 *
 * All derived from `areaView`, the same object the dashboard and the brief render, so a number a
 * buyer downloads is the number on screen. The exports are metered (they are the service); the
 * badge is free (it is marketing for the network, and it links back to the verifier).
 */

import { qualityScore } from "../../shared/quality";
import type { AreaSample, AreaView } from "./areas";

export type TrendPoint = { t: number; quality: number; latencyMs: number | null; downloadMbps: number | null };

/** One point per timestamped sample, oldest first. */
export function areaTrend(view: AreaView): TrendPoint[] {
  return view.samples
    .filter((s): s is AreaSample & { timestamp: number } => s.timestamp != null)
    .map((s) => ({ t: s.timestamp * 1000, quality: qualityScore(s.latencyMs, s.downloadMbps), latencyMs: s.latencyMs, downloadMbps: s.downloadMbps }))
    .sort((a, b) => a.t - b.t);
}

export const CSV_HEADER = [
  "measurementRoot",
  "status",
  "contributor",
  "timestamp",
  "latencyMs",
  "downloadMbps",
  "quality",
  "sourceTxHash",
  "creditcoinTxHash",
  "rewardWei",
] as const;

function csvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180: CRLF line ends, quoting only where needed, empty for null. */
export function areaCsv(view: AreaView): string {
  const rows = view.samples.map((s) =>
    [
      s.measurementRoot,
      s.status,
      s.contributor,
      s.timestamp == null ? null : new Date(s.timestamp * 1000).toISOString(),
      s.latencyMs,
      s.downloadMbps,
      qualityScore(s.latencyMs, s.downloadMbps),
      s.sourceTxHash,
      s.creditcoinTxHash,
      s.rewardAmountWei,
    ]
      .map(csvField)
      .join(","),
  );
  return [CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

export function areaJson(view: AreaView, generatedAt: Date) {
  return {
    area: view.areaHash,
    generatedAt: generatedAt.toISOString(),
    cell: view.cell,
    quality: view.quality,
    sampleCount: view.sampleCount,
    settledCount: view.settledCount,
    awaitingCount: view.awaitingCount,
    avgLatencyMs: view.avgLatencyMs,
    avgDownloadMbps: view.avgDownloadMbps,
    provenance: view.provenance,
    samples: view.samples,
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Same thresholds as the map: strong ≥ 80, watch ≥ 60, attention below. */
export function badgeColor(quality: number | null): string {
  if (quality == null) return "#8EA0AC";
  if (quality >= 80) return "#31B7A6";
  if (quality >= 60) return "#F4B95E";
  return "#F06A59";
}

/** A 20 px shields-style badge: "SignalProof · <area>" | "quality <q> · <n> samples · verified on Creditcoin". */
export function badgeSvg(args: { area: string; quality: number | null; samples: number }): string {
  const left = `SignalProof · ${args.area}`;
  const right =
    args.quality == null
      ? "no data"
      : `quality ${args.quality} · ${args.samples} sample${args.samples === 1 ? "" : "s"} · verified on Creditcoin`;
  const color = badgeColor(args.quality);
  // ~6.2 px per character at 11 px Verdana, plus padding — close enough for a badge.
  const lw = Math.round(left.length * 6.2 + 14);
  const rw = Math.round(right.length * 6.2 + 14);
  const w = lw + rw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${escapeXml(left)}: ${escapeXml(right)}">` +
    `<title>${escapeXml(left)}: ${escapeXml(right)}</title>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#102A43"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${escapeXml(left)}</text>` +
    `<text x="${lw + rw / 2}" y="14" fill="${args.quality != null && args.quality >= 60 ? "#102A43" : "#fff"}">${escapeXml(right)}</text>` +
    `</g></svg>`
  );
}
