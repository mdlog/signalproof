/**
 * Proof worker — the asynchronous half of the chain pipeline.
 *
 * Runs in-process on a 15 second interval. Each tick does a bounded amount of work and returns;
 * it never blocks waiting for an attestation.
 *
 * That last point is the main design decision here. Gluwa's reference implementation calls
 * `proofBuilder.waitUntilHeightAttested(...)`, which blocks for the full 8–20 minute attestation
 * window. Inside a queue worker that would freeze every other measurement behind the first one.
 * Instead we read the latest attested height once per tick — a single eth_call — and only advance
 * the rows that have already cleared it.
 */

import type { LogDescription } from "ethers";
import type { Measurement } from "../../drizzle/schema";
import { claimWorkableMeasurements, getMeasurementByRoot, insertMeasurement, updateMeasurementByRoot } from "./store";
import { getChainContext, getLatestAttestedHeight, type ChainContext } from "./chain";
import { getOnchainSnapshot } from "./chainRead";
import { relayMeasurement } from "./relayer";
import {
  MAX_BATCH_ENTRIES,
  backoffMs,
  fallbackBatchGasLimit,
  fallbackGasLimit,
  getIntegrationReadiness,
  hasExhaustedAttempts,
  isPermanentFailure,
  toRejectionCode,
  withGasBuffer,
  parseProofWorkerMode,
  shouldAutoSettle,
} from "./worker";
import { buildExecuteArgs } from "./proofView";
import { ENV } from "../_core/env";

export const TICK_INTERVAL_MS = 15_000;
const BATCH_SIZE = 10;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export type WorkerHealth = {
  mode: "full" | "relay-only";
  running: boolean;
  lastTickAt: number | null;
  lastResult: { relayed: number; settled: number; recovered: number } | null;
  lastError: string | null;
  consecutiveFailures: number;
};

/** What the ops panel reads. Updated only by the interval below, so it reflects real ticks. */
export const workerHealth: WorkerHealth = {
  mode: "full",
  running: false,
  lastTickAt: null,
  lastResult: null,
  lastError: null,
  consecutiveFailures: 0,
};

/**
 * Record a failure and decide whether the row can be retried.
 *
 * A permanent failure — a forged emitter, an already-settled root, a reverted source transaction —
 * is terminal by nature, so retrying it would only burn gas. Everything else backs off.
 */
async function recordFailure(row: Measurement, error: unknown): Promise<void> {
  const code = toRejectionCode(error);
  const attempts = row.attempts + 1;
  const terminal = isPermanentFailure(code) || hasExhaustedAttempts(attempts);

  if (terminal) {
    await updateMeasurementByRoot(row.measurementRoot, {
      status: "REJECTED",
      proofStatus: "FAILED",
      rejectionCode: code.slice(0, 64),
      attempts,
      nextAttemptAt: null,
      lastError: code,
    });
    console.warn(`[SignalProof] ${row.measurementRoot} REJECTED after ${attempts} attempt(s): ${code}`);
    return;
  }

  const delay = backoffMs(attempts);
  await updateMeasurementByRoot(row.measurementRoot, {
    attempts,
    nextAttemptAt: new Date(Date.now() + delay),
    lastError: code,
  });
  console.warn(
    `[SignalProof] ${row.measurementRoot} attempt ${attempts} failed (${code}); retrying in ${delay / 1000}s`,
  );
}

/**
 * Rebuild pending work from chain state.
 *
 * The queue lives in memory when no database is configured, so a restart used to strand every
 * measurement that had reached Sepolia but not yet settled: the chain still showed it as
 * AWAITING_ATTESTATION, and nothing was left to advance it. Two measurements sat that way for
 * half an hour before this was noticed.
 *
 * The chains are the source of truth, so the queue is recoverable from them. A measurement that
 * has a MeasurementSubmitted on Sepolia and no matching MeasurementVerified on Creditcoin is, by
 * definition, still owed a proof — regardless of what this process remembers.
 */
