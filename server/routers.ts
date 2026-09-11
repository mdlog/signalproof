import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { listCoverage, listProofQueue, listPublicMeasurements } from "./db";
import {
  getMeasurementByRoot,
  getPublicMeasurementByRoot,
  insertMeasurement,
  isPersistent,
} from "./signalproof/store";
import { getIntegrationReadiness } from "./signalproof/worker";
import {
  getAttestationProgress,
  getContributorStats,
  getOnchainSnapshot,
  getRewardsFor,
} from "./signalproof/chainRead";
import { AREA_PRECISION, isGeohash } from "@shared/geohash";
import { buildMeasurementSigningMessage, deriveMeasurementRoot } from "@shared/measurement";
import { getAddress, verifyMessage } from "ethers";
import { MEASUREMENT_RATE_LIMIT, measurementRateLimit } from "./signalproof/rateLimit";
import { getProofSummary } from "./signalproof/proofRead";

/**
 * Clock skew we tolerate on a client-supplied timestamp.
 *
 * Asymmetric on purpose. A measurement may legitimately be up to 15 minutes old by the time it
 * reaches us, but it can never legitimately be from the future — only a wrong device clock or a
 * forged payload produces that. The previous implementation used Math.abs, which accepted
 * timestamps 15 minutes ahead just as readily as 15 minutes behind.
 */
const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_AHEAD_MS = 60 * 1000;

const measurementInput = z.object({
  deviceAlias: z.string().trim().min(2).max(64),
  // A geohash, not a free-form label. This is the privacy control, enforced at the gateway rather
  // than left to client goodwill: a geohash is coarse by construction and decodable, so the
  // coverage map can place an area honestly without anyone transmitting a precise coordinate.
  // Precision is capped so a client cannot narrow the cell by sending more characters.
  areaHash: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => isGeohash(v), "areaHash must be a geohash")
    .refine(
      (v) => v.length <= AREA_PRECISION,
      `areaHash must be at most ${AREA_PRECISION} characters — finer cells reveal location`,
    ),
  networkType: z.string().trim().min(2).max(32),
  carrier: z.string().trim().max(128).optional(),
  latencyMs: z.number().int().min(0).max(120_000),
  downloadMbps: z.number().int().min(0).max(100_000),
  uploadMbps: z.number().int().min(0).max(100_000),
  packetLossBps: z.number().int().min(0).max(10_000).default(0),
  // Exactly 13 digits: epoch milliseconds through the year 2286. The old {10,16} range also
  // matched epoch SECONDS, which then failed downstream as STALE_MEASUREMENT — a correct
  // rejection for entirely the wrong reason, and a miserable thing to debug from a client.
  timestampMs: z.string().regex(/^\d{13}$/, "timestampMs must be epoch milliseconds (13 digits)"),
  nonce: z.string().trim().min(8).max(128),
  measurementRoot: z.string().trim().min(16).max(128),
  sessionHash: z.string().trim().min(16).max(128),
  signature: z.string().trim().min(16).max(10_000),
  /** EVM address that accrues the reward, and the key that must have signed this measurement. */
  contributorAddress: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, "contributorAddress must be a 20-byte EVM address"),
});

export type MeasurementInput = z.infer<typeof measurementInput>;

/**
 * Recompute the commitment and verify who authorised it.
 *
 * Until this existed, `measurementRoot` was accepted as an opaque string and `signature` was stored
 * and never read — so the claim that "a measurement is committed as a hash" was unenforced, and any
 * caller could attribute a measurement (and its reward) to any address they liked.
 *
 * Both checks run before anything is written or relayed, so a tampered payload never reaches a chain.
 */
