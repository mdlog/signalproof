/**
 * Buyer access — paid on Creditcoin, into the reward pool, redeemed as a stateless key.
 *
 * The purchase is a plain CTC transfer to `SignalProofSettlement`, whose `receive()` credits the
 * reward pool and emits `Funded`. So a buyer's payment is, byte for byte, the money contributors
 * later `claim()`: the DePIN loop closes without a new contract.
 *
 * A key is `sp1_<expiryUnix>_<txHash>_<hmac16>`, the HMAC taken over `txHash|expiry` with a server
 * secret. It is issued only after the payment was verified on chain AND the redeemer proved, with
 * an EIP-191 signature, that they are the transaction's sender — otherwise anyone reading a
 * `Funded` event on the explorer could redeem someone else's payment. Nothing is stored: the same
 * transaction always yields the same key, so replay is not a concept here and "I lost my key" is
 * "sign again". The cost is that a single key cannot be revoked — only the secret can be rotated.
 *
 * What is sold is the service — aggregation, the provenance join, briefs, exports, uptime — not
 * the data, which is public on two chains and stays free on the dashboard.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { parseEther, verifyMessage } from "ethers";
import { ENV } from "../_core/env";

const KEY_PREFIX = "sp1";
const KEY_RE = /^sp1_(\d{1,12})_(0x[0-9a-f]{64})_([0-9a-f]{32})$/;
const DEFAULT_PRICE_CTC = "0.05";
const DEFAULT_DAYS = 30;

export type AccessConfig = {
  enabled: boolean;
  priceWei: bigint;
  priceCtc: string;
  days: number;
  settlement: string;
};

/** CTC → wei; anything unparseable falls back to the default rather than to "free". */
export function parseAccessPrice(raw: string): bigint {
  try {
    const wei = parseEther(raw.trim() || DEFAULT_PRICE_CTC);
    return wei > 0n ? wei : parseEther(DEFAULT_PRICE_CTC);
  } catch {
    return parseEther(DEFAULT_PRICE_CTC);
  }
}

function secret(): string {
  return ENV.buyerAccessSecret || ENV.cookieSecret;
}

/**
 * The gate is open — the API behaves as before, free — when no secret is configured. A keyless
 * clone must keep working; the purchase card hides itself when `enabled` is false.
 */
export function accessConfig(): AccessConfig {
  const priceWei = parseAccessPrice(ENV.buyerAccessPriceCtc);
  const days = Number.parseInt(ENV.buyerAccessDays, 10);
  return {
    enabled: Boolean(secret() && ENV.settlementContractAddress),
    priceWei,
    priceCtc: (ENV.buyerAccessPriceCtc.trim() || DEFAULT_PRICE_CTC).replace(/^\./, "0."),
    days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS,
    settlement: ENV.settlementContractAddress || "",
  };
}

function mac(txHash: string, expiryUnix: number, key: string): string {
  return createHmac("sha256", key).update(`${txHash}|${expiryUnix}`).digest("hex").slice(0, 32);
}

export function issueKey(txHash: string, expiryUnix: number, key: string): string {
  const tx = txHash.toLowerCase();
  return `${KEY_PREFIX}_${expiryUnix}_${tx}_${mac(tx, expiryUnix, key)}`;
}

export type KeyVerdict =
  | { ok: true; txHash: string; expiryUnix: number }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/** Offline: parse, recompute the HMAC in constant time, then check the clock. */
