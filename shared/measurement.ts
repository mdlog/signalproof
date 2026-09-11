/**
 * Canonical measurement payload and the derivation of `measurementRoot`.
 *
 * This file is shared by the client and the server on purpose. `measurementRoot` is the word that
 * lands on Ethereum Sepolia and is later matched on Creditcoin, so if the two sides ever computed
 * it differently the settlement would never line up with the record. One implementation, imported
 * by both, is the only way to guarantee that.
 *
 * Changing the field list or the ordering changes every future root. Roots already settled on-chain
 * were computed with this exact shape — treat it as frozen.
 */

import { keccak256, toUtf8Bytes } from "ethers";

/** The fields that are committed to. Order is part of the contract. */
export type CanonicalMeasurement = {
  /** Geohash, precision 6. See shared/geohash.ts. */
  areaHash: string;
  /** Browser's effective connection class, or null when the browser does not expose one. */
  networkType: string | null;
  latencyMs: number;
  downloadMbps: number;
  uploadMbps: number;
  packetLossBps: number;
  /** Epoch milliseconds, 13 digits. */
  timestampMs: string;
  nonce: string;
  sessionHash: string;
  /** EVM address that accrues the reward. */
  contributorAddress: string;
};

/**
 * Deterministic serialisation.
 *
 * Explicit key order rather than `JSON.stringify(obj)`, because object key order is an
 * implementation detail and a root that depends on it would be unreproducible across engines.
 */
export function canonicalize(m: CanonicalMeasurement): string {
  return JSON.stringify([
    m.areaHash,
    m.networkType ?? "",
    m.latencyMs,
    m.downloadMbps,
    m.uploadMbps,
    m.packetLossBps,
    m.timestampMs,
    m.nonce,
    m.sessionHash,
    m.contributorAddress.toLowerCase(),
  ]);
}

/** keccak256 of the canonical form — a 0x-prefixed 32-byte hex string. */
export function deriveMeasurementRoot(m: CanonicalMeasurement): string {
  return keccak256(toUtf8Bytes(canonicalize(m)));
}

/**
 * The exact text a contributor signs.
 *
 * WHY THIS IS NOT JUST THE ROOT.
 *
 * `personal_sign` takes its message parameter as HEX — go-ethereum types it `hexutil.Bytes`, and
 * MetaMask, Rabby, Coinbase Wallet and Trust all hex-decode a 0x-prefixed message before applying
 * the EIP-191 prefix. Handing them the bare root meant the wallet signed the 32 decoded bytes
 * (prefix `\x19Ethereum Signed Message:\n32`) while the gateway verified the 66 ASCII characters
 * (`...\n66`). Two different digests, so recovery returned an unrelated address and every single
 * browser submission was refused as SIGNATURE_MISMATCH. No wallet does it the other way, so there
 * was nothing to wait for.
 *
 * A message that cannot be parsed as hex has exactly one possible reading: UTF-8. That removes the
 * fork rather than tolerating it. It also means the wallet dialog shows a sentence instead of an
 * opaque hex blob — MetaMask special-cases 32-byte messages and renders them as raw hex — so the
 * user can actually see what they are agreeing to.
 *
 * Built here, imported by both sides, for the same reason `deriveMeasurementRoot` is: two
 * implementations of the same string is the bug this function exists to fix.
 *
 * The wording is load-bearing. Changing a character invalidates every in-flight signature, and
 * changing only one side reproduces this bug exactly — shared/measurement.test.ts pins the output.
 */
export function buildMeasurementSigningMessage(args: {
  measurementRoot: string;
  contributorAddress: string;
}): string {
  // Normalised, so a re-cased root or a non-checksummed address on the wire still rebuilds the
  // identical bytes the wallet signed. keccak256 emits lowercase hex; canonicalize already
  // lowercases the address.
  const root = args.measurementRoot.toLowerCase();
  const contributor = args.contributorAddress.toLowerCase();

  return [
    "SignalProof — confirm this measurement",
    "",
    "Signing proves this measurement is yours, so the reward is credited to your address.",
    "It authorises no transaction and cannot move your funds.",
    "",
    `Measurement: ${root}`,
    `Contributor: ${contributor}`,
  ].join("\n");
}

/**
 * A per-tab session identifier, hashed.
 *
 * The raw id never leaves the tab; only its hash is sent, so a measurement can be tied to a session
 * for replay protection without the session id itself becoming a tracking token on the wire.
 */
export function deriveSessionHash(rawSessionId: string): string {
  return keccak256(toUtf8Bytes(`signalproof-session:${rawSessionId}`));
}

/** Random nonce, long enough for the gateway's `min(8)` and unique per measurement. */
export function makeNonce(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for environments without randomUUID; same length class, same uniqueness properties.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
