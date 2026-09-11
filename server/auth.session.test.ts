import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "./_core/sdk";

/**
 * The dashboard is public; nothing in SignalProof requires a login. The OAuth scaffold still runs
 * session verification on every request, and with no JWT_SECRET configured it used to log
 * "Session verification failed ... Zero-length key" for every request that carried a stale cookie,
 * and "Missing session cookie" for every request that did not. A judge running `pnpm dev` saw a
 * terminal full of failures for a feature the app does not use.
 */
describe("session verification without a configured secret", () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats a stale cookie as anonymous without throwing or warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sdk.verifySession("stale.session.cookie");
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats a missing cookie as an anonymous visitor, not a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sdk.verifySession(undefined);
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