export async function reconcileFromChain(ctx: ChainContext): Promise<number> {
  const snapshot = await getOnchainSnapshot(true);
  if (!snapshot.configured || snapshot.error) return 0;

  let recovered = 0;
  for (const m of snapshot.measurements) {
    if (m.status === "SETTLED" || !m.sourceTxHash || m.sourceBlockNumber == null) continue;
    if (await getMeasurementByRoot(m.measurementRoot)) continue;

    // Only the fields the settlement path actually reads. The rest were never recoverable from
    // chain state and are not needed to finish the proof.
    await insertMeasurement({
      measurementRoot: m.measurementRoot,
      deviceAlias: "recovered-from-chain",
      areaHash: m.areaHash,
      networkType: "unreported",
      latencyMs: m.latencyMs ?? 0,
      downloadMbps: m.downloadMbps ?? 0,
      uploadMbps: 0,
      timestampMs: String((m.timestamp ?? Math.floor(Date.now() / 1000)) * 1000),
      nonce: `recovered-${m.measurementRoot.slice(2, 18)}`,
      sessionHash: m.measurementRoot,
      signature: m.measurementRoot,
      status: "AWAITING_ATTESTATION",
      proofStatus: "SOURCE_TX_SENT",
      contributorAddress: m.contributor,
      sourceTxHash: m.sourceTxHash,
      sourceBlockNumber: String(m.sourceBlockNumber),
      chainKey: ctx.chainKey,
    });
    recovered++;
  }

  if (recovered > 0) {
    console.log(`[SignalProof] recovered ${recovered} unsettled measurement(s) from chain state`);
  }
  return recovered;
}

/** Stage 1 — SUBMITTED rows get their commitment pushed to Sepolia. */
async function processSubmitted(ctx: ChainContext): Promise<number> {
  const rows = await claimWorkableMeasurements(["SUBMITTED"], BATCH_SIZE);
  let advanced = 0;

  for (const row of rows) {
    try {
      await relayMeasurement(ctx, row);
      advanced++;
    } catch (error) {
      await recordFailure(row, error);
    }
  }
  return advanced;
}

/**
 * Stage 2 — AWAITING_ATTESTATION rows whose source block is attested get proven and settled.
 *
 * The attested height is read once and reused for the whole tick: it changes roughly every two
 * minutes, so re-reading it per row would be pure overhead.
 *
 * Proofs are fetched first, for every ready row, before anything is sent. That ordering is what
 * makes batching possible at all — the grouping key is a property of the proof, not of the row.
 */
async function processAwaitingAttestation(ctx: ChainContext): Promise<number> {
  const rows = await claimWorkableMeasurements(["AWAITING_ATTESTATION"], BATCH_SIZE);
  if (rows.length === 0) return 0;

  const attestedHeight = await getLatestAttestedHeight(ctx);
  const prepared: PreparedProof[] = [];

  for (const row of rows) {
    const sourceBlock = Number(row.sourceBlockNumber);

    if (!Number.isFinite(sourceBlock)) {
      await recordFailure(row, new Error("Missing sourceBlockNumber on AWAITING_ATTESTATION row"));
      continue;
    }

    // Not yet attested. Not a failure — just not this tick. Leave attempts untouched so the
    // backoff counter is never consumed by ordinary waiting.
    if (attestedHeight < sourceBlock) continue;

    try {
      prepared.push({ row, proof: await fetchProof(ctx, row) });
    } catch (error) {
      await recordFailure(row, error);
    }
  }
  if (prepared.length === 0) return 0;

  // Drop anything either route has already settled, BEFORE deciding how to send it.
  //
  // The two settlement contracts keep separate `settled` maps and both accept anyone's proof, so a
  // measurement one route has already paid for is still settleable on the other. Nothing about that
  // second settlement is invalid — it is the same genuine work paid for twice. The batch contract
  // refuses it on chain when a sibling is configured; this is the belt to that braces, and it also
  // stops the worker wasting a transaction discovering the refusal.
  const unsettled: PreparedProof[] = [];
  for (const entry of prepared) {
    if (await markIfAlreadySettled(ctx, entry.row)) continue;
    unsettled.push(entry);
  }
  if (unsettled.length === 0) return 0;

  let advanced = 0;
  for (const group of groupByContinuityProof(unsettled)) {
    if (ctx.batchSettlement && group.length > 1) {
      try {
        advanced += await settleBatch(ctx, group.slice(0, MAX_BATCH_ENTRIES));
        continue;
      } catch (error) {
        // A reverted batch settles nothing — it is atomic — so every row in it is still owed a
        // proof and the single-proof path can take them one at a time. Batching may cost a wasted
        // transaction; it can never lose a measurement.
        console.warn(
          `[SignalProof] batch of ${group.length} failed (${toRejectionCode(error)}); falling back to single settlement`,
        );
      }
    }

    for (const entry of group) {
      try {
        await settleMeasurement(ctx, entry.row, entry.proof);
        advanced++;
      } catch (error) {
        await recordFailure(entry.row, error);
      }
    }
  }
  return advanced;
}

