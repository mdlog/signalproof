import { Wallet, getBytes, isHexString } from "ethers";
import { describe, expect, it } from "vitest";
import { validateMeasurementPolicy, verifyMeasurementIntegrity, type MeasurementInput } from "./routers";
import { buildSourceMeasurementEvent, getIntegrationReadiness } from "./signalproof/worker";
import {
  buildMeasurementSigningMessage,
  deriveMeasurementRoot,
  deriveSessionHash,
} from "../shared/measurement";
import { AREA_PRECISION, encodeGeohash } from "../shared/geohash";

/** A deterministic contributor. Test-only key, never used on any chain. */
const contributor = new Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const areaHash = encodeGeohash(-6.225, 106.809, AREA_PRECISION);
const sessionHash = deriveSessionHash("test-session");

/**
 * Sign a root the way a browser wallet actually does.
 *
 * `personal_sign` takes its message parameter as HEX. Handed a 0x-prefixed root, MetaMask and every
 * wallet following the same convention decode it to 32 raw bytes and apply the EIP-191 prefix to
 * those — never to the 66 ASCII characters. `wallet.signMessage(rootString)` produces the other
 * encoding entirely, and the two yield different digests and therefore different recovered
 * addresses.
 *
 * Every existing test in this file signs the string form, which is also the form the server
 * verifies. They agree with each other and neither has ever exercised what the browser sends.
 */
type Signer = { address: string; signMessage(message: string): Promise<string> };

function signAsWalletWould(
  wallet: Signer,
  measurementRoot: string,
  contributorAddress = wallet.address,
): Promise<string> {
  // The message is not valid hex, so a wallet treats it as UTF-8 — which is exactly what ethers'
  // string overload does. That equivalence is the whole point of the fix: there is now one
  // possible encoding rather than two.
  return wallet.signMessage(
    buildMeasurementSigningMessage({ measurementRoot, contributorAddress }),
  );
}

/** Build a fully valid, correctly signed measurement. */
async function validMeasurement(
  overrides: Partial<MeasurementInput> = {},
): Promise<MeasurementInput> {
  const base = {
    areaHash,
    networkType: "4g",
    latencyMs: 28,
    downloadMbps: 91,
    uploadMbps: 22,
    packetLossBps: 20,
    timestampMs: String(Date.now()),
    nonce: "nonce-1042-aaaa",
    sessionHash,
    contributorAddress: contributor.address,
    ...overrides,
  };
  const measurementRoot =
    overrides.measurementRoot ??
    deriveMeasurementRoot({
      areaHash: base.areaHash,
      networkType: base.networkType === "unreported" ? null : base.networkType,
      latencyMs: base.latencyMs,
      downloadMbps: base.downloadMbps,
      uploadMbps: base.uploadMbps,
      packetLossBps: base.packetLossBps,
      timestampMs: base.timestampMs,
      nonce: base.nonce,
      sessionHash: base.sessionHash,
      contributorAddress: base.contributorAddress,
    });

  return {
    deviceAlias: "PHONE-A",
    carrier: undefined,
    ...base,
    measurementRoot,
    signature:
      overrides.signature ?? (await signAsWalletWould(contributor, measurementRoot, base.contributorAddress)),
  } as MeasurementInput;
}

describe("measurement policy", () => {
  it("accepts a fresh timestamp", async () => {
    expect(validateMeasurementPolicy(await validMeasurement())).toEqual({ ok: true });
  });

  it("rejects a stale timestamp", async () => {
    const m = await validMeasurement({ timestampMs: String(Date.now() - 20 * 60 * 1000) });
    expect(validateMeasurementPolicy(m)).toEqual({ ok: false, code: "STALE_MEASUREMENT" });
  });

  it("rejects a timestamp from the future", async () => {
    // Asymmetric on purpose: only a wrong clock or a forged payload produces one.
    const m = await validMeasurement({ timestampMs: String(Date.now() + 10 * 60 * 1000) });
    expect(validateMeasurementPolicy(m)).toEqual({ ok: false, code: "TIMESTAMP_IN_FUTURE" });
  });
});

