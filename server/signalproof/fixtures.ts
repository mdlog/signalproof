import type { OnchainMeasurement, OnchainSnapshot } from "./chainRead";

/** Builders for a snapshot as the chain reader would produce it. Test-only. */
export function measurement(overrides: Partial<OnchainMeasurement>): OnchainMeasurement {
  return {
    measurementRoot: "0x" + "11".repeat(32),
    areaHash: "qqguw6",
    contributor: "0x5360000000000000000000000000000000008c93",
    status: "SETTLED",
    sourceTxHash: "0x" + "aa".repeat(32),
    sourceBlockNumber: 11_681_452,
    creditcoinTxHash: "0x" + "bb".repeat(32),
    rewardAmount: "1000000000000000",
    timestamp: 1_789_000_000,
    latencyMs: 28,
    downloadMbps: 91,
    ...overrides,
  };
}

export function snapshot(measurements: OnchainMeasurement[]): OnchainSnapshot {
  const areas = new Map<string, OnchainMeasurement[]>();
  for (const m of measurements) areas.set(m.areaHash, [...(areas.get(m.areaHash) ?? []), m]);
  return {
    configured: true,
    registryAddress: "0x32c0923cD58523864D2727FCaaB109783664c236",
    settlementAddress: "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584",
    batchSettlementAddress: "0x3B90e22f246bBa68f6de682b564c33b121D68C85",
    registryRelayer: "0x536029E76483F60438F9a7bF4Cc3B3EDCce68c93",
    sepoliaChainId: 11155111,
    creditcoinChainId: 102031,
    rewardAmount: "1000000000000000",
    poolBalance: "4997000000000000000",
    maxMeasurementAge: 86400,
    measurements,
    coverage: [...areas.entries()].map(([areaHash, rows]) => ({
      areaHash,
      sampleCount: rows.length,
      settledCount: rows.filter((r) => r.status === "SETTLED").length,
      avgLatencyMs: Math.round(rows.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / rows.length),
      avgDownloadMbps: Math.round(rows.reduce((a, r) => a + (r.downloadMbps ?? 0), 0) / rows.length),
      lastUpdatedMs: Math.max(...rows.map((r) => (r.timestamp ?? 0) * 1000)),
    })),
    totals: {
      submitted: measurements.length,
      settled: measurements.filter((m) => m.status === "SETTLED").length,
      awaiting: measurements.filter((m) => m.status !== "SETTLED").length,
      contributors: new Set(measurements.map((m) => m.contributor)).size,
      rewardsPaidWei: "0",
    },
    scannedFromBlock: { sepolia: 11658403, creditcoin: 5448580 },
    error: null,
  };
}
