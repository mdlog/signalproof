import { describe, expect, it } from "vitest";
import { poolRunway } from "./ops";
import { workerHealth } from "./proofWorker";
import { snapshotHealth } from "./chainRead";

/**
 * The ops panel answers the questions an operator asks at 2 a.m.: can the relayers still pay
 * gas, how many settlements can the pool still fund, is the worker alive, are the RPCs honest.
 * The arithmetic is tested here; the live probes are per-row try/catch and never throw.
 */

describe("poolRunway", () => {
  it("is the whole number of settlements the pool can still pay", () => {
    expect(poolRunway(5n * 10n ** 18n, 10n ** 15n)).toBe(5000);
    expect(poolRunway(1_999n, 1_000n)).toBe(1);
    expect(poolRunway(0n, 1_000n)).toBe(0);
  });
  it("is null when the reward is zero — nothing to divide by, nothing to promise", () => {
    expect(poolRunway(1n, 0n)).toBeNull();
  });
});

describe("health records", () => {
  it("start honest: nothing has ticked, nothing has been read", () => {
    expect(workerHealth).toMatchObject({ running: false, lastTickAt: null, lastResult: null, lastError: null, consecutiveFailures: 0 });
    expect(snapshotHealth).toMatchObject({ lastSuccessAt: null, lastError: null, emptyResultsRejected: 0 });
  });
});
