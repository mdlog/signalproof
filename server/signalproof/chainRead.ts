/**
 * Read models built directly from on-chain state.
 *
 * The dashboard needs real data whether or not a database is configured. These readers derive
 * everything from the two deployed contracts, so a clean clone with only RPC URLs in .env still
 * shows genuine settlements rather than fixtures.
 *
 * When MySQL *is* configured the DB-backed procedures remain the richer source — they carry
 * device aliases, carriers, and rows that have not reached the source chain yet. These readers are
 * the floor, not a replacement.
 */

import { Contract, JsonRpcProvider, type Log } from "ethers";
import { chainInfo } from "@gluwa/usc-sdk";
import { ENV } from "../_core/env";
import {
  SEPOLIA_CHAIN_ID,
  SIGNAL_PROOF_BATCH_ABI,
  SIGNAL_PROOF_SETTLEMENT_ABI,
  SOURCE_BATCH_REGISTRY_ABI,
} from "./abi";

/**
 * How far back to scan.
 *
 * Public Sepolia RPCs cap `eth_getLogs` at a 50,000 block span and several require an `address`
 * filter, which we always pass. 40,000 blocks is ~5.5 days on Sepolia and ~6.9 days on CC3 —
 * comfortably inside the cap while still covering a hackathon's worth of history.
 */
const MAX_LOOKBACK_BLOCKS = 40_000;

/**
 * Chunk size for log scans, halved on failure the way Gluwa's own reference code does.
 *
 * Starts equal to the full lookback so a cooperative RPC answers in ONE round trip — four
 * sequential 10k chunks per chain made the dashboard's first paint take ~25 s. Endpoints that
 * reject the span get progressively halved, so this stays safe on stricter providers.
 */
const INITIAL_CHUNK = MAX_LOOKBACK_BLOCKS;

let cached: { at: number; value: OnchainSnapshot } | null = null;
const CACHE_TTL_MS = 15_000;

export type OnchainMeasurement = {
  measurementRoot: string;
  areaHash: string;
  contributor: string;
  /** SETTLED once the destination chain has verified it; AWAITING_ATTESTATION until then. */
  status: "AWAITING_ATTESTATION" | "SETTLED";
  sourceTxHash: string | null;
  sourceBlockNumber: number | null;
  creditcoinTxHash: string | null;
  rewardAmount: string | null;
  timestamp: number | null;
  latencyMs: number | null;
  downloadMbps: number | null;
};

export type OnchainCoverage = {
  areaHash: string;
  sampleCount: number;
  settledCount: number;
  avgLatencyMs: number | null;
  avgDownloadMbps: number | null;
  /** Epoch ms of the most recent measurement in this area, or null when none carried a timestamp. */
  lastUpdatedMs: number | null;
};

export type OnchainSnapshot = {
  configured: boolean;
  registryAddress: string;
  settlementAddress: string;
  /** Second settlement route, or "" when none is deployed. */
  batchSettlementAddress: string;
  /**
   * The one address the source registry accepts submissions from, or null if it accepts anyone.
   *
   * Surfaced because it is the control that makes every downstream proof mean something. A
   * registry that anyone can write to still produces genuine, provable events — they just name
   * whoever called it as the payee. Emitter binding on the destination chain cannot tell the
   * difference, so this is the only place the guarantee lives, and it is worth showing.
   */
  registryRelayer: string | null;
  sepoliaChainId: number;
  creditcoinChainId: number;
  /** Native CTC accrued per verified measurement, in wei. */
  rewardAmount: string;
  /** Remaining reward pool, in wei. */
  poolBalance: string;
  maxMeasurementAge: number;
  measurements: OnchainMeasurement[];
  coverage: OnchainCoverage[];
  totals: {
    submitted: number;
    settled: number;
    awaiting: number;
    contributors: number;
    rewardsPaidWei: string;
  };
  scannedFromBlock: { sepolia: number; creditcoin: number };
  error: string | null;
};

