import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import {
  buildAccessSigningMessage,
  issueKey,
  parseAccessPrice,
  verifyKey,
  verifyPurchase,
} from "./access";

/**
 * Buyer access keys are stateless: a key is an HMAC over the CC3 payment transaction and its
 * expiry, issued only after the payment was verified on chain and the payer proved they sent it.
 * Nothing is stored, so replay is a non-issue — the same transaction always yields the same key.
 */

const SECRET = "test-secret";
const TX = "0x" + "ab".repeat(32);

describe("access keys", () => {
  it("round-trips a key", () => {
    const key = issueKey(TX, 1_800_000_000, SECRET);
    expect(key.startsWith("sp1_1800000000_" + TX + "_")).toBe(true);
    expect(verifyKey(key, SECRET, 1_799_999_999)).toEqual({
      ok: true,
      txHash: TX,
      expiryUnix: 1_800_000_000,
    });
  });

  it("is deterministic, so redeeming the same transaction twice yields the same key", () => {
    expect(issueKey(TX, 1_800_000_000, SECRET)).toBe(issueKey(TX, 1_800_000_000, SECRET));
  });

  it("refuses a tampered expiry, a tampered hmac, a foreign secret, an expired key and garbage", () => {
    const key = issueKey(TX, 1_800_000_000, SECRET);
    expect(verifyKey(key.replace("1800000000", "1900000000"), SECRET, 1)).toEqual({
      ok: false,
      reason: "BAD_SIGNATURE",
    });
    const flipped = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");
    expect(verifyKey(flipped, SECRET, 1)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyKey(issueKey(TX, 1_800_000_000, "other"), SECRET, 1)).toEqual({
      ok: false,
      reason: "BAD_SIGNATURE",
    });
    expect(verifyKey(key, SECRET, 1_800_000_001)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(verifyKey("sp1_x", SECRET, 1)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyKey("", SECRET, 1)).toEqual({ ok: false, reason: "MALFORMED" });
  });
});

describe("parseAccessPrice", () => {
  it("reads CTC as wei and falls back to the default on nonsense", () => {
    expect(parseAccessPrice("0.05")).toBe(50_000_000_000_000_000n);
    expect(parseAccessPrice("")).toBe(50_000_000_000_000_000n);
    expect(parseAccessPrice("abc")).toBe(50_000_000_000_000_000n);
    expect(parseAccessPrice("1")).toBe(1_000_000_000_000_000_000n);
  });
});

describe("verifyPurchase", () => {
  const buyer = Wallet.createRandom();
  const settlement = "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584";
  const PRICE = 50_000_000_000_000_000n;

  const provider = (over: Partial<{ to: string | null; from: string; value: bigint; status: number | null }>) => ({
    getTransaction: async () => ({
      to: over.to === undefined ? settlement : over.to,
      from: over.from ?? buyer.address,
      value: over.value ?? PRICE,
      blockNumber: 10,
    }),
    getTransactionReceipt: async () => ({ status: over.status === undefined ? 1 : over.status }),
    getBlock: async () => ({ timestamp: 1_800_000_000 }),
  });

  const args = async (over: Partial<{ address: string; signature: string }> = {}) => ({
    txHash: TX,
    address: buyer.address,
    settlement,
    priceWei: PRICE,
    days: 30,
    signature: await buyer.signMessage(buildAccessSigningMessage(TX, buyer.address)),
    ...over,
  });

  it("accepts a paid, successful transfer signed by its sender", async () => {
    expect(await verifyPurchase(provider({}), await args())).toEqual({
      ok: true,
      expiryUnix: 1_800_000_000 + 30 * 86_400,
      from: buyer.address,
      valueWei: PRICE,
    });
  });

  it("accepts the settlement address in any letter case", async () => {
    const r = await verifyPurchase(provider({ to: settlement.toLowerCase() }), await args());
    expect(r.ok).toBe(true);
  });

  it("refuses wrong recipient, underpayment, failed tx, foreign signer, missing tx and missing receipt", async () => {
    expect(await verifyPurchase(provider({ to: buyer.address }), await args())).toEqual({
      ok: false,
      code: "WRONG_RECIPIENT",
    });
    expect(await verifyPurchase(provider({ value: PRICE - 1n }), await args())).toEqual({
      ok: false,
      code: "UNDERPAID",
    });
    expect(await verifyPurchase(provider({ status: 0 }), await args())).toEqual({
      ok: false,
      code: "TX_FAILED",
    });
    const other = Wallet.createRandom();
    expect(
      await verifyPurchase(
        provider({}),
        await args({
          address: other.address,
          signature: await other.signMessage(buildAccessSigningMessage(TX, other.address)),
        }),
      ),
    ).toEqual({ ok: false, code: "SIGNER_MISMATCH" });
    // A valid signature by the payer over a DIFFERENT address field is still a mismatch.
    expect(
      await verifyPurchase(provider({}), await args({ address: other.address })),
    ).toEqual({ ok: false, code: "SIGNER_MISMATCH" });
    expect(
      await verifyPurchase({ ...provider({}), getTransaction: async () => null }, await args()),
    ).toEqual({ ok: false, code: "TX_NOT_FOUND" });
    expect(
      await verifyPurchase({ ...provider({}), getTransactionReceipt: async () => null }, await args()),
    ).toEqual({ ok: false, code: "TX_NOT_FOUND" });
  });
});

describe("requireAccess middleware", () => {
  const call = async (authorization: string | undefined, enabled: boolean) => {
    const { requireAccess } = await import("./access");
    const { ENV } = await import("../_core/env");
    const saved = { s: ENV.buyerAccessSecret, c: ENV.cookieSecret, a: ENV.settlementContractAddress };
    ENV.buyerAccessSecret = enabled ? SECRET : "";
    ENV.cookieSecret = "";
    ENV.settlementContractAddress = enabled ? "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584" : "";
    let status = 200;
    let body: unknown = null;
    let nexted = false;
    const req = { get: () => authorization, query: {} } as never;
    const res = {
      status(code: number) { status = code; return this; },
      json(v: unknown) { body = v; return this; },
      set() { return this; },
    } as never;
    try {
      requireAccess()(req, res, () => { nexted = true; });
    } finally {
      ENV.buyerAccessSecret = saved.s; ENV.cookieSecret = saved.c; ENV.settlementContractAddress = saved.a;
    }
    return { status, body: body as { error?: string; howTo?: string; price?: string } | null, nexted };
  };

  it("passes when access is not configured (keyless clone)", async () => {
    expect((await call(undefined, false)).nexted).toBe(true);
  });
  it("refuses a missing or bad key with the terms in the body", async () => {
    const missing = await call(undefined, true);
    expect(missing.status).toBe(401);
    expect(missing.body?.error).toBe("ACCESS_REQUIRED");
    expect(missing.body?.price).toBe("0.05 CTC");
    expect(missing.body?.howTo).toContain("/v1/access/redeem");
    const bad = await call("Bearer sp1_nope", true);
    expect(bad.status).toBe(401);
    expect(bad.nexted).toBe(false);
  });
  it("passes a valid key", async () => {
    const key = issueKey(TX, Math.floor(Date.now() / 1000) + 3600, SECRET);
    expect((await call(`Bearer ${key}`, true)).nexted).toBe(true);
  });
  it("accepts the same key as ?key= for a link a browser opens", async () => {
    const { requireAccess } = await import("./access");
    const { ENV } = await import("../_core/env");
    const saved = { s: ENV.buyerAccessSecret, a: ENV.settlementContractAddress };
    ENV.buyerAccessSecret = SECRET;
    ENV.settlementContractAddress = "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584";
    let nexted = false;
    let cache = "";
    const key = issueKey(TX, Math.floor(Date.now() / 1000) + 3600, SECRET);
    const req = { get: () => undefined, query: { key } } as never;
    const res = { status() { return this; }, json() { return this; }, set(h: string, v: string) { if (h === "Cache-Control") cache = v; return this; } } as never;
    try {
      requireAccess()(req, res, () => { nexted = true; });
    } finally {
      ENV.buyerAccessSecret = saved.s; ENV.settlementContractAddress = saved.a;
    }
    expect(nexted).toBe(true);
    expect(cache).toContain("private");
  });
});
