import { describe, expect, it } from "vitest";
import { areaView, buildAreaBrief, listAreas } from "./areas";
import { measurement, snapshot } from "./fixtures";
import type { OnchainMeasurement } from "./chainRead";

const twoInSudirman = snapshot([
  measurement({ measurementRoot: "0x" + "01".repeat(32), latencyMs: 20, downloadMbps: 80 }),
  measurement({
    measurementRoot: "0x" + "02".repeat(32),
    status: "AWAITING_ATTESTATION",
    creditcoinTxHash: null,
    rewardAmount: null,
    latencyMs: 40,
    downloadMbps: 60,
    timestamp: 1_789_000_600,
  }),
  measurement({ measurementRoot: "0x" + "03".repeat(32), areaHash: "qqguyg", latencyMs: 90, downloadMbps: 10 }),
]);

/**
 * The buyer API is a read-only view of the on-chain snapshot: what an operator, venue or public
 * programme can query for one geohash cell, with every sample carrying the transactions that
 * prove it. Nothing here is served that the chains do not already agree on.
 */

describe("areaView", () => {
  it("aggregates one cell and carries each sample's provenance", () => {
    const view = areaView(twoInSudirman, "qqguw6");
    expect(view).not.toBeNull();
    expect(view!.sampleCount).toBe(2);
    expect(view!.settledCount).toBe(1);
    expect(view!.awaitingCount).toBe(1);
    expect(view!.avgLatencyMs).toBe(30);
    expect(view!.avgDownloadMbps).toBe(70);
    expect(view!.lastUpdatedMs).toBe(1_789_000_600_000);
    expect(view!.samples.map((s) => s.status)).toEqual(["SETTLED", "AWAITING_ATTESTATION"]);
    expect(view!.samples[0].explorer.source).toBe(
      "https://sepolia.etherscan.io/tx/0x" + "aa".repeat(32),
    );
    expect(view!.samples[0].explorer.settlement).toBe(
      "https://creditcoin-testnet.blockscout.com/tx/0x" + "bb".repeat(32),
    );
    expect(view!.samples[1].explorer.settlement).toBeNull();
  });

  it("decodes the geohash into the cell the claim actually covers", () => {
    const view = areaView(twoInSudirman, "qqguw6")!;
    expect(view.cell).not.toBeNull();
    expect(view.cell!.center.lat).toBeCloseTo(-6.2265, 3);
    expect(view.cell!.center.lon).toBeCloseTo(106.8036, 3);
    expect(view.cell!.widthM).toBeGreaterThan(1000);
    expect(view.cell!.heightM).toBeGreaterThan(500);
  });

  it("names the contracts the data was read from", () => {
    const view = areaView(twoInSudirman, "qqguw6")!;
    expect(view.provenance).toEqual({
      registry: "0x32c0923cD58523864D2727FCaaB109783664c236",
      settlement: "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584",
      batchSettlement: "0x3B90e22f246bBa68f6de682b564c33b121D68C85",
      sepoliaChainId: 11155111,
      creditcoinChainId: 102031,
    });
  });

  it("returns null for a cell nobody has measured", () => {
    expect(areaView(twoInSudirman, "zzzzzz")).toBeNull();
  });

  it("never leaks a session hash, nonce or signature", () => {
    const json = JSON.stringify(areaView(twoInSudirman, "qqguw6"));
    expect(json).not.toMatch(/sessionHash|nonce|signature/);
  });
});

describe("listAreas", () => {
  it("lists every measured cell, most samples first", () => {
    const areas = listAreas(twoInSudirman);
    expect(areas.map((a) => a.areaHash)).toEqual(["qqguw6", "qqguyg"]);
    expect(areas[0].sampleCount).toBe(2);
    expect(areas[0].quality).toBeGreaterThan(areas[1].quality);
  });
});

describe("buildAreaBrief", () => {
  it("writes a brief a buyer can forward, with the cell size, counts and every settlement", () => {
    const brief = buildAreaBrief(areaView(twoInSudirman, "qqguw6")!, new Date("2026-09-11T12:00:00Z"));
    expect(brief).toContain("# Area brief — qqguw6");
    expect(brief).toContain("1 settled on Creditcoin");
    expect(brief).toContain("1 awaiting attestation");
    expect(brief).toMatch(/cell of about 1,2\d\d m × 6\d\d m/);
    expect(brief).toContain("https://creditcoin-testnet.blockscout.com/tx/0x" + "bb".repeat(32));
    expect(brief).toContain("2026-09-11");
    // Prose may say "signature"; no session-binding VALUE may appear.
    expect(brief).not.toMatch(/sessionHash|nonce|0x[0-9a-f]{130}/i);
  });
});