/**
 * Decode a bytes32 that holds a short UTF-8 label back into text, else keep the hex.
 *
 * Strips padding from both ends. `toBytes32` uses ethers' `zeroPadValue`, which pads on the LEFT,
 * while the more common `formatBytes32String` convention pads on the RIGHT — handling both means
 * a label survives the round trip regardless of which side wrote it.
 */
export function decodeAreaHash(value: string): string {
  try {
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    if (hex.length !== 64) return value;
    const text = Buffer.from(hex, "hex").toString("utf8").replace(/^\0+/, "").replace(/\0+$/, "");
    // Only treat it as a label when every character is printable ASCII. A real hash of opaque
    // bytes will almost never satisfy this, so genuine digests stay in hex.
    if (text.length > 0 && /^[\x20-\x7E]+$/.test(text)) return text;
  } catch {
    /* fall through — an undecodable value is simply shown as hex */
  }
  return value;
}

/**
 * How many times an empty answer is re-asked before it is believed.
 *
 * PublicNode's Sepolia endpoint returned `[]` for 4 of 8 identical `eth_getLogs` calls against a
 * registry holding 7 events — no error, no rate-limit, just nothing — and each empty answer put
 * the dashboard into "Prototype mode". Two re-asks take the odds of a false empty from 1 in 2 to
 * 1 in 8 on that endpoint; a genuinely empty range costs two cheap extra calls.
 */
const EMPTY_RETRIES = 2;

/** The one call `scanLogs` needs. `JsonRpcProvider` satisfies it; tests script one. */
export type LogSource<L = Log> = {
  getLogs(filter: {
    address: string;
    topics: string[];
    fromBlock: number;
    toBlock: number;
  }): Promise<L[]>;
};

/**
 * Scan logs in chunks, halving the span whenever an RPC rejects the range.
 *
 * Free Sepolia endpoints disagree about their limits — PublicNode caps the block delta, Tenderly
 * caps the result count — so a fixed chunk size that works on one fails on another.
 */
export async function scanLogs<L = Log>(
  provider: LogSource<L>,
  address: string,
  topic: string,
  fromBlock: number,
  toBlock: number,
  /** Optional indexed filter, e.g. a padded address for topics[1]. */
  topic1?: string,
): Promise<L[]> {
  const out: L[] = [];
  let cursor = fromBlock;
  let chunk = INITIAL_CHUNK;

  while (cursor <= toBlock) {
    const end = Math.min(cursor + chunk - 1, toBlock);
    try {
      const topics = topic1 ? [topic, topic1] : [topic];
      const filter = { address, topics, fromBlock: cursor, toBlock: end };
      let logs = await provider.getLogs(filter);
      for (let retry = 0; logs.length === 0 && retry < EMPTY_RETRIES; retry++) {
        logs = await provider.getLogs(filter);
      }
      out.push(...logs);
      cursor = end + 1;
    } catch (error) {
      if (chunk <= 100) throw error;
      chunk = Math.floor(chunk / 2);
    }
  }
  return out;
}

/**
 * Decide whether a fresh read may replace the one already being served.
 *
 * Logs on an append-only chain cannot disappear, so for the same contracts and the same scan
 * start a re-read that reports *fewer* measurements or settlements is a failed read, however
 * politely the RPC phrased it. The previous snapshot is still true; the new one is not. A read
 * that failed outright is treated the same way. Only a change of contracts or scan range — a
 * redeploy — resets the comparison, because then an empty answer really can be the truth.
 */
export function reconcileSnapshot(
  previous: OnchainSnapshot | null,
  next: OnchainSnapshot,
): OnchainSnapshot {
  if (!previous) return next;
  const sameContracts =
    previous.registryAddress === next.registryAddress &&
    previous.settlementAddress === next.settlementAddress &&
    previous.batchSettlementAddress === next.batchSettlementAddress;
  if (!sameContracts) return next;
  if (next.error) return previous;
  const sameScan =
    previous.scannedFromBlock.sepolia === next.scannedFromBlock.sepolia &&
    previous.scannedFromBlock.creditcoin === next.scannedFromBlock.creditcoin;
  if (!sameScan) return next;
  const shrank =
    next.totals.submitted < previous.totals.submitted ||
    next.totals.settled < previous.totals.settled;
  return shrank ? previous : next;
}

