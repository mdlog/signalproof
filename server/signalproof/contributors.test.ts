import { describe, expect, it } from "vitest";
import { listContributors } from "./contributors";
import { measurement, snapshot } from "./fixtures";

/**
 * The leaderboard is a grouping of the same on-chain join the dashboard renders: one row per
 * contributor address, ranked by settled measurements. Rewards are summed over settled rows only,
 * because an awaiting measurement has accrued nothing yet.
 */

const A = "0xAaaa000000000000000000000000000000000001";
const B = "0xBbbb000000000000000000000000000000000002";

describe("listContributors", () => {
  it("groups by address (case-insensitively), ranks by settled, then by last seen", () => {
    const rows = listContributors(
      snapshot([
        measurement({ measurementRoot: "0x" + "01".repeat(32), contributor: A, areaHash: "qqguw6", timestamp: 100, rewardAmount: "1000" }),
        measurement({ measurementRoot: "0x" + "02".repeat(32), contributor: A.toLowerCase(), areaHash: "qqguyg", timestamp: 300, rewardAmount: "1000" }),
        measurement({ measurementRoot: "0x" + "03".repeat(32), contributor: A, areaHash: "qqguw6", timestamp: 200, status: "AWAITING_ATTESTATION", creditcoinTxHash: null, rewardAmount: null }),
        measurement({ measurementRoot: "0x" + "04".repeat(32), contributor: B, areaHash: "qqguw6", timestamp: 400, rewardAmount: "1000" }),
      ]),
    );
    expect(rows.map((r) => [r.rank, r.address, r.settled, r.awaiting, r.submitted])).toEqual([
      [1, A, 2, 1, 3],
      [2, B, 1, 0, 1],
    ]);
    expect(rows[0].areas).toEqual(["qqguw6", "qqguyg"]);
    expect(rows[0].rewardAccruedWei).toBe("2000");
    expect(rows[0].firstSeen).toBe(100);
    expect(rows[0].lastSeen).toBe(300);
  });

  it("breaks a tie on settled by the most recent activity", () => {
    const rows = listContributors(
      snapshot([
        measurement({ measurementRoot: "0x" + "01".repeat(32), contributor: A, timestamp: 100 }),
        measurement({ measurementRoot: "0x" + "02".repeat(32), contributor: B, timestamp: 900 }),
      ]),
    );
    expect(rows.map((r) => r.address)).toEqual([B, A]);
  });

  it("is empty for an empty snapshot", () => {
    expect(listContributors(snapshot([]))).toEqual([]);
  });
});
