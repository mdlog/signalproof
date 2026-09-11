/**
 * Minimal ABIs for the two SignalProof contracts.
 *
 * Kept as literals rather than read from contracts/out at runtime so the server bundle has no
 * filesystem dependency on the Foundry build directory. `pnpm test:abi` re-checks these against
 * the compiled artifacts, so drift fails a test rather than failing silently in production.
 */

export const SOURCE_BATCH_REGISTRY_ABI = [
  "function relayer() external view returns (address)",
  "function owner() external view returns (address)",
  "function submitMeasurement(bytes32 measurementRoot, bytes32 areaHash, address contributor, bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps) external",
  "function registered(bytes32) external view returns (bool)",
  "event MeasurementSubmitted(bytes32 indexed measurementRoot, bytes32 indexed areaHash, address indexed contributor, bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps)",
  "error AlreadyRegistered(bytes32 measurementRoot)",
  "error EmptyRoot()",
  "error ZeroContributor()",
] as const;

/**
 * `execute` must hash to selector 0xc6339bf7.
 *
 * Note the tuple array: hand-keccaking the literal string "tuple(bytes32,bool)[]" yields the WRONG
 * selector (0x97cdec1a). ethers resolves the human-readable form correctly, and the assertion in
 * abi.test.ts pins it so a future edit cannot quietly break the relayer.
 */
export const SIGNAL_PROOF_SETTLEMENT_ABI = [
  "function execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots) external returns (bool success)",
  "function settled(bytes32) external view returns (bool)",
  "function processedQueries(bytes32) external view returns (bool)",
  "function rewards(address) external view returns (uint256)",
  "function claim() external",
  "function rewardAmount() external view returns (uint256)",
  "function sourceRegistry() external view returns (address)",
  "function rewardAmount() external view returns (uint256)",
  "function siblingCount() external view returns (uint256)",
  "function siblingSettlements(uint256) external view returns (address)",
  "function setSiblingSettlements(address[] siblings) external",
  "function maxMeasurementAge() external view returns (uint256)",
  "event MeasurementVerified(bytes32 indexed measurementRoot, bytes32 indexed areaHash, address indexed contributor, uint256 rewardAmount, bytes32 queryId)",
  "event RewardClaimed(address indexed contributor, uint256 amount)",
  "error WrongEmitter(address actual, address expected)",
  "error SourceTransactionFailed(uint8 receiptStatus)",
  "error MeasurementAlreadySettled(bytes32 measurementRoot)",
  "error MeasurementTooOld(uint256 measurementTimestamp, uint256 nowTimestamp)",
  "error MeasurementInFuture(uint256 measurementTimestamp, uint256 nowTimestamp)",
  "error NoMeasurementLog()",
  "error SourceRegistryNotSet()",
] as const;

/**
 * Batch settlement. Uses the BlockProver precompile's batch overload, which ASCBase does not wire.
 *
 * One `sharedContinuityProof` covers every transaction in the call — the continuity walk is the
 * expensive half of an Attestcoin proof, so proving N measurements individually pays for it N times.
 */
export const SIGNAL_PROOF_BATCH_ABI = [
  "function executeBatch(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings)[] merkleProofs, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) sharedContinuityProof) external returns (uint256 settledCount)",
  "function settled(bytes32) external view returns (bool)",
  "function rewards(address) external view returns (uint256)",
  "function claim() external",
  "function sourceRegistry() external view returns (address)",
  "function rewardAmount() external view returns (uint256)",
  "function siblingCount() external view returns (uint256)",
  "function siblingSettlements(uint256) external view returns (address)",
  "function setSiblingSettlements(address[] siblings) external",
  "event BatchSettled(uint256 measurementCount, uint256 transactionCount, uint64 chainKey)",
  "event MeasurementVerified(bytes32 indexed measurementRoot, bytes32 indexed areaHash, address indexed contributor, uint256 rewardAmount)",
  "event ForeignLogSkipped(address indexed actualEmitter, address indexed expectedEmitter)",
  "error SourceTransactionFailed(uint8 receiptStatus)",
  "error BatchVerificationFailed()",
  "error NoMeasurementSettled()",
  "error EmptyBatch()",
  "error LengthMismatch()",
] as const;

/** Canonical selector for ASCBase.execute, per the Attestcoin reference implementation. */
export const EXECUTE_SELECTOR = "0xc6339bf7";

/** topic0 of SourceBatchRegistry.MeasurementSubmitted. */
export const MEASUREMENT_SUBMITTED_TOPIC =
  "0x4f09990b7d3f08f97e61f2836fb08135ec6312b4b78f157360109669f99a0080";

/** Ethereum Sepolia — the only source chain this deployment proves from. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Creditcoin CC3 Testnet. Devnet is 102032 and mainnet 102030 — do not confuse them. */
export const CC3_TESTNET_CHAIN_ID = 102031;
