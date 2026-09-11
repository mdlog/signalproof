import { describe, expect, it } from "vitest";
import {
  BACKOFF_SCHEDULE_MS,
  MAX_ATTEMPTS,
  MAX_BATCH_ENTRIES,
  backoffMs,
  buildSourceMeasurementEvent,
  canTransition,
  fallbackBatchGasLimit,
  fallbackGasLimit,
  getIntegrationReadiness,
  hasExhaustedAttempts,
  readinessFrom,
  shouldAutoSettle,
  parseProofWorkerMode,
  isPermanentFailure,
  toRejectionCode,
  withGasBuffer,
} from "./worker";
import { toBytes32 } from "./relayer";
import { groupByContinuityProof, type PreparedProof } from "./proofWorker";

describe("buildSourceMeasurementEvent", () => {
  it("narrows the millisecond timestamp string to a number", () => {
    const event = buildSourceMeasurementEvent({
      measurementRoot: "0xroot",
      areaHash: "a9c-46",
      sessionHash: "0xsession",
      timestampMs: "1788762000000",
      latencyMs: 28,
      downloadMbps: 91,
    });
    expect(event.timestamp).toBe(1788762000000);
    expect(typeof event.timestamp).toBe("number");
  });

  it("carries every field through unchanged", () => {
    const input = {
      measurementRoot: "0xabc",
      areaHash: "zone-7",
      sessionHash: "0xdef",
      timestampMs: "1788762000000",
      latencyMs: 42,
      downloadMbps: 77,
    };
    expect(buildSourceMeasurementEvent(input)).toEqual({
      measurementRoot: "0xabc",
      areaHash: "zone-7",
      sessionHash: "0xdef",
      timestamp: 1788762000000,
      latencyMs: 42,
      downloadMbps: 77,
    });
  });
});

describe("getIntegrationReadiness", () => {
  it("reports every missing chain variable when nothing is configured", () => {
    const readiness = getIntegrationReadiness();
    expect(readiness.missing).toEqual(
      expect.arrayContaining([
        "SEPOLIA_RPC_URL",
        "SEPOLIA_RELAYER_PRIVATE_KEY",
        "SOURCE_BATCH_REGISTRY_ADDRESS",
        "CREDITCOIN_RPC_URL",
        "CREDITCOIN_RELAYER_PRIVATE_KEY",
        "SETTLEMENT_CONTRACT_ADDRESS",
        "ATTESTCOIN_CHAIN_KEY",
        "ATTESTCOIN_PROOF_SERVICE_URL",
      ]),
    );
  });

  it("does not claim readiness it cannot back up", () => {
    const readiness = getIntegrationReadiness();
    expect(readiness.proofWorkerReady).toBe(false);
    expect(readiness.relayerReady).toBe(false);
  });

  it("never leaks a secret value, only the key name", () => {
    const serialised = JSON.stringify(getIntegrationReadiness());
    expect(serialised).not.toMatch(/0x[0-9a-fA-F]{40,}/);
  });

  // A clone of .env.example has RPC URLs and the public contract addresses but no keys. That is a
  // dashboard that reads real settlements and cannot submit — not an unconfigured chain, which is
  // what the sidebar used to call it while the header said LIVE.
  it("reports read-only when the chain can be read but no relayer key is set", () => {
    const readiness = readinessFrom(["SEPOLIA_RELAYER_PRIVATE_KEY", "CREDITCOIN_RELAYER_PRIVATE_KEY"]);
    expect(readiness.readOnly).toBe(true);
    expect(readiness.relayerReady).toBe(false);
    expect(readiness.proofWorkerReady).toBe(false);
  });

  it("is not read-only when a contract address is missing as well", () => {
    const readiness = readinessFrom(["SEPOLIA_RELAYER_PRIVATE_KEY", "SOURCE_BATCH_REGISTRY_ADDRESS"]);
    expect(readiness.readOnly).toBe(false);
  });

  it("is not read-only when everything is configured", () => {
    const readiness = readinessFrom([]);
    expect(readiness.readOnly).toBe(false);
    expect(readiness.proofWorkerReady).toBe(true);
  });

  // PROOF_WORKER_MODE=relay-only keeps relaying to Sepolia but never settles, so the only path to
  // a reward is a contributor sending execute() from their own wallet — the demo of permissionless
  // settlement. The default is unchanged.
  it("reports the settle mode and whether the worker settles on its own", () => {
    expect(shouldAutoSettle("full")).toBe(true);
    expect(shouldAutoSettle("relay-only")).toBe(false);
    expect(readinessFrom([], "relay-only").settleMode).toBe("relay-only");
    expect(readinessFrom([]).settleMode).toBe("full");
  });

  it("treats an unknown mode as full so a typo cannot silently stop settlement", () => {
    expect(parseProofWorkerMode("relay-only")).toBe("relay-only");
    expect(parseProofWorkerMode("RELAY-ONLY")).toBe("relay-only");
    expect(parseProofWorkerMode("")).toBe("full");
    expect(parseProofWorkerMode("manual")).toBe("full");
  });
});