export function verifyMeasurementIntegrity(
  input: MeasurementInput,
): { ok: true } | { ok: false; code: string } {
  // 1. The root must be the hash of the payload it claims to commit to. Derived here from the same
  //    shared/measurement.ts the client used, so the two cannot drift.
  const expected = deriveMeasurementRoot({
    areaHash: input.areaHash,
    networkType: input.networkType === "unreported" ? null : input.networkType,
    latencyMs: input.latencyMs,
    downloadMbps: input.downloadMbps,
    uploadMbps: input.uploadMbps,
    packetLossBps: input.packetLossBps,
    timestampMs: input.timestampMs,
    nonce: input.nonce,
    sessionHash: input.sessionHash,
    contributorAddress: input.contributorAddress,
  });
  if (expected.toLowerCase() !== input.measurementRoot.toLowerCase()) {
    return { ok: false, code: "MEASUREMENT_ROOT_MISMATCH" };
  }

  // 2. The contributor must have signed that measurement. This is what makes the reward attribution
  //    a claim by the contributor rather than an assertion by whoever called the API.
  //
  //    Normalise the address first. The zod schema admits any mixed-case hex, but ethers'
  //    getAddress THROWS on a mixed-case address whose EIP-55 checksum is wrong. submitMeasurement
  //    is a public procedure, so leaving that throw unguarded turned a malformed field — which
  //    anyone can send — into an unhandled 500 instead of a typed rejection.
  let contributor: string;
  try {
    contributor = getAddress(input.contributorAddress);
  } catch {
    return { ok: false, code: "INVALID_CONTRIBUTOR_ADDRESS" };
  }

  //    Recovery runs against the CANONICAL root, not the string as transmitted: keccak256 always
  //    yields lowercase hex, so that is what a correct client signs. Verifying the raw input
  //    instead would turn a harmlessly re-cased root into SIGNATURE_MISMATCH, which points the
  //    caller at entirely the wrong problem.
  //
  //    What is recovered is the shared MESSAGE, never the bare root. personal_sign takes its
  //    message parameter as hex, so every wallet decodes a 0x-prefixed root to 32 bytes before
  //    hashing it; a server verifying those 66 characters as text could only ever fail. See
  //    buildMeasurementSigningMessage.
  const message = buildMeasurementSigningMessage({
    measurementRoot: expected,
    contributorAddress: contributor,
  });

  let recovered: string;
  try {
    recovered = verifyMessage(message, input.signature);
  } catch {
    return { ok: false, code: "SIGNATURE_MALFORMED" };
  }
  if (getAddress(recovered) !== contributor) {
    return { ok: false, code: "SIGNATURE_MISMATCH" };
  }

  return { ok: true };
}

export function validateMeasurementPolicy(input: MeasurementInput) {
  const now = Date.now();
  const timestamp = Number(input.timestampMs);
  if (!Number.isSafeInteger(timestamp)) return { ok: false as const, code: "INVALID_TIMESTAMP" };
  if (timestamp - now > MAX_CLOCK_SKEW_AHEAD_MS) {
    return { ok: false as const, code: "TIMESTAMP_IN_FUTURE" };
  }
  if (now - timestamp > MAX_AGE_MS) return { ok: false as const, code: "STALE_MEASUREMENT" };
  return { ok: true as const };
}

/**
 * MySQL duplicate-key detection.
 *
 * Matches on the driver's error code rather than on the English text of the message. String
 * matching on "Duplicate entry" breaks on any non-English server locale, and a missed match turns
 * a 409 into a 500.
 */
