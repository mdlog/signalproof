import { describe, expect, it } from "vitest";
import { measurement, snapshot } from "./fixtures";
import { resolveVerification } from "./verify";

/**
 * The verifier answers one question: where does this hash sit across the two chains? It matches
 * a measurement root, a Sepolia commitment or a Creditcoin settlement, and says which. A hash it
 * cannot find is reported as outside the scanned window, never as "invalid".
 */

describe("resolveVerification", () => {
  const m = measurement({});

  it("matches by root, source tx and settlement tx, case-insensitively", () => {
    const cases = [
      [m.measurementRoot, "measurementRoot"],
      [m.sourceTxHash!.toUpperCase().replace("0X", "0x"), "sourceTxHash"],
      [m.creditcoinTxHash!, "creditcoinTxHash"],
    ] as const;
    for (const [hash, by] of cases) {
      const r = resolveVerification(snapshot([m]), hash);
      expect(r.found).toBe(true);
      if (r.found) {
        expect(r.matchedBy).toBe(by);
        expect(r.measurement.measurementRoot).toBe(m.measurementRoot);
        expect(r.verifyUrl).toBe(`/verify/${m.measurementRoot}`);
        expect(r.explorer.source).toContain(m.sourceTxHash);
        expect(r.explorer.settlement).toContain(m.creditcoinTxHash);
      }
    }
  });

  it("tolerates surrounding whitespace and a missing 0x", () => {
    const r = resolveVerification(snapshot([m]), `  ${m.measurementRoot.slice(2)} `);
    expect(r.found).toBe(true);
  });

  it("reports not-in-window and malformed distinctly", () => {
    expect(resolveVerification(snapshot([]), "0x" + "cc".repeat(32))).toMatchObject({
      found: false,
      reason: "NOT_IN_SCANNED_WINDOW",
      scannedFromBlock: { sepolia: 11658403, creditcoin: 5448580 },
    });
    expect(resolveVerification(snapshot([m]), "hello")).toMatchObject({ found: false, reason: "MALFORMED" });
    expect(resolveVerification(snapshot([m]), "")).toMatchObject({ found: false, reason: "MALFORMED" });
  });

  it("an awaiting measurement has no settlement link", () => {
    const pending = measurement({ status: "AWAITING_ATTESTATION", creditcoinTxHash: null, rewardAmount: null });
    const r = resolveVerification(snapshot([pending]), pending.measurementRoot);
    expect(r.found && r.explorer.settlement).toBeNull();
  });
});