describe("status transitions", () => {
  it("advances one step at a time along the happy path", () => {
    expect(canTransition("SUBMITTED", "AWAITING_ATTESTATION")).toBe(true);
    expect(canTransition("AWAITING_ATTESTATION", "PROOF_VERIFIED")).toBe(true);
    expect(canTransition("PROOF_VERIFIED", "SETTLED")).toBe(true);
  });

  it("refuses to skip attestation", () => {
    // The invariant that keeps an unproven measurement from being presented as settled.
    expect(canTransition("SUBMITTED", "PROOF_VERIFIED")).toBe(false);
    expect(canTransition("SUBMITTED", "SETTLED")).toBe(false);
    expect(canTransition("AWAITING_ATTESTATION", "SETTLED")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransition("SETTLED", "PROOF_VERIFIED")).toBe(false);
    expect(canTransition("PROOF_VERIFIED", "AWAITING_ATTESTATION")).toBe(false);
    expect(canTransition("AWAITING_ATTESTATION", "SUBMITTED")).toBe(false);
  });

  it("allows rejection from any live state but never out of a terminal one", () => {
    expect(canTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransition("AWAITING_ATTESTATION", "REJECTED")).toBe(true);
    expect(canTransition("PROOF_VERIFIED", "REJECTED")).toBe(true);
    expect(canTransition("REJECTED", "SUBMITTED")).toBe(false);
    expect(canTransition("REJECTED", "SETTLED")).toBe(false);
    expect(canTransition("SETTLED", "REJECTED")).toBe(false);
  });

  it("treats a self-transition as illegal so a retry cannot double-count", () => {
    expect(canTransition("SUBMITTED", "SUBMITTED")).toBe(false);
    expect(canTransition("SETTLED", "SETTLED")).toBe(false);
  });
});

describe("backoff", () => {
  it("starts at the first step and grows monotonically", () => {
    expect(backoffMs(0)).toBe(BACKOFF_SCHEDULE_MS[0]);
    for (let i = 1; i < BACKOFF_SCHEDULE_MS.length; i++) {
      expect(backoffMs(i)).toBeGreaterThanOrEqual(backoffMs(i - 1));
    }
  });

  it("saturates instead of growing without bound", () => {
    const last = BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
    expect(backoffMs(99)).toBe(last);
    expect(backoffMs(1_000_000)).toBe(last);
  });

  it("exhausts attempts exactly at the schedule length", () => {
    expect(hasExhaustedAttempts(MAX_ATTEMPTS - 1)).toBe(false);
    expect(hasExhaustedAttempts(MAX_ATTEMPTS)).toBe(true);
  });
});

describe("error classification", () => {
  it("maps contract reverts onto stable codes", () => {
    expect(toRejectionCode(new Error("execution reverted: Query already processed"))).toBe(
      "QUERY_ALREADY_PROCESSED",
    );
    expect(toRejectionCode(new Error("WrongEmitter(0xbad, 0xgood)"))).toBe("WRONG_EMITTER");
    expect(toRejectionCode(new Error("Proof of inclusion verification failed"))).toBe(
      "PROOF_VERIFICATION_FAILED",
    );
    expect(toRejectionCode(new Error("MeasurementTooOld(1, 2)"))).toBe("MEASUREMENT_TOO_OLD");
  });

  it("maps infrastructure failures onto retryable codes", () => {
    expect(toRejectionCode(new Error("ETIMEDOUT"))).toBe("TIMEOUT");
    expect(toRejectionCode(new Error("getaddrinfo ENOTFOUND rpc.example"))).toBe(
      "NETWORK_UNAVAILABLE",
    );
    expect(isPermanentFailure("TIMEOUT")).toBe(false);
    expect(isPermanentFailure("NETWORK_UNAVAILABLE")).toBe(false);
    expect(isPermanentFailure("RELAYER_OUT_OF_GAS_FUNDS")).toBe(false);
  });

  it("treats forged and already-settled measurements as terminal", () => {
    expect(isPermanentFailure("WRONG_EMITTER")).toBe(true);
    expect(isPermanentFailure("ALREADY_SETTLED")).toBe(true);
    expect(isPermanentFailure("SOURCE_TX_FAILED")).toBe(true);
    expect(isPermanentFailure("DUPLICATE_MEASUREMENT_ROOT")).toBe(true);
  });

  it("bounds an unrecognised message so a signed transaction cannot land in the database", () => {
    const huge = "0x" + "ab".repeat(5000);
    const code = toRejectionCode(new Error(huge));
    expect(code.startsWith("UNKNOWN: ")).toBe(true);
    expect(code.length).toBeLessThanOrEqual(9 + 120);
  });

  it("survives a non-Error throw", () => {
    expect(() => toRejectionCode("plain string")).not.toThrow();
    expect(() => toRejectionCode(null)).not.toThrow();
    expect(() => toRejectionCode({ weird: true })).not.toThrow();
  });
});