function isDuplicateKeyError(error: unknown): boolean {
  const e = error as { code?: string; errno?: number } | null;
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

export type AdmissionVerdict =
  | { ok: true }
  | { ok: false; code: string; status: "BAD_REQUEST" | "TOO_MANY_REQUESTS"; retryAfterMs?: number };

/**
 * Everything the gateway checks before a measurement is stored or relayed, in this order:
 * policy (freshness), integrity (root + signature), then the per-cell rate limit. Integrity runs
 * before the limiter so a forged submission can never consume an honest contributor's slot.
 */
export function admitMeasurement(input: MeasurementInput, nowMs = Date.now()): AdmissionVerdict {
  const policy = validateMeasurementPolicy(input);
  if (!policy.ok) return { ok: false, code: policy.code, status: "BAD_REQUEST" };

  const integrity = verifyMeasurementIntegrity(input);
  if (!integrity.ok) return { ok: false, code: integrity.code, status: "BAD_REQUEST" };

  const gate = measurementRateLimit.check(
    { contributor: input.contributorAddress, areaHash: input.areaHash },
    nowMs,
  );
  if (!gate.ok) {
    return { ok: false, code: "RATE_LIMITED", status: "TOO_MANY_REQUESTS", retryAfterMs: gate.retryAfterMs };
  }
  return { ok: true };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  signalproof: router({
    submitMeasurement: publicProcedure.input(measurementInput).mutation(async ({ ctx, input }) => {
      const admission = admitMeasurement(input);
      if (!admission.ok) throw new TRPCError({ code: admission.status, message: admission.code });

      // Inside the try: with no reachable database this lookup used to throw ECONNREFUSED from
      // outside any handler, turning every submission into a 500.
      try {
        const duplicate = await getMeasurementByRoot(input.measurementRoot);
        if (duplicate) {
          throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_MEASUREMENT_ROOT" });
        }
        await insertMeasurement({
          ...input,
          userId: ctx.user?.id,
          status: "SUBMITTED",
          proofStatus: "NOT_STARTED",
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (isDuplicateKeyError(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_MEASUREMENT_ROOT" });
        }
        throw error;
      }

      // Read back through the public projection so the signature, nonce and sessionHash the
      // caller just sent are never echoed to any client.
      return getPublicMeasurementByRoot(input.measurementRoot);
    }),

    listMeasurements: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
      .query(({ input }) => listPublicMeasurements(input?.limit ?? 25)),

    getMeasurement: publicProcedure
      .input(z.object({ measurementRoot: z.string().min(16).max(128) }))
      .query(({ input }) => getPublicMeasurementByRoot(input.measurementRoot)),

    /**
     * Rows still moving through the pipeline.
     *
     * Filtered in SQL. The previous version fetched `limit` rows and filtered them in JavaScript
     * afterwards, so it returned fewer than `limit` results — and would have returned none once
     * settled rows outnumbered pending ones.
     */
    proofQueue: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
      .query(({ input }) => listProofQueue(input?.limit ?? 25)),

    /** Area-level aggregates. The dashboard reads this, never raw measurement rows. */
    coverage: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
      .query(({ input }) => listCoverage(input?.limit ?? 50)),

    /**
     * What the chain integration can do right now.
     *
     * The UI reads this to decide whether to label itself prototype/fixture or live. It reports
     * only which env keys are absent — never their values.
     */
    integrationStatus: publicProcedure.query(() => ({
      ...getIntegrationReadiness(),
      rateLimit: MEASUREMENT_RATE_LIMIT,
    })),

    /**
     * Dashboard read model derived straight from the deployed contracts.
     *
     * Independent of the database, so a clone with only RPC URLs and contract addresses still
     * shows real settlements. Every value here is something the two chains agree on.
     */
    /** Everything one contributor has measured, earned and claimed. */
    contributorStats: publicProcedure
      .input(z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }))
      .query(({ input }) => getContributorStats(input.address)),

    /** Live attestation countdown for one measurement, in Sepolia blocks. */
    attestationProgress: publicProcedure
      .input(z.object({ sourceBlockNumber: z.number().int().positive() }))
      .query(({ input }) => getAttestationProgress(input.sourceBlockNumber)),

    /** What one address can claim. Read-only; the claim itself must come from their wallet. */
    rewardsFor: publicProcedure
      .input(z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }))
      .query(({ input }) => getRewardsFor(input.address)),

    /**
     * The live Attestcoin proof for one source transaction, read with no key: what the
     * BlockProver precompile is asked to verify, in the terms the dashboard shows.
     */
    proofFor: publicProcedure
      .input(z.object({ sourceTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
      .query(({ input }) => getProofSummary(input.sourceTxHash)),

    onchain: publicProcedure
      .input(z.object({ force: z.boolean().default(false) }).optional())
      .query(({ input }) => getOnchainSnapshot(input?.force ?? false)),
  }),
});

export type AppRouter = typeof appRouter;