describe("measurement integrity", () => {
  it("accepts a correctly derived and correctly signed measurement", async () => {
    expect(verifyMeasurementIntegrity(await validMeasurement())).toEqual({ ok: true });
  });

  /**
   * The central claim of the product: the root commits to the payload. Before this check existed
   * the server accepted `measurementRoot` as an opaque string, so any payload could carry any root.
   */
  it("rejects a payload whose values do not hash to the submitted root", async () => {
    const honest = await validMeasurement();
    // Same root and signature, but the reported throughput has been inflated after signing.
    const tampered = { ...honest, downloadMbps: 999 };
    expect(verifyMeasurementIntegrity(tampered)).toEqual({
      ok: false,
      code: "MEASUREMENT_ROOT_MISMATCH",
    });
  });

  it("rejects a tampered latency just as readily", async () => {
    const honest = await validMeasurement();
    expect(verifyMeasurementIntegrity({ ...honest, latencyMs: 1 })).toEqual({
      ok: false,
      code: "MEASUREMENT_ROOT_MISMATCH",
    });
  });

  it("rejects a tampered area — a measurement cannot be moved to another cell", async () => {
    const honest = await validMeasurement();
    const elsewhere = encodeGeohash(51.5074, -0.1278, AREA_PRECISION);
    expect(verifyMeasurementIntegrity({ ...honest, areaHash: elsewhere })).toEqual({
      ok: false,
      code: "MEASUREMENT_ROOT_MISMATCH",
    });
  });

  /**
   * Reward attribution has to be a claim BY the contributor, not an assertion by whoever called the
   * API. Without this, anyone could credit measurements to any address.
   */
  it("rejects a measurement signed by someone other than the named contributor", async () => {
    const other = Wallet.createRandom();
    const m = await validMeasurement();
    const resigned = {
      ...m,
      signature: await signAsWalletWould(other, m.measurementRoot, m.contributorAddress),
    };
    expect(verifyMeasurementIntegrity(resigned)).toEqual({
      ok: false,
      code: "SIGNATURE_MISMATCH",
    });
  });

  it("rejects a measurement whose contributor was swapped after signing", async () => {
    const m = await validMeasurement();
    const stolen = { ...m, contributorAddress: Wallet.createRandom().address };
    // The root commits to the contributor too, so this trips the root check first.
    expect(verifyMeasurementIntegrity(stolen)).toEqual({
      ok: false,
      code: "MEASUREMENT_ROOT_MISMATCH",
    });
  });

  it("rejects a malformed signature without throwing", async () => {
    const m = await validMeasurement({ signature: "0x" + "ab".repeat(32) });
    expect(verifyMeasurementIntegrity(m)).toEqual({ ok: false, code: "SIGNATURE_MALFORMED" });
  });

  it("tolerates a re-cased root and a non-checksummed address", async () => {
    // keccak256 yields lowercase hex, so that is what a correct client signs. A root that arrives
    // upper-cased is still the same commitment, and must not surface as a signature error.
    const m = await validMeasurement();
    const shouted = {
      ...m,
      measurementRoot: "0x" + m.measurementRoot.slice(2).toUpperCase(),
      contributorAddress: m.contributorAddress.toLowerCase(),
    };
    expect(verifyMeasurementIntegrity(shouted)).toEqual({ ok: true });
  });
});

describe("SignalProof source event adapter", () => {
  it("maps the measurement payload to the source contract event shape", () => {
    expect(
      buildSourceMeasurementEvent({
        measurementRoot: "0xroot",
        areaHash,
        sessionHash: "0xsession",
        timestampMs: "1788762000",
        latencyMs: 28,
        downloadMbps: 91,
      }),
    ).toEqual({
      measurementRoot: "0xroot",
      areaHash,
      sessionHash: "0xsession",
      timestamp: 1788762000,
      latencyMs: 28,
      downloadMbps: 91,
    });
  });

  it("reports missing external integration configuration without pretending to be ready", () => {
    const readiness = getIntegrationReadiness();
    expect(readiness.missing).toEqual(
      expect.arrayContaining(["SEPOLIA_RPC_URL", "CREDITCOIN_RPC_URL", "ATTESTCOIN_CHAIN_KEY"]),
    );
    expect(readiness.proofWorkerReady).toBe(false);
  });
});