export function verifyKey(raw: string, key: string, nowUnix: number): KeyVerdict {
  const m = KEY_RE.exec(raw ?? "");
  if (!m) return { ok: false, reason: "MALFORMED" };
  const expiryUnix = Number(m[1]);
  const txHash = m[2];
  const given = Buffer.from(m[3], "hex");
  const expected = Buffer.from(mac(txHash, expiryUnix, key), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  if (nowUnix > expiryUnix) return { ok: false, reason: "EXPIRED" };
  return { ok: true, txHash, expiryUnix };
}

/** The exact text the wallet shows. Rebuilt server-side; never accepted from the client. */
export function buildAccessSigningMessage(txHash: string, address: string): string {
  return `SignalProof API access\nTransaction: ${txHash.toLowerCase()}\nAddress: ${address}`;
}

/** The three reads a purchase check needs. `ethers.JsonRpcProvider` satisfies it structurally. */
export type PurchaseProvider = {
  getTransaction(hash: string): Promise<{ to: string | null; from: string; value: bigint; blockNumber: number | null } | null>;
  getTransactionReceipt(hash: string): Promise<{ status: number | null } | null>;
  getBlock(blockNumber: number): Promise<{ timestamp: number } | null>;
};

export type PurchaseVerdict =
  | { ok: true; expiryUnix: number; from: string; valueWei: bigint }
  | { ok: false; code: "TX_NOT_FOUND" | "WRONG_RECIPIENT" | "UNDERPAID" | "TX_FAILED" | "SIGNER_MISMATCH" };

/**
 * Check a payment on Creditcoin and the redeemer's claim to it.
 *
 * Order matters for what an attacker learns: signer first, so a stranger holding a real payment
 * hash cannot probe whether it was large enough.
 */
export async function verifyPurchase(
  provider: PurchaseProvider,
  args: { txHash: string; address: string; signature: string; settlement: string; priceWei: bigint; days: number },
): Promise<PurchaseVerdict> {
  let signer: string;
  try {
    signer = verifyMessage(buildAccessSigningMessage(args.txHash, args.address), args.signature);
  } catch {
    return { ok: false, code: "SIGNER_MISMATCH" };
  }
  if (signer.toLowerCase() !== args.address.toLowerCase()) return { ok: false, code: "SIGNER_MISMATCH" };

  const tx = await provider.getTransaction(args.txHash);
  if (!tx || tx.blockNumber == null) return { ok: false, code: "TX_NOT_FOUND" };
  if (tx.from.toLowerCase() !== signer.toLowerCase()) return { ok: false, code: "SIGNER_MISMATCH" };
  if ((tx.to ?? "").toLowerCase() !== args.settlement.toLowerCase()) return { ok: false, code: "WRONG_RECIPIENT" };
  if (tx.value < args.priceWei) return { ok: false, code: "UNDERPAID" };

  const receipt = await provider.getTransactionReceipt(args.txHash);
  if (!receipt) return { ok: false, code: "TX_NOT_FOUND" };
  if (receipt.status !== 1) return { ok: false, code: "TX_FAILED" };

  // Expiry runs from the payment's block time, not from the redemption, so a late redemption does
  // not extend the term and the key is a pure function of the transaction.
  const block = await provider.getBlock(tx.blockNumber);
  const paidAt = block?.timestamp ?? Math.floor(Date.now() / 1000);
  return { ok: true, expiryUnix: paidAt + args.days * 86_400, from: tx.from, valueWei: tx.value };
}

/** What a refused caller is told: the price, the term, and exactly how to buy. */
export function accessRequiredBody(cfg: AccessConfig, detail: string) {
  return {
    error: "ACCESS_REQUIRED",
    detail,
    price: `${cfg.priceCtc} CTC`,
    days: cfg.days,
    payTo: cfg.settlement,
    chainId: 102031,
    terms: "/v1/access",
    howTo:
      `Send ${cfg.priceCtc} CTC to ${cfg.settlement} on Creditcoin CC3 Testnet (it funds the contributor reward pool), ` +
      `sign "SignalProof API access\\nTransaction: <txHash>\\nAddress: <yourAddress>" with the paying wallet, ` +
      `then POST /v1/access/redeem { txHash, address, signature } and pass the key as Authorization: Bearer <key> (or ?key=<key> on a link).`,
  };
}

/** Express gate for the paid endpoints. Open when access is not configured. */
export function requireAccess(): RequestHandler {
  return (req, res, next) => {
    const cfg = accessConfig();
    if (!cfg.enabled) {
      next();
      return;
    }
    // `Authorization: Bearer` for programs; `?key=` for a link a browser opens, which cannot carry
    // a header. Both are the same key. Responses behind the gate are marked private so a shared
    // cache never serves one buyer's answer to another.
    const header = req.get("authorization") ?? "";
    const fromQuery = typeof req.query?.key === "string" ? req.query.key : "";
    const raw = (header.replace(/^Bearer\s+/i, "").trim() || fromQuery).trim();
    res.set("Cache-Control", "private, max-age=15");
    if (!raw) {
      res.status(401).json(accessRequiredBody(cfg, "No API key. This endpoint is metered; the dashboard at / stays free."));
      return;
    }
    const verdict = verifyKey(raw, secret(), Math.floor(Date.now() / 1000));
    if (!verdict.ok) {
      res.status(401).json(accessRequiredBody(cfg, `API key refused: ${verdict.reason}`));
      return;
    }
    res.set("X-SignalProof-Access-Expires", new Date(verdict.expiryUnix * 1000).toISOString());
    next();
  };
}
