import { describe, expect, it } from "vitest";
import { AUTO_MEASURE_INTERVAL_MS, appendLog, msUntilNextRun, type CycleLog } from "./autoMeasure";

/**
 * The auto-measure loop is a timer around the same runTest the button calls. The only logic worth
 * a test is the schedule: when the next cycle is due, and how the local log is bounded.
 */

describe("msUntilNextRun", () => {
  it("is due immediately when nothing has run", () => {
    expect(msUntilNextRun(null, 100)).toBe(0);
  });
  it("counts down from the last run and never goes negative", () => {
    expect(msUntilNextRun(1_000, 2_000)).toBe(AUTO_MEASURE_INTERVAL_MS - 1_000);
    expect(msUntilNextRun(1_000, 1_000 + AUTO_MEASURE_INTERVAL_MS)).toBe(0);
    expect(msUntilNextRun(1_000, 1_000 + AUTO_MEASURE_INTERVAL_MS + 5)).toBe(0);
  });
  it("respects a custom interval", () => {
    expect(msUntilNextRun(0, 400, 1_000)).toBe(600);
  });
});

describe("appendLog", () => {
  const entry = (at: number): CycleLog => ({ at, area: "qqguw6", result: "submitted", reason: null });
  it("keeps the newest entries first and caps the length", () => {
    let log: CycleLog[] = [];
    for (let i = 1; i <= 5; i++) log = appendLog(log, entry(i), 3);
    expect(log.map((e) => e.at)).toEqual([5, 4, 3]);
  });
});