describe("gas handling", () => {
  it("applies the 35 percent buffer from the reference implementation", () => {
    expect(withGasBuffer(420_181n)).toBe(567_244n);
  });

  it("produces a usable limit when estimateGas throws against the precompile", () => {
    expect(fallbackGasLimit(10)).toBe(91_000n);
    // A zero-length continuity proof must still buy at least one hash worth of gas.
    expect(fallbackGasLimit(0)).toBe(fallbackGasLimit(1));
    expect(fallbackGasLimit(0)).toBeGreaterThan(21_000n);
  });
});

describe("toBytes32", () => {
  it("passes a full 32-byte hex word through, normalised to lowercase", () => {
    const word = "0x" + "AB".repeat(32);
    expect(toBytes32(word)).toBe(word.toLowerCase());
  });

  it("left-pads a short hex value", () => {
    expect(toBytes32("0x1234")).toBe("0x" + "0".repeat(60) + "1234");
  });

  it("encodes a short non-hex identifier from its utf-8 bytes", () => {
    const encoded = toBytes32("a9c-46");
    expect(encoded).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(encoded)).toBe(BigInt("0x" + Buffer.from("a9c-46").toString("hex")));
  });

  it("is deterministic — the destination chain must be able to match it", () => {
    expect(toBytes32("zone-7")).toBe(toBytes32("zone-7"));
  });

  it("keeps distinct identifiers distinct", () => {
    expect(toBytes32("zone-7")).not.toBe(toBytes32("zone-8"));
  });

  it("refuses to silently truncate an over-long identifier", () => {
    expect(() => toBytes32("x".repeat(33))).toThrow(/too long/i);
  });
});

describe("batch settlement gas", () => {
  it("stays above the measured marginal cost at every allowed size", () => {
    // contracts/test/BatchGasProbe measured these totals against the real contract.
    const measured: Array<[entries: number, gasUsed: number]> = [
      [10, 482_141],
      [50, 2_468_789],
      [200, 12_476_653],
    ];
    for (const [entries, gasUsed] of measured) {
      expect(Number(fallbackBatchGasLimit(entries, 1))).toBeGreaterThan(gasUsed);
    }
  });

  it("keeps the largest allowed batch inside a CC3 block", () => {
    // CC3 blocks carry 75,000,000 gas; a limit above that can never be included.
    expect(Number(fallbackBatchGasLimit(MAX_BATCH_ENTRIES, 8))).toBeLessThan(75_000_000);
  });

  it("never returns zero for a degenerate call", () => {
    expect(fallbackBatchGasLimit(0, 0)).toBeGreaterThan(0n);
  });
});

describe("continuity proof grouping", () => {
  const entry = (root: string, digest: string, roots: string[], chainKey = 1) =>
    ({
      row: { measurementRoot: root },
      proof: { chainKey, continuityProof: { lowerEndpointDigest: digest, roots } },
    }) as unknown as PreparedProof;

  it("groups rows the proof service issued the same continuity proof for", () => {
    const groups = groupByContinuityProof([
      entry("0xa", "0xdigest", ["0xr1"]),
      entry("0xb", "0xdigest", ["0xr1"]),
      entry("0xc", "0xdigest", ["0xr1"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("refuses to share a proof across different continuity ranges", () => {
    // The saving is real but it is not worth a batch that proves the wrong range: a continuity
    // proof is only valid over the span it was built for.
    const groups = groupByContinuityProof([
      entry("0xa", "0xdigest", ["0xr1"]),
      entry("0xb", "0xother", ["0xr1"]),
      entry("0xc", "0xdigest", ["0xr1", "0xr2"]),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("never groups across chain keys", () => {
    const groups = groupByContinuityProof([
      entry("0xa", "0xdigest", ["0xr1"], 1),
      entry("0xb", "0xdigest", ["0xr1"], 2),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("handles a single row without forming a batch", () => {
    expect(groupByContinuityProof([entry("0xa", "0xd", [])])).toEqual([
      [expect.objectContaining({ row: { measurementRoot: "0xa" } })],
    ]);
  });
});

describe("registry authorisation failures", () => {
  it("classifies a rejected relayer as permanent", () => {
    // The registry accepts one address. If the gateway is not it, no amount of retrying helps —
    // and burning the backoff schedule on every measurement would bury the real cause.
    const code = toRejectionCode(new Error('execution reverted: NotAuthorised(0xdead)'));
    expect(code).toBe("RELAYER_NOT_AUTHORISED");
    expect(isPermanentFailure(code)).toBe(true);
  });

  it("lets a batch that settled nothing be retried", () => {
    // Not the row's fault: every entry was already settled or stale. The single-proof fallback
    // decides what to do with each one individually.
    expect(isPermanentFailure(toRejectionCode(new Error("NoMeasurementSettled()")))).toBe(false);
  });
});