/**
 * Where to begin a log scan.
 *
 * Prefer the recorded deployment block: nothing relevant exists before it, and scanning a
 * 40,000-block window on a public Sepolia endpoint costs ~20 s of first-paint latency.
 */
function startBlockFor(deployBlock: string, head: number): number {
  const parsed = Number.parseInt(deployBlock, 10);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= head) return parsed;
  return Math.max(0, head - MAX_LOOKBACK_BLOCKS);
}

function isConfigured(): boolean {
  return Boolean(
    ENV.sepoliaRpcUrl &&
      ENV.creditcoinRpcUrl &&
      ENV.sourceBatchRegistryAddress &&
      ENV.settlementContractAddress,
  );
}

function emptySnapshot(error: string | null): OnchainSnapshot {
  return {
    configured: false,
    registryAddress: ENV.sourceBatchRegistryAddress || "",
    settlementAddress: ENV.settlementContractAddress || "",
    batchSettlementAddress: ENV.batchSettlementAddress || "",
    registryRelayer: null,
    sepoliaChainId: 11155111,
    creditcoinChainId: 102031,
    rewardAmount: "0",
    poolBalance: "0",
    maxMeasurementAge: 0,
    measurements: [],
    coverage: [],
    totals: { submitted: 0, settled: 0, awaiting: 0, contributors: 0, rewardsPaidWei: "0" },
    scannedFromBlock: { sepolia: 0, creditcoin: 0 },
    error,
  };
}

/**
 * Build the full dashboard snapshot from chain state.
 *
 * Joins the two sides: every MeasurementSubmitted on Sepolia is a measurement; those whose root
 * also appears in a MeasurementVerified on Creditcoin are SETTLED, the rest are still
 * AWAITING_ATTESTATION. That join is the honest definition of the pipeline's state — it reflects
 * what the chains actually agree on, not what a local queue believes.
 */
