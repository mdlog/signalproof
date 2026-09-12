/**
 * Auto-measure schedule — pure, so it can be tested without a browser.
 *
 * Ten minutes between cycles sits under the gateway's stated policy of 3 measurements per
 * contributor per cell per 10 minutes, and matches how often a connectivity sample is worth
 * anything. Each cycle still asks the wallet to sign: the registry recovers the contributor's
 * signature on-chain, so there is no silent path — and that is the point, not a limitation.
 */

export const AUTO_MEASURE_INTERVAL_MS = 600_000;

/** A reading not signed within this is discarded; the gateway's freshness window is 15 minutes. */
export const SIGN_DEADLINE_MS = 14 * 60_000;

export type CycleLog = {
  at: number;
  area: string | null;
  result: "submitted" | "skipped" | "rejected";
  reason: string | null;
};

/** Milliseconds until the next cycle is due; 0 when it is due now. */
export function msUntilNextRun(lastRunAt: number | null, now: number, interval = AUTO_MEASURE_INTERVAL_MS): number {
  if (lastRunAt == null) return 0;
  return Math.max(0, lastRunAt + interval - now);
}

/** Newest first, bounded. */
export function appendLog(log: CycleLog[], entry: CycleLog, max = 50): CycleLog[] {
  return [entry, ...log].slice(0, max);
}
