// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title SignalProofSettlement
/// @notice Application Smart Contract on Creditcoin CC3 that settles connectivity measurements
///         proven to exist on Ethereum Sepolia via the Attestcoin Protocol.
///
/// @dev Trust model, stated explicitly because the precompile does less than it appears to:
///
///      The BlockProver precompile proves ONE thing — that `encodedTransaction` was included in a
///      block that genuinely belongs to the attested source chain. It does NOT prove the
///      transaction succeeded, and it does NOT prove which contract emitted the logs inside it.
///      Both of those are this contract's job, and both are enforced in `_processAndEmitEvent`:
///
///        1. `receipt.receiptStatus == 1` — otherwise a reverted transaction would settle.
///        2. `log.address_ == sourceRegistry` — otherwise anyone could deploy a lookalike
///           contract on Sepolia, emit a MeasurementSubmitted event with arbitrary values,
///           prove it here, and drain the reward pool.
///
///      Check (2) is missing from the `SimpleMinterASC` example on the Attestcoin docs site.
///      It is present in Gluwa's own `ASCLoanManager` reference implementation, which also ships
///      a dedicated regression test for it (`ASCLoanManagerSourceBinding.t.sol`,
///      `testFundLog_rejectsWrongEmitter`). This contract mirrors both.
///
///      `ASCBase.execute()` is permissionless by design — any relayer may submit a valid proof.
///      Therefore ALL authorization lives below, never in a caller check.
contract SignalProofSettlement is ASCBase {
    using EvmV1Decoder for bytes;

    /// @dev keccak256("MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)")
    ///      Computed in the constructor-free way so it stays a compile-time constant.
    bytes32 public constant MEASUREMENT_SUBMITTED_SIG =
        keccak256(
            "MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)"
        );

    /// @notice The only Sepolia contract whose events this contract will settle.
    address public sourceRegistry;

    /// @notice Reward accrued per verified measurement, in wei of native CTC.
    uint256 public rewardAmount;

    /// @notice Maximum age of a measurement, in seconds, at settlement time.
    uint256 public maxMeasurementAge;

    address public owner;

    /// @notice measurementRoot => settled. Second replay layer, see `_processAndEmitEvent`.
    mapping(bytes32 => bool) public settled;

    /// @notice contributor => claimable balance in wei.
    mapping(address => uint256) public rewards;

    event MeasurementVerified(
        bytes32 indexed measurementRoot,
        bytes32 indexed areaHash,
        address indexed contributor,
        uint256 rewardAmount,
        bytes32 queryId
    );
    event RewardClaimed(address indexed contributor, uint256 amount);
    event SourceRegistryUpdated(address indexed previous, address indexed current);
    event RewardAmountUpdated(uint256 previous, uint256 current);
    event MaxMeasurementAgeUpdated(uint256 previous, uint256 current);
    event Funded(address indexed from, uint256 amount);
    event OwnershipTransferred(address indexed previous, address indexed current);

    error NotOwner();
    error SourceRegistryNotSet();
    error WrongEmitter(address actual, address expected);
    error SourceTransactionFailed(uint8 receiptStatus);
    error NoMeasurementLog();
    error MeasurementAlreadySettled(bytes32 measurementRoot);
    error MeasurementTooOld(uint256 measurementTimestamp, uint256 nowTimestamp);
    error MeasurementInFuture(uint256 measurementTimestamp, uint256 nowTimestamp);
    error NothingToClaim();
    error TransferFailed();
    error InsufficientBalance(uint256 requested, uint256 available);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param sourceRegistry_ Deployed SourceBatchRegistry address on Ethereum Sepolia.
    /// @param rewardAmount_   Native CTC accrued per verified measurement, in wei.
    /// @param maxMeasurementAge_ Freshness window in seconds.
    constructor(address sourceRegistry_, uint256 rewardAmount_, uint256 maxMeasurementAge_) {
        owner = msg.sender;
        sourceRegistry = sourceRegistry_;
        rewardAmount = rewardAmount_;
        maxMeasurementAge = maxMeasurementAge_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------------ //
    // Attestcoin readability hook                                        //
    // ------------------------------------------------------------------ //

    /// @inheritdoc ASCBase
    /// @dev Called by `ASCBase.execute()` only after the precompile has verified Merkle inclusion
    ///      and continuity, and after `processedQueries[queryId]` deduplication.
    function _processAndEmitEvent(
        uint8, /* action */
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (sourceRegistry == address(0)) revert SourceRegistryNotSet();

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(
            encodedTransaction
        );

        // SECURITY 1 — the precompile proves inclusion, never success.
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(
            receipt,
            MEASUREMENT_SUBMITTED_SIG
        );
        if (logs.length == 0) revert NoMeasurementLog();

        for (uint256 i; i < logs.length; ++i) {
            _settleOne(logs[i], queryId);
        }
    }

    function _settleOne(EvmV1Decoder.LogEntry memory log, bytes32 queryId) private {
        // SECURITY 2 — emitter binding. Without this, a lookalike contract on Sepolia could emit
        // a forged MeasurementSubmitted and prove it here. This is the check the docs example
        // omits.
        if (log.address_ != sourceRegistry) {
            revert WrongEmitter(log.address_, sourceRegistry);
        }

        // topics: [sig, measurementRoot, areaHash, contributor]
        bytes32 measurementRoot = log.topics[1];
        bytes32 areaHash = log.topics[2];
        address contributor = address(uint160(uint256(log.topics[3])));

        // data: abi.encode(sessionHash, timestamp, latencyMs, downloadMbps)
        (, uint256 timestamp, , ) = abi.decode(
            log.data,
            (bytes32, uint256, uint256, uint256)
        );

        // Second replay layer. ASCBase's processedQueries is keyed on queryId, which identifies a
        // source TRANSACTION. This one is keyed on the measurement itself, so the same
        // measurementRoot can never settle twice even if it somehow appeared in two source
        // transactions.
        if (settled[measurementRoot]) revert MeasurementAlreadySettled(measurementRoot);

        if (timestamp > block.timestamp) revert MeasurementInFuture(timestamp, block.timestamp);
        if (block.timestamp - timestamp > maxMeasurementAge) {
            revert MeasurementTooOld(timestamp, block.timestamp);
        }

        settled[measurementRoot] = true;

        uint256 reward = rewardAmount;
        if (reward != 0) {
            rewards[contributor] += reward;
        }

        emit MeasurementVerified(measurementRoot, areaHash, contributor, reward, queryId);
    }

    // ------------------------------------------------------------------ //
    // Rewards — pull pattern                                             //
    // ------------------------------------------------------------------ //

    /// @notice Withdraw accrued rewards.
    /// @dev Pull rather than push: no value transfer happens on the verification path, so a
    ///      contributor with a reverting receive() cannot brick settlement for everyone else,
    ///      and `execute()` stays cheap and reentrancy-free.
    function claim() external {
        uint256 amount = rewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        rewards[msg.sender] = 0; // effects before interaction

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------ //
    // Admin                                                              //
    // ------------------------------------------------------------------ //

    function setSourceRegistry(address sourceRegistry_) external onlyOwner {
        emit SourceRegistryUpdated(sourceRegistry, sourceRegistry_);
        sourceRegistry = sourceRegistry_;
    }

    function setRewardAmount(uint256 rewardAmount_) external onlyOwner {
        emit RewardAmountUpdated(rewardAmount, rewardAmount_);
        rewardAmount = rewardAmount_;
    }

    function setMaxMeasurementAge(uint256 maxMeasurementAge_) external onlyOwner {
        emit MaxMeasurementAgeUpdated(maxMeasurementAge, maxMeasurementAge_);
        maxMeasurementAge = maxMeasurementAge_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Withdraw unallocated funds. Does not touch accrued rewards accounting.
    function withdraw(uint256 amount) external onlyOwner {
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Fund the reward pool.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
