/**
 * Pure, dependency-free helpers shared by the relayer and the proof worker.
 *
 * Everything here is deliberately side-effect free so it can be unit tested without a database,
 * an RPC endpoint, or any secret. The parts that touch the network live in chain.ts, relayer.ts
 * and proofWorker.ts.
 */

import { ENV } from "../_core/env";

/** Payload shape the source-chain contract event is built from. */
export type SourceMeasurementInput = {
  measurementRoot: string;
  areaHash: string;
  sessionHash: string;
  /** Epoch milliseconds, carried as a string because MySQL stores it as varchar(32). */
  timestampMs: string;
  latencyMs: number;
  downloadMbps: number;
};

/** Argument shape for SourceBatchRegistry.MeasurementSubmitted. */
export type SourceMeasurementEvent = {
  measurementRoot: string;
  areaHash: string;
  sessionHash: string;
  timestamp: number;
  latencyMs: number;
  downloadMbps: number;
};

/**
 * Map a stored measurement onto the source-chain event shape.
 *
 * `timestampMs` is narrowed to a number here rather than at the DB boundary because the on-chain
 * event takes a uint256 and Solidity has no notion of a numeric string.
 */
export function buildSourceMeasurementEvent(
  input: SourceMeasurementInput,
): SourceMeasurementEvent {
  return {
    measurementRoot: input.measurementRoot,
    areaHash: input.areaHash,
    sessionHash: input.sessionHash,
    timestamp: Number(input.timestampMs),
    latencyMs: input.latencyMs,
    downloadMbps: input.downloadMbps,
  };
}

/**
 * Environment variables the chain path cannot run without.
 *
 * Deliberately ordered by the stage that needs them, so a partially configured deployment reads
 * as "relayer ready, proof worker not" rather than as an undifferentiated wall of missing keys.
 */
export const REQUIRED_CHAIN_ENV = [
  "SEPOLIA_RPC_URL",
  "SEPOLIA_RELAYER_PRIVATE_KEY",
  "SOURCE_BATCH_REGISTRY_ADDRESS",
  "CREDITCOIN_RPC_URL",
  "CREDITCOIN_RELAYER_PRIVATE_KEY",
  "SETTLEMENT_CONTRACT_ADDRESS",
  "ATTESTCOIN_CHAIN_KEY",
  "ATTESTCOIN_PROOF_SERVICE_URL",
] as const;

export type ChainEnvKey = (typeof REQUIRED_CHAIN_ENV)[number];

const ENV_LOOKUP: Record<ChainEnvKey, () => string> = {
  SEPOLIA_RPC_URL: () => ENV.sepoliaRpcUrl,
  SEPOLIA_RELAYER_PRIVATE_KEY: () => ENV.sepoliaRelayerPrivateKey,
  SOURCE_BATCH_REGISTRY_ADDRESS: () => ENV.sourceBatchRegistryAddress,
  CREDITCOIN_RPC_URL: () => ENV.creditcoinRpcUrl,
  CREDITCOIN_RELAYER_PRIVATE_KEY: () => ENV.creditcoinRelayerPrivateKey,
  SETTLEMENT_CONTRACT_ADDRESS: () => ENV.settlementContractAddress,
  ATTESTCOIN_CHAIN_KEY: () => ENV.attestcoinChainKey,
  ATTESTCOIN_PROOF_SERVICE_URL: () => ENV.attestcoinProofServiceUrl,
};

export type IntegrationReadiness = {
  /** Env keys that are absent or blank. */
  missing: ChainEnvKey[];
  /** True when a measurement can be relayed to the source chain. */
  relayerReady: boolean;
  /** True when a relayed measurement can be proven and settled on Creditcoin. */
  proofWorkerReady: boolean;
};

/**
 * Report what the chain integration can and cannot do right now.
 *
 * The gateway calls this at boot. When the proof worker is not ready it is simply not started —
 * measurements still persist as SUBMITTED and the UI shows that honestly. Nothing anywhere
 * claims a measurement was verified when no proof was ever produced.
 */
export function getIntegrationReadiness(): IntegrationReadiness {
  const missing = REQUIRED_CHAIN_ENV.filter((key) => !ENV_LOOKUP[key]().trim());
  const has = (key: ChainEnvKey) => !missing.includes(key);

  const relayerReady =
    has("SEPOLIA_RPC_URL") &&
    has("SEPOLIA_RELAYER_PRIVATE_KEY") &&
    has("SOURCE_BATCH_REGISTRY_ADDRESS");

  return {
    missing,
    relayerReady,
    proofWorkerReady: relayerReady && missing.length === 0,
  };
}

/** Statuses in the order the pipeline advances through them. */
export const MEASUREMENT_FLOW = [
  "SUBMITTED",
  "AWAITING_ATTESTATION",
  "PROOF_VERIFIED",
  "SETTLED",
] as const;

export type FlowStatus = (typeof MEASUREMENT_FLOW)[number];
export type MeasurementStatus = FlowStatus | "REJECTED";

/**
 * Whether a status transition is legal.
 *
 * The pipeline only ever moves forward one step, or sideways into REJECTED. Encoding this as data
 * rather than as scattered `if` statements means the worker cannot silently skip AWAITING_ATTESTATION
 * and present an unproven measurement as settled.
 */
