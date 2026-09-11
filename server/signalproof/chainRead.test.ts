import { describe, expect, it } from "vitest";
import { decodeAreaHash } from "./chainRead";
import { toBytes32 } from "./relayer";

describe("decodeAreaHash", () => {
  it("round-trips a label written by toBytes32", () => {
    // toBytes32 uses zeroPadValue, which pads on the LEFT. This is the exact value the deployed
    // registry emitted for the first real settlement, and it was NOT decoding before this test.
    expect(decodeAreaHash(toBytes32("a9c-46"))).toBe("a9c-46");
    expect(
      decodeAreaHash("0x00000000000000000000000000000000000000000000000000006139632d3436"),
    ).toBe("a9c-46");
  });

  it("also handles right-padded labels, the formatBytes32String convention", () => {
    const rightPadded = "0x" + Buffer.from("zone-7").toString("hex").padEnd(64, "0");
    expect(decodeAreaHash(rightPadded)).toBe("zone-7");
  });

  it("round-trips every label shape the gateway accepts", () => {
    for (const label of ["a9c-46", "zone-7", "South Campus", "x", "a".repeat(32)]) {
      expect(decodeAreaHash(toBytes32(label))).toBe(label);
    }
  });

  it("leaves an opaque digest as hex rather than inventing text", () => {
    const digest = "0x356dcce423ba1a5111d3fc0ab1226ae2ed0ebbcfcf2cf15af3e2401e0223f7a8";
    expect(decodeAreaHash(digest)).toBe(digest);
  });

  it("does not choke on malformed input", () => {
    expect(decodeAreaHash("0x")).toBe("0x");
    expect(decodeAreaHash("not-hex")).toBe("not-hex");
    expect(decodeAreaHash("0x1234")).toBe("0x1234");
  });

  it("never returns a string containing control characters", () => {
    const withControl = "0x" + "01".repeat(32);
    expect(decodeAreaHash(withControl)).toBe(withControl);
  });
});

/**
 * A public Sepolia endpoint answered the same `eth_getLogs` with 0 logs on 4 of 8 identical
 * calls — no error, just an empty array — and every empty answer flipped the dashboard into
 * "Prototype mode". These tests pin the two defences: re-ask an empty range, and never let a
 * re-read shrink a snapshot, because logs on an append-only chain cannot disappear.
 */
import { reconcileSnapshot, scanLogs, type OnchainSnapshot } from "./chainRead";

type FakeLog = { blockNumber: number };
type Range = { fromBlock: number; toBlock: number };

/** A log source scripted with one answer per call, recording every range it was asked for. */
function scriptedSource(answers: Array<FakeLog[] | Error>) {
  const asked: Range[] = [];
  return {
    asked,
    async getLogs(filter: Range) {
      asked.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
      const next = answers.shift();
      if (next === undefined) throw new Error("scripted source ran out of answers");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe("scanLogs", () => {
  it("re-asks a range that came back empty and keeps the logs from the retry", async () => {
    const source = scriptedSource([[], [{ blockNumber: 105 }]]);

    const logs = await scanLogs(source, "0xregistry", "0xtopic", 100, 110);

    expect(logs).toEqual([{ blockNumber: 105 }]);
    expect(source.asked).toEqual([
      { fromBlock: 100, toBlock: 110 },
      { fromBlock: 100, toBlock: 110 },
    ]);
  });

  it("gives up on a genuinely empty range after a bounded number of attempts", async () => {
    const source = scriptedSource([[], [], [], [], []]);

    const logs = await scanLogs(source, "0xregistry", "0xtopic", 100, 110);

    expect(logs).toEqual([]);
    expect(source.asked.length).toBeGreaterThanOrEqual(2);
    expect(source.asked.length).toBeLessThanOrEqual(3);
  });

  it("still halves the span when the RPC rejects the range", async () => {
    // First call spans the whole range and is rejected; the halves are accepted.
    const source = scriptedSource([
      new Error("ranges over 10000 blocks are not supported"),
      [{ blockNumber: 1 }],
      [{ blockNumber: 30_000 }],
    ]);

    const logs = await scanLogs(source, "0xregistry", "0xtopic", 0, 39_999);

    expect(logs).toEqual([{ blockNumber: 1 }, { blockNumber: 30_000 }]);
    expect(source.asked[0]).toEqual({ fromBlock: 0, toBlock: 39_999 });
    expect(source.asked[1]).toEqual({ fromBlock: 0, toBlock: 19_999 });
    expect(source.asked[2]).toEqual({ fromBlock: 20_000, toBlock: 39_999 });
  });
});

function snapshot(overrides: Partial<OnchainSnapshot> = {}): OnchainSnapshot {
  return {
    configured: true,
    registryAddress: "0xregistry",
    settlementAddress: "0xsettlement",
    batchSettlementAddress: "0xbatch",
    registryRelayer: "0xrelayer",
    sepoliaChainId: 11155111,
    creditcoinChainId: 102031,
    rewardAmount: "1000000000000000",
    poolBalance: "4997000000000000000",
    maxMeasurementAge: 86400,
    measurements: [],
    coverage: [],
    totals: { submitted: 0, settled: 0, awaiting: 0, contributors: 0, rewardsPaidWei: "0" },
    scannedFromBlock: { sepolia: 11658403, creditcoin: 5448580 },
    error: null,
    ...overrides,
  };
}

describe("reconcileSnapshot", () => {
  const seven = snapshot({ totals: { submitted: 7, settled: 6, awaiting: 1, contributors: 2, rewardsPaidWei: "6000000000000000" } });

  it("keeps the previous snapshot when a re-read reports fewer measurements for the same scan", () => {
    const empty = snapshot();
    expect(reconcileSnapshot(seven, empty)).toBe(seven);
  });

  it("keeps the previous snapshot when a re-read reports fewer settlements", () => {
    const fewerSettled = snapshot({ totals: { ...seven.totals, settled: 2, awaiting: 5 } });
    expect(reconcileSnapshot(seven, fewerSettled)).toBe(seven);
  });

  it("accepts a re-read that reports more measurements", () => {
    const eight = snapshot({ totals: { ...seven.totals, submitted: 8, awaiting: 2 } });
    expect(reconcileSnapshot(seven, eight)).toBe(eight);
  });

  it("accepts an empty read after the registry address changes", () => {
    const redeployed = snapshot({ registryAddress: "0xnewregistry", scannedFromBlock: { sepolia: 11700000, creditcoin: 5448580 } });
    expect(reconcileSnapshot(seven, redeployed)).toBe(redeployed);
  });

  it("keeps the previous snapshot when the re-read failed outright", () => {
    const failed = snapshot({ configured: false, error: "could not coalesce error" });
    expect(reconcileSnapshot(seven, failed)).toBe(seven);
  });

  it("takes the fresh read when there is nothing to compare against", () => {
    const first = snapshot();
    expect(reconcileSnapshot(null, first)).toBe(first);
  });
});
