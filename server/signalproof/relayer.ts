/**
 * Relayer — pushes a stored measurement's commitment onto Ethereum Sepolia.
 *
 * This is the first of the two chain stages. It takes a row in SUBMITTED, calls
 * SourceBatchRegistry.submitMeasurement, records the resulting transaction hash and block number,
 * and advances the row to AWAITING_ATTESTATION so the proof worker can pick it up.
 */

import { hexlify, isAddress, toUtf8Bytes, zeroPadValue, ZeroAddress } from "ethers";
import type { Measurement } from "../../drizzle/schema";
import { updateMeasurementByRoot } from "./store";
import type { ChainContext } from "./chain";
import { buildSourceMeasurementEvent } from "./worker";

/**
 * Coerce an arbitrary identifier into bytes32.
 *
 * Measurement roots and session hashes arrive as free-form strings from the gateway — sometimes
 * already 0x-prefixed hex, sometimes an opaque token like "a9c-46". Both must land on-chain as a
 * fixed 32-byte word, and the same input must always produce the same word or the destination
 * chain would fail to match the settlement against its own record.
 */
export function toBytes32(value: string): string {
  const trimmed = value.trim();

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();

  if (/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) {
    return zeroPadValue(trimmed.toLowerCase(), 32);
  }

  // Non-hex identifiers are padded from their UTF-8 bytes when short enough to fit losslessly,
  // and hashed otherwise. Truncating would let two distinct areas collide.
  const bytes = toUtf8Bytes(trimmed);
  if (bytes.length <= 32) {
    return zeroPadValue(hexlify(bytes), 32);
  }
  throw new Error(`Identifier too long to encode as bytes32 without loss: ${trimmed.slice(0, 32)}…`);
}

/** Contributor address for a row, falling back to the relayer when the client supplied none. */
export function resolveContributor(row: Measurement, fallback: string): string {
  const candidate = row.contributorAddress?.trim();
  if (candidate && isAddress(candidate) && candidate !== ZeroAddress) return candidate;
  return fallback;
}

export type RelayResult = {
  txHash: string;
  blockNumber: number;
  contributor: string;
};

/**
 * Submit one measurement to the source chain and persist the result.
 *
 * Throws on failure; the caller decides whether that is transient (backoff) or permanent
 * (REJECTED). Nothing here swallows an error, because a swallowed error would leave a row sitting
 * in SUBMITTED forever with no explanation.
 */
export async function relayMeasurement(
  ctx: ChainContext,
  row: Measurement,
): Promise<RelayResult> {
  const event = buildSourceMeasurementEvent({
    measurementRoot: row.measurementRoot,
    areaHash: row.areaHash,
    sessionHash: row.sessionHash,
    timestampMs: row.timestampMs,
    latencyMs: row.latencyMs,
    downloadMbps: row.downloadMbps,
  });

  const contributor = resolveContributor(row, ctx.sepoliaSigner.address);

  // The contract stores epoch SECONDS; the gateway stores milliseconds.
  const timestampSeconds = Math.floor(event.timestamp / 1000);

  // The registry recovers the contributor from this signature itself — the gateway already
  // verified it, but the chain no longer has to take the gateway's word for it.
  const tx = await ctx.sourceRegistry.submitMeasurement(
    toBytes32(event.measurementRoot),
    toBytes32(event.areaHash),
    contributor,
    toBytes32(event.sessionHash),
    BigInt(timestampSeconds),
    BigInt(event.latencyMs),
    BigInt(event.downloadMbps),
    row.signature,
  );

  const receipt = await tx.wait(1);
  if (!receipt || receipt.blockNumber == null) {
    throw new Error(`Transaction ${tx.hash} is not yet mined`);
  }
  if (receipt.status !== 1) {
    throw new Error(`SourceTransactionFailed: source tx ${tx.hash} reverted`);
  }

  await updateMeasurementByRoot(row.measurementRoot, {
    status: "AWAITING_ATTESTATION",
    proofStatus: "SOURCE_TX_SENT",
    contributorAddress: contributor,
    sourceTxHash: receipt.hash,
    sourceBlockNumber: String(receipt.blockNumber),
    chainKey: ctx.chainKey,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
  });

  console.log(
    `[SignalProof] relayed ${row.measurementRoot} → Sepolia tx ${receipt.hash} @ block ${receipt.blockNumber}`,
  );

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, contributor };
}
