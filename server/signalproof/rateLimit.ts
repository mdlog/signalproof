/**
 * Per-contributor, per-cell measurement rate limit.
 *
 * A stated anti-spam policy, not a Sybil defence: it caps how fast one address can fill one
 * geohash cell, which is the cheapest way to inflate an area's sample count. It lives in process
 * memory and resets on restart — good enough for a policy the README can state plainly, and
 * nothing more is claimed for it. Stake-weighted rewards and device attestation are the real
 * answer and are listed under known limitations.
 */

export type RateLimitKey = { contributor: string; areaHash: string };

export type RateLimitVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export type RateLimitPolicy = { max: number; windowMs: number };

/** Three measurements per contributor per cell per ten minutes. */
export const MEASUREMENT_RATE_LIMIT: RateLimitPolicy = { max: 3, windowMs: 600_000 };

export function createRateLimiter(policy: RateLimitPolicy) {
  const accepted = new Map<string, number[]>();

  return {
    /** Record `nowMs` as an attempt if the policy allows it; refused attempts are not counted. */
    check(key: RateLimitKey, nowMs: number): RateLimitVerdict {
      const id = `${key.contributor.toLowerCase()}:${key.areaHash}`;
      const recent = (accepted.get(id) ?? []).filter((t) => nowMs - t < policy.windowMs);

      if (recent.length >= policy.max) {
        const oldest = Math.min(...recent);
        accepted.set(id, recent);
        return { ok: false, retryAfterMs: oldest + policy.windowMs - nowMs };
      }

      recent.push(nowMs);
      accepted.set(id, recent);
      return { ok: true };
    },

    /** Forget everything. Tests only; a restart does the same in production. */
    reset(): void {
      accepted.clear();
    },
  };
}

export const measurementRateLimit = createRateLimiter(MEASUREMENT_RATE_LIMIT);
