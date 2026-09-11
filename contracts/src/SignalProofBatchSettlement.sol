// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title SignalProofBatchSettlement
/// @notice Settles many measurements in ONE Creditcoin transaction, using the BlockProver
///         precompile's batch overload.
///
/// @dev Why this contract exists separately from SignalProofSettlement.
///
///      `ASCBase`, the base contract Gluwa ships for readability ASCs, wires only the single-proof
///      overload of `verifyAndEmit`. The precompile at 0xFD2 also exposes a batch overload:
///
///          verifyAndEmit(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions,
///                        MerkleProof[] merkleProofs, ContinuityProof sharedContinuityProof)
///
///      The saving is not merely fewer transactions. A continuity proof is the expensive half of an
///      Attestcoin proof — it walks the attestation chain back to a checkpoint — and the batch form
///      carries exactly ONE of them for the whole set. Proving N measurements individually pays
///      that walk N times.
///
///      The security model is unchanged and deliberately duplicated rather than inherited, because
///      the precompile still proves only inclusion:
///
///        1. `receipt.receiptStatus == 1` — inclusion is not success.
///        2. `log.address_ == sourceRegistry` — emitter binding. Without it, anyone could deploy a
///           lookalike registry on Sepolia, emit a forged MeasurementSubmitted, prove it here, and
///           drain the pool. This check is missing from the `SimpleMinterASC` example on the
///           Attestcoin docs site.
///
///      Deployed alongside the original contract, not in place of it: the settlements already on
///      chain remain where they are, and the single-proof path keeps working untouched.
contract SignalProofBatchSettlement {
    /// @dev keccak256("MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)")
    bytes32 public constant MEASUREMENT_SUBMITTED_SIG =
        keccak256(
            "MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)"
        );

    INativeQueryVerifier public immutable VERIFIER;

    address public sourceRegistry;

    /**
     * @notice Settlement contracts reading the SAME registry, whose payouts must not be repeated.
     *
     * Every route is permissionless by design — anyone holding a valid proof may settle, and that
     * is correct. But `settled` is per-contract, so without this the identical measurement could be
     * settled once on each and paid out of every pool. Nothing about the second settlement is
     * forged; it is the same genuine work billed twice.
     *
     * A list rather than a single address, because routes accumulate. Retiring a contract does not
     * un-pay what it already paid, so a redeployed route has to keep deferring to the one it
     * replaced as well as to its peers. Empty disables the check.
     */
    address[] public siblingSettlements;

    /// @dev Every entry is read for every measurement in a batch, so the list stays short enough
    ///      that the cross-check never dominates the gas the batching was meant to save.
    uint256 public constant MAX_SIBLINGS = 4;
    uint256 public rewardAmount;
    uint256 public maxMeasurementAge;
    address public owner;

    mapping(bytes32 => bool) public settled;
    mapping(address => uint256) public rewards;

    /// @notice Emitted once per batch, so a reader can see how many proofs shared one continuity walk.
    event BatchSettled(uint256 measurementCount, uint256 transactionCount, uint64 chainKey);
    event MeasurementVerified(
        bytes32 indexed measurementRoot,
        bytes32 indexed areaHash,
        address indexed contributor,
        uint256 rewardAmount
    );
    event RewardClaimed(address indexed contributor, uint256 amount);
    event Funded(address indexed from, uint256 amount);

    error NotOwner();
    error SourceRegistryNotSet();
    /// @notice A MeasurementSubmitted-shaped log from something other than the bound registry.
    /// @dev    Not an error. Emitted so an operator can still see forgery attempts in the logs,
    ///         since the batch no longer reverts on them.
    event ForeignLogSkipped(address indexed actualEmitter, address indexed expectedEmitter);

    error SourceTransactionFailed(uint8 receiptStatus);
    error BatchVerificationFailed();
    error EmptyBatch();
    error LengthMismatch();
    error NoMeasurementSettled();
    error NothingToClaim();
    error TransferFailed();
    error InsufficientBalance(uint256 requested, uint256 available);
    error ZeroAddress();

    event SiblingSettlementsUpdated(uint256 count);

    error TooManySiblings(uint256 given, uint256 max);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address sourceRegistry_, uint256 rewardAmount_, uint256 maxMeasurementAge_) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        owner = msg.sender;
        sourceRegistry = sourceRegistry_;
        rewardAmount = rewardAmount_;
        maxMeasurementAge = maxMeasurementAge_;
    }

    /// @notice Replace the list of settlement contracts whose payouts must not be duplicated here.
    /// @dev    Settable rather than fixed at construction because a sibling may be deployed after
    ///         this contract, and because routes get retired and replaced.
    function setSiblingSettlements(address[] calldata siblings) external onlyOwner {
        if (siblings.length > MAX_SIBLINGS) revert TooManySiblings(siblings.length, MAX_SIBLINGS);
        delete siblingSettlements;
        for (uint256 i; i < siblings.length; ++i) siblingSettlements.push(siblings[i]);
        emit SiblingSettlementsUpdated(siblings.length);
    }

    function siblingCount() external view returns (uint256) {
        return siblingSettlements.length;
    }

    /**
     * @dev Has any sibling route already paid for this measurement?
     *
     * A staticcall with an explicit success check, not a plain interface call. A sibling is an
     * address this contract does not control, so a misconfiguration — an EOA, a contract without
     * `settled(bytes32)`, one that reverts — must degrade to "no cross-check" rather than stop the
     * batch route from settling anything at all. Losing the check is recoverable; a bricked route
     * that silently rejects every honest measurement is not.
     */
    function _settledBySibling(bytes32 measurementRoot) internal view returns (bool) {
        uint256 count = siblingSettlements.length;
        for (uint256 i; i < count; ++i) {
            (bool success, bytes memory returned) = siblingSettlements[i].staticcall(
                abi.encodeWithSignature("settled(bytes32)", measurementRoot)
            );
            if (success && returned.length >= 32 && abi.decode(returned, (bool))) return true;
        }
        return false;
    }

    /// @notice Verify and settle a batch of proven source transactions in one call.
    /// @dev Reverts if the batch as a whole fails verification. Individual measurements inside a
    ///      verified batch are skipped when already settled or stale — a batch is not all-or-nothing
    ///      at the measurement level, because one stale row must not strand the rest. It IS
    ///      all-or-nothing on the proof: an unverified batch settles nothing.
    function executeBatch(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external returns (uint256 settledCount) {
        if (encodedTransactions.length == 0) revert EmptyBatch();
        if (heights.length != encodedTransactions.length || heights.length != merkleProofs.length) {
            revert LengthMismatch();
        }
        if (sourceRegistry == address(0)) revert SourceRegistryNotSet();

        // ONE precompile call, ONE continuity walk, for the whole batch.
        bool verified = VERIFIER.verifyAndEmit(
            chainKey,
            heights,
            encodedTransactions,
            merkleProofs,
            sharedContinuityProof
        );
        if (!verified) revert BatchVerificationFailed();

        for (uint256 i; i < encodedTransactions.length; ++i) {
            settledCount += _settleTransaction(encodedTransactions[i]);
        }

        // A batch that proves out but settles nothing is a caller error worth surfacing, not a
        // silent success — it means every measurement was stale or already paid.
        if (settledCount == 0) revert NoMeasurementSettled();

        emit BatchSettled(settledCount, encodedTransactions.length, chainKey);
    }

    function _settleTransaction(bytes calldata encodedTransaction) private returns (uint256 count) {
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(
            encodedTransaction
        );

        // SECURITY 1 — the precompile proves inclusion, never success.
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(
            receipt,
            MEASUREMENT_SUBMITTED_SIG
        );

        for (uint256 i; i < logs.length; ++i) {
            // SECURITY 2 — emitter binding.
            //
            // Skipped, not fatal, and the difference matters for a BATCH. `getLogsByEventSignature`
            // returns every matching log in the receipt, and a receipt can carry logs from more
            // than one contract. Reverting here would hand anyone a grief lever: one Sepolia
            // transaction that calls the registry and also emits a lookalike log makes every batch
            // containing it revert forever, taking the innocent measurements alongside it down too.
            // Skipping is exactly as safe — a foreign log settles nothing either way — and a batch
            // made only of foreign logs still reverts, via NoMeasurementSettled below.
            if (logs[i].address_ != sourceRegistry) {
                emit ForeignLogSkipped(logs[i].address_, sourceRegistry);
                continue;
            }

            bytes32 measurementRoot = logs[i].topics[1];
            if (settled[measurementRoot]) continue; // already paid; not an error inside a batch
            // Skipped rather than reverted, for the same reason: one entry the other route already
            // paid for must not strand the honest measurements sharing this batch.
            if (_settledBySibling(measurementRoot)) continue;

            (, uint256 timestamp, , ) = abi.decode(
                logs[i].data,
                (bytes32, uint256, uint256, uint256)
            );
            // Skip rather than revert: one stale measurement must not strand a valid batch.
            if (timestamp > block.timestamp) continue;
            if (block.timestamp - timestamp > maxMeasurementAge) continue;

            settled[measurementRoot] = true;

            address contributor = address(uint160(uint256(logs[i].topics[3])));
            uint256 reward = rewardAmount;
            if (reward != 0) rewards[contributor] += reward;

            emit MeasurementVerified(measurementRoot, logs[i].topics[2], contributor, reward);
            ++count;
        }
    }

    // ------------------------------------------------------------------ //
    // Rewards — pull pattern, identical to the single-proof contract      //
    // ------------------------------------------------------------------ //

    function claim() external {
        uint256 amount = rewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        rewards[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RewardClaimed(msg.sender, amount);
    }

    function setSourceRegistry(address sourceRegistry_) external onlyOwner {
        sourceRegistry = sourceRegistry_;
    }

    function setRewardAmount(uint256 rewardAmount_) external onlyOwner {
        rewardAmount = rewardAmount_;
    }

    function setMaxMeasurementAge(uint256 maxMeasurementAge_) external onlyOwner {
        maxMeasurementAge = maxMeasurementAge_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function withdraw(uint256 amount) external onlyOwner {
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