export async function getOnchainSnapshot(force = false): Promise<OnchainSnapshot> {
  if (!isConfigured()) {
    return emptySnapshot("Chain addresses or RPC URLs are not configured");
  }
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, { staticNetwork: true });
    const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });

    const registry = new Contract(
      ENV.sourceBatchRegistryAddress,
      SOURCE_BATCH_REGISTRY_ABI as unknown as string[],
      sepolia,
    );
    const settlement = new Contract(
      ENV.settlementContractAddress,
      SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[],
      creditcoin,
    );

    // Optional second settlement route, read with its OWN ABI. The two contracts emit MeasurementVerified with
    // different signatures — the single-proof event carries the ASCBase `queryId`, and the batch
    // has none to carry, because one proof covers many measurements. Different signature means a
    // different topic0, so scanning the batch contract for the single contract's topic silently
    // returns nothing: no error, no empty-result warning, just measurements that stay "awaiting"
    // forever after they have been settled and paid.
    const batchSettlement = ENV.batchSettlementAddress
      ? new Contract(
          ENV.batchSettlementAddress,
          SIGNAL_PROOF_BATCH_ABI as unknown as string[],
          creditcoin,
        )
      : null;

    const submittedTopic = registry.interface.getEvent("MeasurementSubmitted")!.topicHash;
    const verifiedTopic = settlement.interface.getEvent("MeasurementVerified")!.topicHash;
    const batchVerifiedTopic =
      batchSettlement?.interface.getEvent("MeasurementVerified")!.topicHash ?? verifiedTopic;

    const [sepoliaHead, cc3Head, rewardAmount, poolBalance, maxAge, registryRelayer] =
      await Promise.all([
        sepolia.getBlockNumber(),
        creditcoin.getBlockNumber(),
        settlement.rewardAmount() as Promise<bigint>,
        creditcoin.getBalance(ENV.settlementContractAddress),
        settlement.maxMeasurementAge() as Promise<bigint>,
        // An older registry has no relayer() at all. That is not an RPC failure — it is a registry
        // anyone can write to, and the dashboard should say so rather than omit the field.
        (registry.relayer() as Promise<string>).catch(() => null),
      ]);

    // Prefer the recorded deployment block: nothing relevant exists before it, and scanning a
    // 40,000-block window on a public Sepolia endpoint costs ~20 s of first-paint latency.
    // The lookback window remains the fallback when the deploy block is unknown.
    const sepoliaFrom = startBlockFor(ENV.sourceBatchRegistryDeployBlock, sepoliaHead);
    const cc3From = startBlockFor(ENV.settlementDeployBlock, cc3Head);

    // Retired routes still hold what they settled. Replacing a settlement contract does not
    // un-pay its measurements, so a dashboard that scans only the configured pair reports them as
    // forever awaiting — money that left the pool, against a row that says nothing happened. The
    // batch contract already names its predecessors on chain, because it has to defer to them
    // before paying; reading that list back here means one on-chain call keeps both honest.
    const retired: Contract[] = [];
    if (batchSettlement) {
      try {
        const count = Number((await batchSettlement.siblingCount()) as bigint);
        const known = new Set(
          [ENV.settlementContractAddress, ENV.batchSettlementAddress].map((a) => a.toLowerCase()),
        );
        for (let i = 0; i < count; i++) {
          const address = (await batchSettlement.siblingSettlements(i)) as string;
          if (known.has(address.toLowerCase())) continue;
          known.add(address.toLowerCase());
          retired.push(
            new Contract(address, SIGNAL_PROOF_BATCH_ABI as unknown as string[], creditcoin),
          );
        }
      } catch {
        /* an older batch contract has no sibling list — nothing to add */
      }
    }

    const [submittedLogs, verifiedLogs, batchVerifiedLogs, ...retiredLogs] = await Promise.all([
      scanLogs(sepolia, ENV.sourceBatchRegistryAddress, submittedTopic, sepoliaFrom, sepoliaHead),
      scanLogs(creditcoin, ENV.settlementContractAddress, verifiedTopic, cc3From, cc3Head),
      batchSettlement
        ? scanLogs(
            creditcoin,
            ENV.batchSettlementAddress,
            batchVerifiedTopic,
            startBlockFor(ENV.batchSettlementDeployBlock, cc3Head),
            cc3Head,
          )
        : Promise.resolve([]),
      // A retired route has no recorded deploy block, so these fall back to the lookback window.
      ...retired.map((contract) =>
        contract
          .getAddress()
          .then((address) =>
            scanLogs(creditcoin, address, batchVerifiedTopic, cc3From, cc3Head),
          ),
      ),
    ]);

    // Destination side first, so the join below is a lookup rather than a nested scan.
    const settledByRoot = new Map<string, { txHash: string; reward: bigint }>();
    const routeLogs: Array<[Contract, Log[]]> = [[settlement, verifiedLogs]];
    if (batchSettlement) routeLogs.push([batchSettlement, batchVerifiedLogs]);
    retired.forEach((contract, i) => routeLogs.push([contract, retiredLogs[i] ?? []]));

    for (const [contract, logs] of routeLogs) {
      for (const log of logs) {
        // Each route's logs are decoded with that route's own interface, for the same reason the
        // topics are computed per route.
        const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed) continue;
        settledByRoot.set((parsed.args.measurementRoot as string).toLowerCase(), {
          txHash: log.transactionHash,
          reward: parsed.args.rewardAmount as bigint,
        });
      }
    }

    const measurements: OnchainMeasurement[] = [];
    const contributors = new Set<string>();

    // Summed over the join, not over every settlement log ever emitted. The settlement contracts
    // outlive any single registry — repointing one at a newly deployed registry leaves their old
    // MeasurementVerified events on chain with nothing on the Sepolia side to join to. Counting
    // those would put a rewards total on the dashboard beside a settled count of zero.
    let rewardsPaid = 0n;

    for (const log of submittedLogs) {
      const parsed = registry.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;

      const root = (parsed.args.measurementRoot as string).toLowerCase();
      const settled = settledByRoot.get(root);
      const contributor = parsed.args.contributor as string;
      contributors.add(contributor.toLowerCase());
      if (settled) rewardsPaid += settled.reward;

      measurements.push({
        measurementRoot: parsed.args.measurementRoot as string,
        areaHash: decodeAreaHash(parsed.args.areaHash as string),
        contributor,
        status: settled ? "SETTLED" : "AWAITING_ATTESTATION",
        sourceTxHash: log.transactionHash,
        sourceBlockNumber: log.blockNumber,
        creditcoinTxHash: settled?.txHash ?? null,
        rewardAmount: settled ? settled.reward.toString() : null,
        timestamp: Number(parsed.args.timestamp),
        latencyMs: Number(parsed.args.latencyMs),
        downloadMbps: Number(parsed.args.downloadMbps),
      });
    }

    measurements.sort((a, b) => (b.sourceBlockNumber ?? 0) - (a.sourceBlockNumber ?? 0));

    // Area-level aggregates. The dashboard never shows an individual device's trail.
    const byArea = new Map<string, OnchainMeasurement[]>();
    for (const m of measurements) {
      const list = byArea.get(m.areaHash);
      if (list) list.push(m);
      else byArea.set(m.areaHash, [m]);
    }
    const coverage: OnchainCoverage[] = [...byArea.entries()]
      .map(([areaHash, rows]) => {
        const lat = rows.filter((r) => r.latencyMs != null).map((r) => r.latencyMs!);
        const dl = rows.filter((r) => r.downloadMbps != null).map((r) => r.downloadMbps!);
        const avg = (xs: number[]) =>
          xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
        const stamps = rows.map((r) => r.timestamp).filter((t): t is number => t != null);
        return {
          areaHash,
          sampleCount: rows.length,
          settledCount: rows.filter((r) => r.status === "SETTLED").length,
          avgLatencyMs: avg(lat),
          avgDownloadMbps: avg(dl),
          lastUpdatedMs: stamps.length ? Math.max(...stamps) * 1000 : null,
        };
      })
      .sort((a, b) => b.sampleCount - a.sampleCount);

    const settledCount = measurements.filter((m) => m.status === "SETTLED").length;

    const snapshot: OnchainSnapshot = {
      configured: true,
      registryAddress: ENV.sourceBatchRegistryAddress,
      settlementAddress: ENV.settlementContractAddress,
      batchSettlementAddress: ENV.batchSettlementAddress || "",
      registryRelayer,
      sepoliaChainId: 11155111,
      creditcoinChainId: 102031,
      rewardAmount: rewardAmount.toString(),
      poolBalance: poolBalance.toString(),
      maxMeasurementAge: Number(maxAge),
      measurements,
      coverage,
      totals: {
        submitted: measurements.length,
        settled: settledCount,
        awaiting: measurements.length - settledCount,
        contributors: contributors.size,
        rewardsPaidWei: rewardsPaid.toString(),
      },
      scannedFromBlock: { sepolia: sepoliaFrom, creditcoin: cc3From },
      error: null,
    };

    const kept = reconcileSnapshot(cached?.value ?? null, snapshot);
    cached = { at: Date.now(), value: kept };
    return kept;
  } catch (error) {
    // A read failure must not take the dashboard down. With nothing to fall back on it renders
    // the empty state and says why; with a good snapshot already in hand it keeps serving that,
    // and the next tick tries again.
    const message = error instanceof Error ? error.message : String(error);
    const kept = reconcileSnapshot(cached?.value ?? null, emptySnapshot(message.slice(0, 200)));
    if (kept.error === null) cached = { at: Date.now(), value: kept };
    return kept;
  }
}

