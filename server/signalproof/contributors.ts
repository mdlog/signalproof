/**
 * Contributors — the network, as the chain sees it.
 *
 * One row per reward address, derived from the same Sepolia/Creditcoin join the dashboard uses.
 * "Settled" is what pays; "awaiting" is committed but not yet proven; the reward sum is over
 * settled rows only. Ranking is by settled measurements, then recency, then address, so the order
 * is deterministic for equal work.
 */

import type { OnchainSnapshot } from "./chainRead";

export type ContributorRow = {
  rank: number;
  /** Checksum-cased as first seen on chain. */
  address: string;
  submitted: number;
  settled: number;
  awaiting: number;
  areas: string[];
  rewardAccruedWei: string;
  firstSeen: number | null;
  lastSeen: number | null;
};

export function listContributors(snapshot: OnchainSnapshot): ContributorRow[] {
  const byAddress = new Map<string, Omit<ContributorRow, "rank"> & { reward: bigint; areaSet: Set<string> }>();

  for (const m of snapshot.measurements) {
    const key = m.contributor.toLowerCase();
    let row = byAddress.get(key);
    if (!row) {
      row = { address: m.contributor, submitted: 0, settled: 0, awaiting: 0, areas: [], rewardAccruedWei: "0", firstSeen: null, lastSeen: null, reward: 0n, areaSet: new Set() };
      byAddress.set(key, row);
    }
    row.submitted += 1;
    if (m.status === "SETTLED") {
      row.settled += 1;
      if (m.rewardAmount) row.reward += BigInt(m.rewardAmount);
    } else {
      row.awaiting += 1;
    }
    row.areaSet.add(m.areaHash);
    if (m.timestamp != null) {
      row.firstSeen = row.firstSeen == null ? m.timestamp : Math.min(row.firstSeen, m.timestamp);
      row.lastSeen = row.lastSeen == null ? m.timestamp : Math.max(row.lastSeen, m.timestamp);
    }
  }

  return [...byAddress.values()]
    .sort(
      (a, b) =>
        b.settled - a.settled ||
        (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
        a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    )
    .map((row, i) => ({
      rank: i + 1,
      address: row.address,
      submitted: row.submitted,
      settled: row.settled,
      awaiting: row.awaiting,
      areas: [...row.areaSet].sort(),
      rewardAccruedWei: row.reward.toString(),
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    }));
}
