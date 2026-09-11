import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing Manus OAuth. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const measurementStatus = [
  "SUBMITTED",
  "AWAITING_ATTESTATION",
  "PROOF_VERIFIED",
  "SETTLED",
  "REJECTED",
] as const;

export const proofStatusValues = [
  "NOT_STARTED",
  "SOURCE_TX_SENT",
  "AWAITING_ATTESTATION",
  "PROOF_FETCHED",
  "SUBMITTED_TO_CREDITCOIN",
  "VERIFIED",
  "FAILED",
] as const;

export const measurements = mysqlTable(
  "measurements",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    deviceAlias: varchar("deviceAlias", { length: 64 }).notNull(),
    areaHash: varchar("areaHash", { length: 128 }).notNull(),
    networkType: varchar("networkType", { length: 32 }).notNull(),
    carrier: varchar("carrier", { length: 128 }),
    latencyMs: int("latencyMs").notNull(),
    downloadMbps: int("downloadMbps").notNull(),
    uploadMbps: int("uploadMbps").notNull(),
    packetLossBps: int("packetLossBps").default(0).notNull(),
    timestampMs: varchar("timestampMs", { length: 32 }).notNull(),
    // Unique because docs/TECHNICAL_ARCHITECTURE.md:164 promises nonce uniqueness as a gateway
    // control. Before this, nothing enforced it.
    nonce: varchar("nonce", { length: 128 }).notNull().unique(),
    measurementRoot: varchar("measurementRoot", { length: 128 }).notNull().unique(),
    sessionHash: varchar("sessionHash", { length: 128 }).notNull(),
    signature: text("signature").notNull(),
    status: mysqlEnum("status", measurementStatus).default("SUBMITTED").notNull(),
    rejectionCode: varchar("rejectionCode", { length: 64 }),

    // --- chain columns, written by the relayer and proof worker ---
    /** EVM address that accrues the reward on Creditcoin. */
    contributorAddress: varchar("contributorAddress", { length: 42 }),
    sourceTxHash: varchar("sourceTxHash", { length: 128 }),
    sourceBlockNumber: varchar("sourceBlockNumber", { length: 32 }),
    /** Attestcoin chain key of the source chain. Recorded so the audit trail is unambiguous. */
    chainKey: int("chainKey"),
    /** proofData.headerNumber — the attested header the proof was built against. */
    headerNumber: varchar("headerNumber", { length: 32 }),
    proofStatus: varchar("proofStatus", { length: 64 }).default("NOT_STARTED").notNull(),
    creditcoinTxHash: varchar("creditcoinTxHash", { length: 128 }),
    rewardAmount: varchar("rewardAmount", { length: 78 }),

    // --- retry bookkeeping ---
    attempts: int("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("nextAttemptAt"),
    lastError: text("lastError"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    // The proof worker runs this predicate every 15 seconds. Without it the query is a full scan;
    // the table previously carried no index at all beyond its primary and unique keys.
    index("measurements_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("measurements_area_created_idx").on(table.areaHash, table.createdAt),
  ],
);

export type Measurement = typeof measurements.$inferSelect;
export type InsertMeasurement = typeof measurements.$inferInsert;