/**
 * Accrued, unclaimed reward for one address, read straight from the settlement contract.
 *
 * Read-only and server-side on purpose: showing a contributor what they are owed must not require
 * them to connect a wallet, and must not depend on the browser being on the right chain. Only the
 * claim itself needs their wallet, because claim() is msg.sender-based.
 */
export type RewardRoute = {
  /** Contract the contributor must call `claim()` on. Each pays only from its own balance. */
  address: string;
  label: "single" | "batch";
  wei: string;
  poolWei: string;
  claimable: boolean;
};

/**
 * What one address can withdraw, per settlement route.
 *
 * There are two contracts and they do not share a balance: `claim()` on one pays nothing that
 * accrued on the other. Returning a single number would understate what a contributor is owed the
 * moment any measurement settles through the batch route, and the claim button would call the
 * wrong address. So the routes are reported separately and the totals are sums over them.
 */
export async function getRewardsFor(address: string): Promise<{
  wei: string;
  poolWei: string;
  settlementAddress: string;
  claimable: boolean;
  routes: RewardRoute[];
}> {
  const empty = {
    wei: "0",
    poolWei: "0",
    settlementAddress: ENV.settlementContractAddress || "",
    claimable: false,
    routes: [] as RewardRoute[],
  };
  if (!isConfigured()) return empty;

  try {
    const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });

    const configured: Array<{ address: string; label: RewardRoute["label"] }> = [
      { address: ENV.settlementContractAddress, label: "single" },
    ];
    if (ENV.batchSettlementAddress) {
      configured.push({ address: ENV.batchSettlementAddress, label: "batch" });
    }

    const routes = await Promise.all(
      configured.map(async ({ address: contractAddress, label }): Promise<RewardRoute> => {
        const contract = new Contract(
          contractAddress,
          SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[],
          creditcoin,
        );
        const [wei, poolWei] = await Promise.all([
          contract.rewards(address) as Promise<bigint>,
          creditcoin.getBalance(contractAddress),
        ]);
        return {
          address: contractAddress,
          label,
          wei: wei.toString(),
          poolWei: poolWei.toString(),
          // The contract reverts with InsufficientBalance if the pool cannot cover the accrual.
          claimable: wei > 0n && poolWei >= wei,
        };
      }),
    );

    const total = routes.reduce((sum, r) => sum + BigInt(r.wei), 0n);

    // The route the primary button acts on: the one owing this address the most that can actually
    // pay, falling back to the largest balance so the UI still shows an accrual it cannot yet
    // withdraw rather than reporting zero.
    const byLargest = [...routes].sort((a, b) => (BigInt(b.wei) > BigInt(a.wei) ? 1 : -1));
    const primary = byLargest.find((r) => r.claimable) ?? byLargest[0] ?? null;

    return {
      wei: total.toString(),
      poolWei: primary?.poolWei ?? "0",
      settlementAddress: primary?.address ?? ENV.settlementContractAddress,
      claimable: routes.some((r) => r.claimable),
      routes,
    };
  } catch {
    return empty;
  }
}

