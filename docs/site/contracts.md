# Smart contracts

Three contracts, two chains, one event shape shared between them. Foundry project in `contracts/`, pinned to the Gluwa reference toolchain: `solc 0.8.30`, `evm_version = shanghai`, `optimizer_runs = 200`, `via_ir = true` (`ASCBase` plus the decoder hit "stack too deep" without it).

## Addresses

| Contract | Chain | Address | Deploy block |
|---|---|---|---|
| `SourceBatchRegistry` | Sepolia 11155111 | [`0x32c0923cD58523864D2727FCaaB109783664c236`](https://sepolia.etherscan.io/address/0x32c0923cD58523864D2727FCaaB109783664c236) | 11,681,375 |
| `SignalProofSettlement` | CC3 Testnet 102031 | [`0x8F14B2cC1b807203d332DE6E3DA6274176FDb584`](https://creditcoin-testnet.blockscout.com/address/0x8F14B2cC1b807203d332DE6E3DA6274176FDb584) | 5,448,580 |
| `SignalProofBatchSettlement` | CC3 Testnet 102031 | [`0x3B90e22f246bBa68f6de682b564c33b121D68C85`](https://creditcoin-testnet.blockscout.com/address/0x3B90e22f246bBa68f6de682b564c33b121D68C85) | 5,449,853 |
| Retired `SourceBatchRegistry` | Sepolia | [`0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc`](https://sepolia.etherscan.io/address/0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc) | 11,658,403 |

The registry was deployed three times, each time to close a hole found in review (see [Security model](security.md#findings)). The settlement contracts kept their addresses and were repointed with `setSourceRegistry`; `settled` is keyed by `measurementRoot` and `rewards` by address, so nothing already proven or owed was affected.

## `SourceBatchRegistry` (Sepolia)

The commitment log. It stores a root, never the raw measurement, never coordinates, never PII, and it refuses the same root twice so a replay never reaches the destination chain.

```solidity
event MeasurementSubmitted(
    bytes32 indexed measurementRoot,
    bytes32 indexed areaHash,
    address indexed contributor,   // topics[3]: the payee the settlement contract reads
    bytes32 sessionHash,
    uint256 timestamp,
    uint256 latencyMs,
    uint256 downloadMbps
);

function submitMeasurement(
    bytes32 measurementRoot, bytes32 areaHash, address contributor, bytes32 sessionHash,
    uint256 timestamp, uint256 latencyMs, uint256 downloadMbps, bytes calldata signature
) external;                                   // msg.sender must be `relayer`

function signingMessage(bytes32 measurementRoot, address contributor) public pure returns (string memory);
function signingDigest(bytes32 measurementRoot, address contributor) public pure returns (bytes32);
function recoverContributor(bytes32 measurementRoot, address contributor, bytes calldata signature) public pure returns (address);

function setRelayer(address) external;        // owner
function transferOwnership(address) external; // owner
```

Checks, in order: `NotAuthorised` unless `msg.sender == relayer`; `EmptyRoot`; `ZeroContributor`; `AlreadyRegistered`; then `SignatureMismatch(recovered, contributor)` — the contract rebuilds the exact EIP-191 text the wallet displayed (`shared/measurement.ts` `buildMeasurementSigningMessage`, byte for byte) and `ecrecover`s it. `BadSignatureLength` for anything but 65 bytes; `v` of 0/1 is normalised to 27/28. Measured cost: 86,266 gas per commitment.

Two controls for two attackers: the relayer gate carries the gateway's admission checks on chain, so an outsider with a valid signature is still refused; the signature makes attribution a claim by the contributor, so the relayer cannot name a payee who did not sign.

## `SignalProofSettlement` (CC3)

The single-proof route. Inherits `ASCBase`; see [Attestcoin integration](attestcoin.md#destination-contract-ascbase-and-one-hook) for the hook.

```solidity
function execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction,
    bytes32 merkleRoot, (bytes32 hash, bool isLeft)[] siblings,
    bytes32 lowerEndpointDigest, bytes32[] continuityRoots) external returns (bool);   // ASCBase, permissionless

event MeasurementVerified(bytes32 indexed measurementRoot, bytes32 indexed areaHash, address indexed contributor, uint256 rewardAmount, bytes32 queryId);
event RewardClaimed(address indexed contributor, uint256 amount);
event Funded(address indexed from, uint256 amount);   // receive(): buyers and the operator fund the pool

function claim() external;                            // pays msg.sender's accrued balance
function rewards(address) external view returns (uint256);
function settled(bytes32) external view returns (bool);
function rewardAmount() external view returns (uint256);       // 0.001 CTC
function maxMeasurementAge() external view returns (uint256);  // 86,400 s
function setSourceRegistry(address) / setRewardAmount(uint256) / setMaxMeasurementAge(uint256) / withdraw(uint256) — owner
```

Errors: `SourceRegistryNotSet`, `WrongEmitter(actual, expected)`, `SourceTransactionFailed(receiptStatus)`, `NoMeasurementLog`, `MeasurementAlreadySettled(root)`, `MeasurementTooOld`, `MeasurementInFuture`, `NothingToClaim`, `TransferFailed`, `InsufficientBalance`, `ZeroAddress`, `NotOwner`. A replayed proof is refused earlier, by `ASCBase`, with `Query already processed`.

## `SignalProofBatchSettlement` (CC3)

The batch route: one continuity proof for many transactions.

```solidity
function executeBatch(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions,
    MerkleProof[] merkleProofs, ContinuityProof sharedContinuityProof) external returns (uint256 settledCount);

event BatchSettled(uint256 measurementCount, uint256 transactionCount, uint64 chainKey);
event ForeignLogSkipped(address indexed actualEmitter, address indexed expectedEmitter);
event SiblingSettlementsUpdated(uint256 count);

function setSiblingSettlements(address[] siblings) external;    // owner, max 4
function siblingCount() / siblingSettlements(uint256) external view;
```

Same per-entry checks as the single route; a bad entry is skipped (`ForeignLogSkipped`, stale, or already paid on a sibling), and only a batch that settles nothing reverts (`NoMeasurementSettled`). Other errors: `EmptyBatch`, `LengthMismatch`, `BatchVerificationFailed`, `TooManySiblings`.

## Tests

`forge test` runs 75 tests across nine suites, including:

| Suite | What it pins |
|---|---|
| `SourceBatchRegistry.t.sol` | Topic layout the settlement decodes against; a signature vector produced by ethers is accepted (TypeScript and Solidity agree byte for byte); fuzzed recovery; mismatch, wrong root, malformed length, legacy `v`; gate checked before signature |
| `SignalProofSettlement.t.sol` | Receipt status, emitter binding, replay, freshness, reward accrual |
| `EndToEnd.t.sol` | A real registry emission driven into the real settlement contract; a forged registry with a valid proof cannot settle |
| `RegistryAuthorisation.t.sol`, `AdvUnlimitedMint.t.sol` | The permissionless-registry exploit, kept with inverted assertions |
| `DoubleSettlement.t.sol` | One measurement paid on both routes, and the sibling cross-check that stops it |
| `BatchPoison.t.sol` | A co-emitted lookalike log is skipped, not fatal |
| `SignalProofBatchSettlement.t.sol` | Batch semantics, one continuity proof shared |
| `BatchGasProbe.t.sol` | Gas per entry for n = 1, 10, 50, 200 and the block ceiling |

The server's `abi.test.ts` cross-checks the hand-written ABIs against the compiled artifacts when `contracts/out` exists.

## Deploying

`contracts/deploy.sh` wraps everything; `.env` supplies keys and RPCs and receives the addresses and deploy blocks back.

```bash
pnpm deploy:check     # balances and readiness, no transactions
pnpm deploy:sepolia   # SourceBatchRegistry, constructor arg = relayer; verifies via Sourcify
pnpm deploy:cc3       # SignalProofSettlement with forge create; verifies on Blockscout
./contracts/deploy.sh batch     # SignalProofBatchSettlement
./contracts/deploy.sh repoint   # setSourceRegistry on both settlement contracts
./contracts/deploy.sh fund      # top up the reward pool (FUND_AMOUNT_WEI)
```

Measured deploy cost: 134,013 gas on Sepolia (pre-signature registry), 1,503,596 gas on CC3. CC3 deployments use `forge create` because CC3 headers carry no `mixHash` and Foundry's shanghai simulation aborts before sending. `forge-std` is a git submodule (`git clone --recursive`, or `forge install` in `contracts/`); `@gluwa/asc-contracts` is resolved from `node_modules` through a lib root.
