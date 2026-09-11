import { describe, expect, it } from "vitest";
import { MEASUREMENT_RATE_LIMIT, createRateLimiter } from "./rateLimit";

/**
 * A stated anti-spam policy, not a Sybil defence: one contributor may record at most
 * MEASUREMENT_RATE_LIMIT.max measurements per geohash cell per window. In-process, so it resets on
 * restart — README says so.
 */
describe("measurement rate limiter", () => {
  const key = { contributor: "0xABC", areaHash: "qqguw6" };

  it("allows 3 measurements per contributor per cell in 10 minutes and refuses the 4th", () => {
    const limit = createRateLimiter({ max: 3, windowMs: 600_000 });
    expect(limit.check(key, 0).ok).toBe(true);
    expect(limit.check(key, 1_000).ok).toBe(true);
    expect(limit.check(key, 2_000).ok).toBe(true);
    const fourth = limit.check(key, 3_000);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.retryAfterMs).toBe(597_000);
  });

  it("forgets attempts older than the window", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1_000 });
    expect(limit.check(key, 0).ok).toBe(true);
    expect(limit.check(key, 999).ok).toBe(false);
    expect(limit.check(key, 1_001).ok).toBe(true);
  });

  it("keeps cells and contributors separate, and ignores address casing", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1_000 });
    expect(limit.check({ contributor: "0xabc", areaHash: "a" }, 0).ok).toBe(true);
    expect(limit.check({ contributor: "0xABC", areaHash: "a" }, 0).ok).toBe(false);
    expect(limit.check({ contributor: "0xabc", areaHash: "b" }, 0).ok).toBe(true);
    expect(limit.check({ contributor: "0xdef", areaHash: "a" }, 0).ok).toBe(true);
  });

  it("does not count a refused attempt against the caller", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1_000 });
    limit.check(key, 0);
    limit.check(key, 100); // refused
    limit.check(key, 200); // refused
    // The window is measured from the one accepted attempt, not from the refusals.
    expect(limit.check(key, 1_001).ok).toBe(true);
  });

  it("ships with the policy the README states", () => {
    expect(MEASUREMENT_RATE_LIMIT).toEqual({ max: 3, windowMs: 600_000 });
  });
});