/**
 * Where a measurement sits in the attestation queue, in blocks.
 *
 * The proof worker already computes this every tick; exposing it turns the ~8 minute wait from dead
 * time into the protocol mechanic it actually is. Every number here is independently checkable
 * against a Sepolia block explorer, which is the point.
 */
export async function getAttestationProgress(sourceBlockNumber: number): Promise<{
  attestedHeight: number;
  sourceBlockNumber: number;
  blocksRemaining: number;
  attested: boolean;
  sepoliaHead: number;
  chainKey: number;
  error: string | null;
}> {
  const empty = {
    attestedHeight: 0,
    sourceBlockNumber,
    blocksRemaining: 0,
    attested: false,
    sepoliaHead: 0,
    chainKey: 0,
    error: "Chain not configured",
  };
  if (!isConfigured()) return empty;

  try {
    const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
    const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, { staticNetwork: true });

    const provider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
    const chains = await provider.getSupportedChains();
    const entry = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);
    if (!entry) return { ...empty, error: "Sepolia is not attested on this network" };

    const chainKey = Number(entry.chainKey);
    const [latest, sepoliaHead] = await Promise.all([
      provider.getLatestAttestedHeightAndHash(chainKey),
      sepolia.getBlockNumber(),
    ]);
    const attestedHeight = Number(latest.height);

    return {
      attestedHeight,
      sourceBlockNumber,
      blocksRemaining: Math.max(0, sourceBlockNumber - attestedHeight),
      attested: attestedHeight >= sourceBlockNumber,
      sepoliaHead,
      chainKey,
      error: null,
    };
  } catch (error) {
    return { ...empty, error: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
  }
}

