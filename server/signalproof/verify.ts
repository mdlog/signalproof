/**
 * Public verifier — one hash in, its position across both chains out.
 *
 * A measurement is identified by three hashes: its root (what the contributor signed), the
 * Sepolia transaction that committed it, and the Creditcoin transaction that settled it. Any of
 * the three resolves to the same joined record, so a buyer holding a sample from the API, a
 * contributor holding an explorer link, or a judge holding a README hash all land on one page.
 *
 * Verification is never metered: it is the product's thesis, not a feature of it.
 */

import type { OnchainMeasurement, OnchainSnapshot } from "./chainRead";

const SEPOLIA_TX = "https://sepolia.etherscan.io/tx/";
const CC3_TX = "https://creditcoin-testnet.blockscout.com/tx/";
const HASH = /^(0x)?[0-9a-f]{64}$/i;

export type VerificationResult =
  | {
      found: true;
      matchedBy: "measurementRoot" | "sourceTxHash" | "creditcoinTxHash";
      measurement: OnchainMeasurement;
      explorer: { source: string | null; settlement: string | null };
      verifyUrl: string;
    }
  | {
      found: false;
      reason: "MALFORMED" | "NOT_IN_SCANNED_WINDOW";
      scannedFromBlock: OnchainSnapshot["scannedFromBlock"];
    };

/** Canonical form: lower-case, 0x-prefixed. Null when the input is not a 32-byte hex string. */
export function normalizeHash(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!HASH.test(trimmed)) return null;
  return "0x" + trimmed.replace(/^0x/i, "").toLowerCase();
}

export function verifyUrlFor(measurementRoot: string): string {
  return `/verify/${measurementRoot}`;
}

export function resolveVerification(snapshot: OnchainSnapshot, raw: string): VerificationResult {
  const hash = normalizeHash(raw);
  if (!hash) return { found: false, reason: "MALFORMED", scannedFromBlock: snapshot.scannedFromBlock };

  const same = (v: string | null) => v != null && v.toLowerCase() === hash;
  for (const m of snapshot.measurements) {
    const matchedBy = same(m.measurementRoot)
      ? "measurementRoot"
      : same(m.sourceTxHash)
        ? "sourceTxHash"
        : same(m.creditcoinTxHash)
          ? "creditcoinTxHash"
          : null;
    if (!matchedBy) continue;
    return {
      found: true,
      matchedBy,
      measurement: m,
      explorer: {
        source: m.sourceTxHash ? SEPOLIA_TX + m.sourceTxHash : null,
        settlement: m.creditcoinTxHash ? CC3_TX + m.creditcoinTxHash : null,
      },
      verifyUrl: verifyUrlFor(m.measurementRoot),
    };
  }
  return { found: false, reason: "NOT_IN_SCANNED_WINDOW", scannedFromBlock: snapshot.scannedFromBlock };
}
