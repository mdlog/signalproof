/**
 * Measurement store — MySQL when it is reachable, in-memory when it is not.
 *
 * Why this exists: the read path is already database-free (chainRead.ts derives everything from the
 * deployed contracts), but the WRITE path was not. With no MySQL, `getMeasurementByRoot` threw
 * ECONNREFUSED and every submission became a 500, so a real device could never get a measurement
 * onto the source chain at all.
 *
 * The in-memory backing is not a toy. It re-enforces the two uniqueness constraints that otherwise
 * only exist in the MySQL schema — `measurementRoot` and `nonce` are both `.unique()` in
 * drizzle/schema.ts, and `nonce` uniqueness is a documented gateway control. Dropping the database
 * without re-imposing them would silently remove replay protection.
 *
 * It is deliberately bounded. Settled and rejected rows are evicted oldest-first past a cap so a
 * long-running demo cannot exhaust memory.
 */

import type { Measurement } from "../../drizzle/schema";
import {
  claimWorkableMeasurements as dbClaimWorkable,
  getDb,
  getMeasurementByRoot as dbGetByRoot,
  getPublicMeasurementByRoot as dbGetPublicByRoot,
  insertMeasurement as dbInsert,
  updateMeasurementByRoot as dbUpdate,
} from "../db";

const MAX_ROWS = 5_000;

/** Rows keyed by measurementRoot, insertion-ordered by Map semantics. */
const rows = new Map<string, Measurement>();
/** nonce -> measurementRoot, so nonce uniqueness survives the loss of the unique index. */
const nonces = new Map<string, string>();

let nextId = 1;

/** Mirrors the MySQL duplicate-key error so callers need only one error path. */
function duplicateKeyError(key: string): Error & { code: string; errno: number } {
  const e = new Error(`Duplicate entry for ${key}`) as Error & { code: string; errno: number };
  e.code = "ER_DUP_ENTRY";
  e.errno = 1062;
  return e;
}

/** Drop the oldest terminal rows once the cap is passed. Live rows are never evicted. */
function evictIfNeeded(): void {
  if (rows.size <= MAX_ROWS) return;
  for (const [root, row] of rows) {
    if (rows.size <= MAX_ROWS) break;
    if (row.status === "SETTLED" || row.status === "REJECTED") {
      rows.delete(root);
      if (row.nonce) nonces.delete(row.nonce);
    }
  }
}

// ------------------------------------------------------------------ //
// In-memory implementations                                          //
// ------------------------------------------------------------------ //

function memGetByRoot(measurementRoot: string): Measurement | undefined {
  return rows.get(measurementRoot);
}

function memInsert(input: Partial<Measurement> & { measurementRoot: string }): Measurement {
  if (rows.has(input.measurementRoot)) throw duplicateKeyError("measurementRoot");
  if (input.nonce && nonces.has(input.nonce)) throw duplicateKeyError("nonce");

  const now = new Date();
  const row = {
    id: nextId++,
    userId: null,
    carrier: null,
    packetLossBps: 0,
    status: "SUBMITTED",
    proofStatus: "NOT_STARTED",
    rejectionCode: null,
    contributorAddress: null,
    sourceTxHash: null,
    sourceBlockNumber: null,
    chainKey: null,
    headerNumber: null,
    creditcoinTxHash: null,
    rewardAmount: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  } as Measurement;

  rows.set(row.measurementRoot, row);
  if (row.nonce) nonces.set(row.nonce, row.measurementRoot);
  evictIfNeeded();
  return row;
}

function memUpdate(measurementRoot: string, patch: Partial<Measurement>): void {
  const row = rows.get(measurementRoot);
  if (!row) return;
  rows.set(measurementRoot, { ...row, ...patch, updatedAt: new Date() });
}

function memClaimWorkable(statuses: Array<Measurement["status"]>, limit: number): Measurement[] {
  const now = Date.now();
  return [...rows.values()]
    .filter(
      (r) =>
        statuses.includes(r.status) &&
        (!r.nextAttemptAt || new Date(r.nextAttemptAt).getTime() <= now),
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Public projection.
 *
 * `signature`, `nonce` and `sessionHash` are session-binding secrets — echoing them would let a
 * caller replay another contributor's payload. Kept identical to the SQL projection in db.ts.
 */
function toPublic(row: Measurement | undefined) {
  if (!row) return undefined;
  const { signature: _s, nonce: _n, sessionHash: _h, userId: _u, ...rest } = row;
  return rest;
}

// ------------------------------------------------------------------ //
// Façade                                                             //
// ------------------------------------------------------------------ //

let backendLogged = false;

async function useDb(): Promise<boolean> {
  const db = await getDb();
  if (!backendLogged) {
    backendLogged = true;
    console.log(
      db
        ? "[SignalProof] measurement store: MySQL"
        : "[SignalProof] measurement store: in-memory (no reachable DATABASE_URL). " +
            "Measurements still reach the source chain; they do not survive a restart.",
    );
  }
  return Boolean(db);
}

export async function getMeasurementByRoot(measurementRoot: string) {
  return (await useDb()) ? dbGetByRoot(measurementRoot) : memGetByRoot(measurementRoot);
}

export async function getPublicMeasurementByRoot(measurementRoot: string) {
  return (await useDb())
    ? dbGetPublicByRoot(measurementRoot)
    : toPublic(memGetByRoot(measurementRoot));
}

export async function insertMeasurement(
  input: Partial<Measurement> & { measurementRoot: string },
) {
  if (await useDb()) return dbInsert(input as never);
  return memInsert(input);
}

export async function updateMeasurementByRoot(
  measurementRoot: string,
  patch: Partial<Measurement>,
) {
  if (await useDb()) return dbUpdate(measurementRoot, patch as never);
  memUpdate(measurementRoot, patch);
}

export async function claimWorkableMeasurements(
  statuses: Array<Measurement["status"]>,
  limit = 20,
) {
  return (await useDb()) ? dbClaimWorkable(statuses, limit) : memClaimWorkable(statuses, limit);
}

/** Whether a persistent database is backing the store. Surfaced to the UI, never guessed at. */
export async function isPersistent(): Promise<boolean> {
  return useDb();
}

/** Test seam. */
export function __resetStore(): void {
  rows.clear();
  nonces.clear();
  nextId = 1;
  backendLogged = false;
}