export type ContributorStats = {
  address: string;
  measurements: OnchainMeasurement[];
  areas: string[];
  totals: {
    submitted: number;
    settled: number;
    awaiting: number;
    /** Sum of MeasurementVerified rewards for this address, in wei. */
    earnedWei: string;
    /** Sum of RewardClaimed amounts already withdrawn, in wei. */
    claimedWei: string;
    /** Still sitting in the contract, in wei. */
    unclaimedWei: string;
  };
  claims: Array<{ txHash: string; amountWei: string; blockNumber: number }>;
  error: string | null;
};

/**
 * Everything one contributor has done, derived from chain state.
 *
 * The claim history in particular has never been read before — `RewardClaimed` was emitted and
 * ignored, so a contributor could see a balance but not what they had already withdrawn. Reading it
 * is what makes "earned" and "unclaimed" two different, checkable numbers rather than one number
 * with an implied history.
 */
export async function getContributorStats(address: string): Promise<ContributorStats> {
  const empty: ContributorStats = {
    address,
    measurements: [],
    areas: [],
    totals: {
      submitted: 0,
      settled: 0,
      awaiting: 0,
      earnedWei: "0",
      claimedWei: "0",
      unclaimedWei: "0",
    },
    claims: [],
    error: null,
  };
  if (!isConfigured()) return { ...empty, error: "Chain not configured" };

  try {
    const snapshot = await getOnchainSnapshot();
    if (snapshot.error) return { ...empty, error: snapshot.error };

    const lower = address.toLowerCase();
    const mine = snapshot.measurements.filter((m) => m.contributor.toLowerCase() === lower);

    let earned = 0n;
    for (const m of mine) if (m.rewardAmount) earned += BigInt(m.rewardAmount);

    // Claim history: RewardClaimed(address indexed contributor, uint256 amount).
    //
    // Scanned across both settlement routes. `earned` above already spans them — the snapshot
    // merges both contracts' MeasurementVerified — so scanning claims from only one would report
    // a batch-route withdrawal as still unclaimed, and the dashboard would offer money that has
    // already been paid.
    const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
    const settlement = new Contract(
      ENV.settlementContractAddress,
      SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[],
      creditcoin,
    );
    const head = await creditcoin.getBlockNumber();
    const topic = settlement.interface.getEvent("RewardClaimed")!.topicHash;
    const padded = "0x" + lower.slice(2).padStart(64, "0");

    const sources: Array<{ address: string; deployBlock: string }> = [
      { address: ENV.settlementContractAddress, deployBlock: ENV.settlementDeployBlock },
    ];
    if (ENV.batchSettlementAddress) {
      sources.push({
        address: ENV.batchSettlementAddress,
        deployBlock: ENV.batchSettlementDeployBlock,
      });
    }

    const logs = (
      await Promise.all(
        sources.map((source) =>
          scanLogs(
            creditcoin,
            source.address,
            topic,
            startBlockFor(source.deployBlock, head),
            head,
            padded, // filter to this contributor in the RPC, not in JS
          ),
        ),
      )
    )
      .flat()
      .sort((a, b) => a.blockNumber - b.blockNumber);

    let claimed = 0n;
    const claims = logs.map((log) => {
      const parsed = settlement.interface.parseLog({ topics: [...log.topics], data: log.data });
      const amount = (parsed?.args.amount as bigint) ?? 0n;
      claimed += amount;
      return {
        txHash: log.transactionHash,
        amountWei: amount.toString(),
        blockNumber: log.blockNumber,
      };
    });

    const settled = mine.filter((m) => m.status === "SETTLED").length;
    return {
      address,
      measurements: mine,
      areas: [...new Set(mine.map((m) => m.areaHash))],
      totals: {
        submitted: mine.length,
        settled,
        awaiting: mine.length - settled,
        earnedWei: earned.toString(),
        claimedWei: claimed.toString(),
        unclaimedWei: (earned - claimed > 0n ? earned - claimed : 0n).toString(),
      },
      claims: claims.reverse(),
      error: null,
    };
  } catch (error) {
    return { ...empty, error: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
  }
}
