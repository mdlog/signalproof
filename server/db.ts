import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertMeasurement, InsertUser, Measurement, measurements, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _probed = false;

/**
 * The database handle, or null when MySQL is genuinely unreachable.
 *
 * `drizzle(url)` builds a lazy pool and never throws, so the previous version returned a non-null
 * handle even with nothing listening on 3306 — every `if (!db)` guard below was dead code and the
 * failure surfaced later as an opaque ECONNREFUSED from whichever query ran first. One probe query
 * at startup makes the return value mean what it claims.
 */
export async function getDb() {
  if (_probed) return _db;
  _probed = true;

  if (!process.env.DATABASE_URL) return (_db = null);

  try {
    const candidate = drizzle(process.env.DATABASE_URL);
    await candidate.execute(sql`SELECT 1`);
    _db = candidate;
  } catch (error) {
    console.warn(
      "[Database] Not reachable, continuing without persistence:",
      error instanceof Error ? error.message : error,
    );
    _db = null;
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getMeasurementByRoot(measurementRoot: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurements).where(eq(measurements.measurementRoot, measurementRoot)).limit(1);
  return result[0];
}

export async function insertMeasurement(input: InsertMeasurement) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(measurements).values(input);
  return getMeasurementByRoot(input.measurementRoot);
}

export async function listMeasurements(limit = 25) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurements).orderBy(desc(measurements.createdAt)).limit(Math.min(limit, 100));
}

/**
 * Public projection of a measurement row.
 *
 * `signature`, `nonce` and `sessionHash` are session-binding secrets: exposing them would let a
 * caller replay another contributor's authenticated payload. They never leave the server.
 */
export const PUBLIC_MEASUREMENT_COLUMNS = {
  id: measurements.id,
  deviceAlias: measurements.deviceAlias,
  areaHash: measurements.areaHash,
  networkType: measurements.networkType,
  carrier: measurements.carrier,
  latencyMs: measurements.latencyMs,
  downloadMbps: measurements.downloadMbps,
  uploadMbps: measurements.uploadMbps,
  packetLossBps: measurements.packetLossBps,
  timestampMs: measurements.timestampMs,
  measurementRoot: measurements.measurementRoot,
  status: measurements.status,
  rejectionCode: measurements.rejectionCode,
  contributorAddress: measurements.contributorAddress,
  sourceTxHash: measurements.sourceTxHash,
  sourceBlockNumber: measurements.sourceBlockNumber,
  chainKey: measurements.chainKey,
  headerNumber: measurements.headerNumber,
  proofStatus: measurements.proofStatus,
  creditcoinTxHash: measurements.creditcoinTxHash,
  rewardAmount: measurements.rewardAmount,
  createdAt: measurements.createdAt,
  updatedAt: measurements.updatedAt,
} as const;

export async function listPublicMeasurements(limit = 25) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(PUBLIC_MEASUREMENT_COLUMNS)
    .from(measurements)
    .orderBy(desc(measurements.createdAt))
    .limit(Math.min(limit, 100));
}

export async function getPublicMeasurementByRoot(measurementRoot: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select(PUBLIC_MEASUREMENT_COLUMNS)
    .from(measurements)
    .where(eq(measurements.measurementRoot, measurementRoot))
    .limit(1);
  return rows[0];
}

/**
 * Proof queue, filtered in SQL.
 *
 * The previous implementation fetched `limit` rows and filtered them in JavaScript afterwards,
 * which silently returned fewer than `limit` results — and would have returned none at all once
 * settled rows outnumbered pending ones.
 */
export async function listProofQueue(limit = 25) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(PUBLIC_MEASUREMENT_COLUMNS)
    .from(measurements)
    .where(inArray(measurements.status, ["SUBMITTED", "AWAITING_ATTESTATION", "REJECTED"]))
    .orderBy(desc(measurements.createdAt))
    .limit(Math.min(limit, 100));
}

/** Aggregate coverage per area. The dashboard reads area-level data, never raw rows. */
export async function listCoverage(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      areaHash: measurements.areaHash,
      sampleCount: sql<number>`count(*)`,
      avgLatencyMs: sql<number>`round(avg(${measurements.latencyMs}))`,
      avgDownloadMbps: sql<number>`round(avg(${measurements.downloadMbps}))`,
      settledCount: sql<number>`sum(case when ${measurements.status} = 'SETTLED' then 1 else 0 end)`,
      lastUpdated: sql<Date>`max(${measurements.createdAt})`,
    })
    .from(measurements)
    .groupBy(measurements.areaHash)
    .orderBy(desc(sql`count(*)`))
    .limit(Math.min(limit, 200));
}

// ------------------------------------------------------------------ //
// Chain pipeline writes                                              //
// ------------------------------------------------------------------ //

type MeasurementUpdate = Partial<
  Pick<
    Measurement,
    | "status"
    | "proofStatus"
    | "rejectionCode"
    | "contributorAddress"
    | "sourceTxHash"
    | "sourceBlockNumber"
    | "chainKey"
    | "headerNumber"
    | "creditcoinTxHash"
    | "rewardAmount"
    | "attempts"
    | "nextAttemptAt"
    | "lastError"
  >
>;

export async function updateMeasurementByRoot(
  measurementRoot: string,
  patch: MeasurementUpdate,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(measurements).set(patch).where(eq(measurements.measurementRoot, measurementRoot));
}

/**
 * Rows the worker should act on this tick.
 *
 * `nextAttemptAt IS NULL OR nextAttemptAt <= now` implements the backoff: a row that just failed
 * is invisible to the query until its delay elapses, so a persistently failing measurement cannot
 * monopolise the tick.
 */
export async function claimWorkableMeasurements(
  statuses: Array<Measurement["status"]>,
  limit = 20,
): Promise<Measurement[]> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return db
    .select()
    .from(measurements)
    .where(
      and(
        inArray(measurements.status, statuses),
        or(isNull(measurements.nextAttemptAt), lte(measurements.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(measurements.createdAt))
    .limit(limit);
}
