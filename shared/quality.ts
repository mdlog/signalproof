/**
 * Collapse latency and throughput into a single 0-100 quality score.
 *
 * Deliberately simple and stated openly rather than tuned to flatter the data: latency contributes
 * a linear penalty up to 200 ms, throughput a linear credit up to 100 Mbps, weighted evenly. The
 * dashboard and the buyer API share this one definition so a number on screen and a number in the
 * JSON can never disagree.
 */
export function qualityScore(latencyMs: number | null, downloadMbps: number | null): number {
  const lat = latencyMs == null ? 50 : Math.max(0, 100 - latencyMs / 2);
  const dl = downloadMbps == null ? 50 : Math.min(100, downloadMbps);
  return Math.round(Math.max(0, Math.min(100, lat * 0.5 + dl * 0.5)));
}