export function canTransition(from: MeasurementStatus, to: MeasurementStatus): boolean {
  // Terminal states first. SETTLED means the reward is already accrued on Creditcoin, so nothing
  // — including a later failure elsewhere in the pipeline — may walk it back to REJECTED.
  if (from === "REJECTED" || from === "SETTLED") return false;
  if (to === "REJECTED") return true;

  const fromIndex = MEASUREMENT_FLOW.indexOf(from as FlowStatus);
  const toIndex = MEASUREMENT_FLOW.indexOf(to as FlowStatus);
  if (fromIndex === -1 || toIndex === -1) return false;

  return toIndex === fromIndex + 1;
}

/** Backoff schedule for transient failures, in milliseconds. */
export const BACKOFF_SCHEDULE_MS = [15_000, 60_000, 300_000, 900_000, 1_800_000] as const;
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

/**
 * Delay before the next retry. Saturates at the last step rather than growing without bound, so a
 * stuck row is retried predictably instead of drifting into never being retried at all.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return BACKOFF_SCHEDULE_MS[0];
  const index = Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index];
}

export function hasExhaustedAttempts(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/**
 * Reduce an arbitrary thrown value to a short, stable code safe to store and show.
 *
 * Chain errors routinely carry the full RPC request — including, on the relayer path, the signed
 * transaction. Storing that verbatim would put transaction internals in the database and then on
 * screen, so this deliberately keeps only a bounded prefix of the message.
 */
export function toRejectionCode(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

  const known: Array<[RegExp, string]> = [
    [/Query already processed/i, "QUERY_ALREADY_PROCESSED"],
    [/Proof of inclusion verification failed/i, "PROOF_VERIFICATION_FAILED"],
    [/WrongEmitter/i, "WRONG_EMITTER"],
    [/SourceTransactionFailed/i, "SOURCE_TX_FAILED"],
    [/MeasurementAlreadySettled/i, "ALREADY_SETTLED"],
    [/MeasurementTooOld/i, "MEASUREMENT_TOO_OLD"],
    [/MeasurementInFuture/i, "MEASUREMENT_IN_FUTURE"],
    [/NoMeasurementLog/i, "NO_MEASUREMENT_LOG"],
    [/AlreadyRegistered/i, "DUPLICATE_MEASUREMENT_ROOT"],
    // The registry is gated on one relayer. This means the gateway is signing with a key the
    // deployed registry does not accept — a configuration fault, not a bad measurement, and it
    // will hit every submission until the key or the registry changes.
    [/NotAuthorised/i, "RELAYER_NOT_AUTHORISED"],
    [/NoMeasurementSettled/i, "BATCH_SETTLED_NOTHING"],
    [/insufficient funds/i, "RELAYER_OUT_OF_GAS_FUNDS"],
    [/timeout|ETIMEDOUT|ECONNABORTED/i, "TIMEOUT"],
    [/ENOTFOUND|ECONNREFUSED|network/i, "NETWORK_UNAVAILABLE"],
  ];

  for (const [pattern, code] of known) {
    if (pattern.test(raw)) return code;
  }
  return `UNKNOWN: ${raw.slice(0, 120)}`;
}

/** Errors that will never succeed on retry. */
export function isPermanentFailure(code: string): boolean {
  return [
    "QUERY_ALREADY_PROCESSED",
    "WRONG_EMITTER",
    "SOURCE_TX_FAILED",
    "ALREADY_SETTLED",
    "MEASUREMENT_TOO_OLD",
    "MEASUREMENT_IN_FUTURE",
    "NO_MEASUREMENT_LOG",
    "DUPLICATE_MEASUREMENT_ROOT",
    "RELAYER_NOT_AUTHORISED",
  ].includes(code);
}

/**
 * Gas limit for a call against the BlockProver precompile.
 *
 * `estimateGas` fails against precompiles even when the call would succeed — pallet-evm does not
 * propagate revert reasons in estimation mode — so a manual fallback is mandatory, not defensive.
 * The 35% buffer and the arithmetic below are taken from Gluwa's reference implementation.
 */
export const GAS_BUFFER_MULTIPLIER = 135n;

export function fallbackGasLimit(continuityRootCount: number): bigint {
  const roots = continuityRootCount > 0 ? continuityRootCount : 1;
  return BigInt(21_000 + roots * 5_000 + 20_000);
}

export function withGasBuffer(estimated: bigint): bigint {
  return (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
}

/**
 * Gas limit for a batch settlement, when estimation fails.
 *
 * `fallbackGasLimit` above models a single proof against the precompile and is nowhere near enough
 * for a batch: the decoder allocates memory it never reclaims, so cost per entry climbs with batch
 * size rather than staying flat. Measured against the real contract (contracts/test/BatchGasProbe):
 *
 *     n=10   482k     48.2k/entry
 *     n=50   2.47M    49.4k/entry
 *     n=200  12.5M    62.4k/entry     marginal cost 71.2k by this point
 *
 * The quadratic term is the memory expansion. 90k per entry sits above the marginal cost at every
 * size we allow, and the caller caps entries well below the block limit regardless.
 */
export const BATCH_GAS_PER_ENTRY = 90_000n;

export function fallbackBatchGasLimit(entryCount: number, continuityRootCount: number): bigint {
  const roots = continuityRootCount > 0 ? continuityRootCount : 1;
  const entries = entryCount > 0 ? BigInt(entryCount) : 1n;
  return 100_000n + entries * BATCH_GAS_PER_ENTRY + BigInt(roots) * 5_000n;
}

/**
 * Largest batch the worker will assemble.
 *
 * Measured ceiling is far higher — 600 single-log transactions still fit in a 75,000,000-gas CC3
 * block — but a batch is all-or-nothing: one entry the precompile rejects costs the whole call.
 * Smaller batches lose a little of the saving and bound the blast radius of a bad entry.
 */
export const MAX_BATCH_ENTRIES = 50;