/**
 * Record a row as settled when a settlement contract already shows it as such, and report it.
 *
 * @returns true when the row was closed out here and needs no transaction.
 */
async function markIfAlreadySettled(ctx: ChainContext, row: Measurement): Promise<boolean> {
  for (const contract of ctx.settlementRoutes) {
    let settled = false;
    try {
      settled = (await contract.settled(row.measurementRoot)) as boolean;
    } catch {
      continue; // an unreadable route is not evidence of anything
    }
    if (!settled) continue;

    let reward: string | null = null;
    try {
      reward = String((await contract.rewardAmount()) as bigint);
    } catch {
      /* the reward is decoration here; the settled flag is the fact */
    }

    await updateMeasurementByRoot(row.measurementRoot, {
      status: "SETTLED",
      proofStatus: "VERIFIED",
      rewardAmount: reward,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    console.log(
      `[SignalProof] ${row.measurementRoot} was already settled at ${await contract.getAddress()}; not paying twice`,
    );
    return true;
  }
  return false;
}

type ProofData = Awaited<ReturnType<ChainContext["proofBuilder"]["getProof"]>>["data"];
export type PreparedProof = { row: Measurement; proof: NonNullable<ProofData> };

/** Fetch and unwrap an inclusion proof, recording that the row reached PROOF_FETCHED. */
async function fetchProof(ctx: ChainContext, row: Measurement): Promise<NonNullable<ProofData>> {
  const txHash = row.sourceTxHash;
  if (!txHash) throw new Error("Missing sourceTxHash");

  const proofResult = await ctx.proofBuilder.getProof(txHash);

  // getProof returns ProofResult, NOT ContinuityResponse. Skipping this unwrap leaves
  // proofData.chainKey undefined at runtime while still type-checking against the wrong shape.
  if (!proofResult.success || !proofResult.data) {
    throw new Error(`Failed to generate proof: ${proofResult.error ?? "unknown"}`);
  }
  const proofData = proofResult.data;

  await updateMeasurementByRoot(row.measurementRoot, {
    proofStatus: "PROOF_FETCHED",
    headerNumber: String(proofData.headerNumber),
  });
  return proofData;
}

/**
 * Split prepared rows into sets that can legitimately share one continuity proof.
 *
 * The batch overload carries exactly ONE continuity proof for the whole call, and that is where
 * the saving comes from — a continuity proof walks the attestation chain back to a checkpoint and
 * is by far the most expensive part of a verification. But it is only valid for the range it was
 * built over, so rows are grouped by the proof they were actually issued with rather than by
 * anything convenient like arrival order. Two rows share a batch only when the proof service
 * handed them the identical proof; otherwise each settles on its own.
 */
export function groupByContinuityProof(prepared: PreparedProof[]): PreparedProof[][] {
  const groups = new Map<string, PreparedProof[]>();

  for (const entry of prepared) {
    const continuity = entry.proof.continuityProof;
    const key = [
      entry.proof.chainKey,
      continuity.lowerEndpointDigest,
      (continuity.roots ?? []).join(","),
    ].join("|");

    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()];
}

/**
 * Settle many measurements in one transaction against SignalProofBatchSettlement.
 *
 * @returns how many rows this call actually moved to SETTLED.
 */
export async function settleBatch(ctx: ChainContext, entries: PreparedProof[]): Promise<number> {
  const batch = ctx.batchSettlement;
  if (!batch) throw new Error("BATCH_SETTLEMENT_ADDRESS is not configured");
  if (entries.length === 0) return 0;

  const shared = entries[0].proof.continuityProof;
  const continuityRoots = shared.roots ?? [];
  const args = [
    entries[0].proof.chainKey,
    entries.map((e) => e.proof.headerNumber),
    entries.map((e) => e.proof.txBytes),
    entries.map((e) => ({
      root: e.proof.merkleProof.root,
      siblings: e.proof.merkleProof.siblings,
    })),
    { lowerEndpointDigest: shared.lowerEndpointDigest, roots: continuityRoots },
  ] as const;

  let gasLimit: bigint;
  try {
    gasLimit = withGasBuffer(await batch.executeBatch.estimateGas(...args));
  } catch {
    gasLimit = fallbackBatchGasLimit(entries.length, continuityRoots.length);
  }

  const tx = await batch.executeBatch(...args, { gasLimit });
  for (const entry of entries) {
    await updateMeasurementByRoot(entry.row.measurementRoot, {
      proofStatus: "SUBMITTED_TO_CREDITCOIN",
      creditcoinTxHash: tx.hash,
    });
  }

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Creditcoin batch tx ${tx.hash} reverted`);
  }

  // Which measurements the call actually settled is read from the receipt, not assumed. The
  // contract skips entries that are stale or already settled rather than reverting on them, so a
  // successful batch does not imply every entry in it was paid.
  const rewardByRoot = new Map<string, string>();
  for (const log of receipt.logs) {
    let parsed: LogDescription | null = null;
    try {
      parsed = batch.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (parsed?.name === "MeasurementVerified") {
      rewardByRoot.set(String(parsed.args.measurementRoot), String(parsed.args.rewardAmount));
    }
    if (parsed?.name === "ForeignLogSkipped") {
      console.warn(
        `[SignalProof] batch ${receipt.hash} contained a lookalike log from ${String(parsed.args.actualEmitter)}`,
      );
    }
  }

  let settledCount = 0;
  for (const entry of entries) {
    const root = entry.row.measurementRoot;
    const reward = rewardByRoot.get(root);

    if (reward === undefined) {
      // In the batch but not in the events: skipped, not settled. Ask the contract which it was
      // rather than guessing, because "already settled" and "too old" want opposite handling.
      const alreadySettled = (await batch.settled(root)) as boolean;
      await recordFailure(
        entry.row,
        new Error(alreadySettled ? "MeasurementAlreadySettled" : "MeasurementTooOld"),
      );
      continue;
    }

    await updateMeasurementByRoot(root, {
      status: "SETTLED",
      proofStatus: "VERIFIED",
      creditcoinTxHash: receipt.hash,
      rewardAmount: reward,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    settledCount++;
  }

  console.log(
    `[SignalProof] batch settled ${settledCount}/${entries.length} measurement(s) in one proof → Creditcoin tx ${receipt.hash}`,
  );
  return settledCount;
}

/**
 * Fetch the inclusion proof and submit it to the settlement contract on Creditcoin.
 *
 * @param prefetched a proof already fetched by the batch path, to avoid asking for it twice.
 */
export async function settleMeasurement(
  ctx: ChainContext,
  row: Measurement,
  prefetched?: NonNullable<ProofData>,
): Promise<string> {
  const proofData = prefetched ?? (await fetchProof(ctx, row));

  // The same tuple the dashboard's proof inspector shows and the self-settle button sends.
  const args = buildExecuteArgs(proofData);
  const continuityRoots = args[7];

  // estimateGas fails against precompiles even when the call would succeed — pallet-evm does not
  // propagate revert reasons in estimation mode. The manual fallback is required, not defensive.
  let gasLimit: bigint;
  try {
    const estimated = await ctx.settlement.execute.estimateGas(...args);
    gasLimit = withGasBuffer(estimated);
  } catch {
    gasLimit = fallbackGasLimit(continuityRoots.length);
  }

  const tx = await ctx.settlement.execute(...args, { gasLimit });

  await updateMeasurementByRoot(row.measurementRoot, {
    proofStatus: "SUBMITTED_TO_CREDITCOIN",
    creditcoinTxHash: tx.hash,
  });

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Creditcoin settlement tx ${tx.hash} reverted`);
  }

  // Read the event from the receipt rather than a filter. Filter-based polling breaks against RPC
  // nodes that expire filters ("Filter id does not exist").
  const verified = receipt.logs
    .map((log: { topics: readonly string[]; data: string }) => {
      try {
        return ctx.settlement.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed: LogDescription | null) => parsed?.name === "MeasurementVerified");

  const rewardAmount = verified ? String(verified.args.rewardAmount) : null;

  await updateMeasurementByRoot(row.measurementRoot, {
    status: "SETTLED",
    proofStatus: "VERIFIED",
    creditcoinTxHash: receipt.hash,
    rewardAmount,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
  });

  console.log(
    `[SignalProof] settled ${row.measurementRoot} → Creditcoin tx ${receipt.hash}` +
      (rewardAmount ? ` (reward ${rewardAmount} wei)` : ""),
  );

  return receipt.hash;
}

/** One pass over the queue. Exported so tests and the e2e harness can drive it deterministically. */
let ticksSinceReconcile = Number.MAX_SAFE_INTEGER; // force a reconcile on the first tick
const RECONCILE_EVERY_TICKS = 20; // ~5 minutes at a 15 s tick

export async function tick(): Promise<{ relayed: number; settled: number; recovered: number }> {
  const ctx = await getChainContext();

  let recovered = 0;
  if (++ticksSinceReconcile >= RECONCILE_EVERY_TICKS) {
    ticksSinceReconcile = 0;
    try {
      recovered = await reconcileFromChain(ctx);
    } catch (error) {
      console.warn("[SignalProof] reconcile failed:", toRejectionCode(error));
    }
  }

  const relayed = await processSubmitted(ctx);
  // Relay-only: measurements reach Sepolia and wait there; execute() is the contributor's to send.
  const settled = shouldAutoSettle(parseProofWorkerMode(ENV.proofWorkerMode))
    ? await processAwaitingAttestation(ctx)
    : 0;
  return { relayed, settled, recovered };
}

/**
 * Start the worker, if and only if the chain integration is fully configured.
 *
 * When it is not, the gateway keeps accepting and storing measurements as SUBMITTED and the UI
 * reports exactly that. Nothing pretends a measurement was verified when no proof was ever built.
 */
export function startProofWorker(): boolean {
  const readiness = getIntegrationReadiness();

  if (!readiness.proofWorkerReady) {
    console.warn(
      `[SignalProof] proof worker not started — missing env: ${readiness.missing.join(", ")}. ` +
        `Measurements will be stored as SUBMITTED and shown as unverified.`,
    );
    return false;
  }

  if (timer) return true;

  if (readiness.settleMode === "relay-only") {
    console.log(
      "[SignalProof] PROOF_WORKER_MODE=relay-only — measurements are relayed to Sepolia but not settled; contributors settle from their own wallet.",
    );
  }

  workerHealth.mode = readiness.settleMode;
  workerHealth.running = true;

  timer = setInterval(() => {
    if (ticking) return; // never overlap ticks
    ticking = true;
    tick()
      .then(({ relayed, settled, recovered }) => {
        workerHealth.lastTickAt = Date.now();
        workerHealth.lastResult = { relayed, settled, recovered };
        workerHealth.lastError = null;
        workerHealth.consecutiveFailures = 0;
        if (relayed || settled || recovered) {
          console.log(
            `[SignalProof] tick — relayed ${relayed}, settled ${settled}` +
              (recovered ? `, recovered ${recovered}` : ""),
          );
        }
      })
      .catch((error) => {
        workerHealth.lastTickAt = Date.now();
        workerHealth.lastError = toRejectionCode(error);
        workerHealth.consecutiveFailures += 1;
        console.error("[SignalProof] tick failed:", toRejectionCode(error));
      })
      .finally(() => {
        ticking = false;
      });
  }, TICK_INTERVAL_MS);

  // Do not hold the event loop open on shutdown.
  timer.unref?.();

  console.log(`[SignalProof] proof worker started (tick ${TICK_INTERVAL_MS / 1000}s)`);
  return true;
}

export function stopProofWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  workerHealth.running = false;
}