describe("signature encoding, as browsers actually produce it", () => {
  it("accepts a measurement signed the way personal_sign signs it", async () => {
    // The regression test for the bug that made every "Run a test" submission fail with
    // SIGNATURE_MISMATCH: the client handed the hex root to personal_sign, the wallet signed the
    // 32 decoded bytes, and the gateway verified the 66 ASCII characters.
    const m = await validMeasurement();
    expect(verifyMeasurementIntegrity(m)).toEqual({ ok: true });
  });

  it("refuses a signature over the bare root, in either of its encodings", async () => {
    // Both are what the broken client could have produced. Neither is accepted: the fix removes
    // the ambiguity rather than tolerating both readings of it, so there is exactly one thing a
    // correct client can sign.
    const m = await validMeasurement();
    for (const signature of [
      await contributor.signMessage(m.measurementRoot), // the 66 ASCII characters
      await contributor.signMessage(getBytes(m.measurementRoot)), // the 32 decoded bytes
    ]) {
      expect(verifyMeasurementIntegrity({ ...m, signature })).toEqual({
        ok: false,
        code: "SIGNATURE_MISMATCH",
      });
    }
  });

  it("signs a message no wallet can mistake for hex", async () => {
    // The property the whole fix rests on. A message that parses as hex is decoded to bytes by
    // MetaMask, Rabby, Coinbase and Trust before hashing; one that does not can only be UTF-8.
    const message = buildMeasurementSigningMessage({
      measurementRoot: "0x" + "ab".repeat(32),
      contributorAddress: contributor.address,
    });
    expect(isHexString(message)).toBe(false);
    expect(message.startsWith("0x")).toBe(false);
  });

  it("pins the exact signed text, because a one-character edit breaks every submission", async () => {
    // Once the message is the verification contract, rewording it invalidates in-flight signatures
    // and, if only one side ships, reproduces the original bug exactly. This fails loudly first.
    expect(
      buildMeasurementSigningMessage({
        measurementRoot: "0x" + "cd".repeat(32),
        contributorAddress: "0xAbC0000000000000000000000000000000000123",
      }),
    ).toBe(
      [
        "SignalProof — confirm this measurement",
        "",
        "Signing proves this measurement is yours, so the reward is credited to your address.",
        "It authorises no transaction and cannot move your funds.",
        "",
        `Measurement: 0x${"cd".repeat(32)}`,
        "Contributor: 0xabc0000000000000000000000000000000000123",
      ].join("\n"),
    );
  });

  it("rebuilds the same message from a re-cased root and a non-checksummed address", async () => {
    // The server rebuilds the message from values that travelled over the wire. If casing changed
    // the bytes, a harmlessly re-cased field would read as a forged signature.
    const root = "0x" + "EF".repeat(32);
    expect(
      buildMeasurementSigningMessage({
        measurementRoot: root,
        contributorAddress: contributor.address.toUpperCase().replace("0X", "0x"),
      }),
    ).toBe(
      buildMeasurementSigningMessage({
        measurementRoot: root.toLowerCase(),
        contributorAddress: contributor.address.toLowerCase(),
      }),
    );
  });

  it("does not let a different signer through", async () => {
    const other = new Wallet(
      "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    );
    const m = await validMeasurement();
    const signature = await signAsWalletWould(other, m.measurementRoot, m.contributorAddress);
    expect(verifyMeasurementIntegrity({ ...m, signature })).toEqual({
      ok: false,
      code: "SIGNATURE_MISMATCH",
    });
  });

  it("does not let a signature over a different measurement through", async () => {
    const honest = await validMeasurement();
    const elsewhere = await validMeasurement({ nonce: "nonce-9999-bbbb" });
    const signature = await signAsWalletWould(
      contributor,
      elsewhere.measurementRoot,
      elsewhere.contributorAddress,
    );
    expect(verifyMeasurementIntegrity({ ...honest, signature })).toEqual({
      ok: false,
      code: "SIGNATURE_MISMATCH",
    });
  });

  it("names a bad-checksum address rather than crashing on it", async () => {
    // submitMeasurement is a public procedure and its zod regex admits any mixed-case hex, so an
    // unguarded getAddress turned a malformed field into an unhandled 500.
    const m = await validMeasurement();
    const badChecksum = "0x" + contributor.address.slice(2).toLowerCase().replace(/^./, "A");
    expect(() =>
      verifyMeasurementIntegrity({ ...m, contributorAddress: badChecksum }),
    ).not.toThrow();
  });
});
