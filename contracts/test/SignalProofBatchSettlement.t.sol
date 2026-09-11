// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

/// @notice The batch path must not be a weaker path.
///
/// Every invariant the single-proof contract enforces is re-asserted here, because the batch
/// contract cannot inherit ASCBase and therefore re-implements them. A batch settlement route that
/// skipped emitter binding would be a hole opened by an optimisation.
contract SignalProofBatchSettlementTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CONTRIBUTOR = address(0xC0FFEE);
    address constant OTHER = address(0xDECAF);

    uint256 constant REWARD = 0.001 ether;
    uint256 constant MAX_AGE = 24 hours;

    SourceBatchRegistry registry;
    SignalProofBatchSettlement batch;
    MockNativeQueryVerifier verifier;
    bytes32 sig;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);

        registry = new SourceBatchRegistry(address(this));
        batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
        sig = batch.MEASUREMENT_SUBMITTED_SIG();
        vm.deal(address(batch), 1 ether);
        vm.warp(1_800_000_000);
    }

    receive() external payable {}

    /// @dev Emit through the real registry, then wrap what it emitted as prover-shaped txBytes.
    function _emit(bytes32 root, address contributor, uint256 timestamp)
        internal
        returns (bytes memory)
    {
        vm.recordLogs();
        registry.submitMeasurement(
            root, keccak256("zone"), contributor, keccak256("session"), timestamp, 28, 91
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entries[0].emitter,
            topics: entries[0].topics,
            data: entries[0].data
        });
        return EvmTxFixture.buildType2(1, logs);
    }

    function _emptyProofs(uint256 n)
        internal
        pure
        returns (INativeQueryVerifier.MerkleProof[] memory proofs)
    {
        proofs = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: keccak256(abi.encode("merkle", i)),
                siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
    }

    function _shared() internal pure returns (INativeQueryVerifier.ContinuityProof memory) {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");
        return INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: keccak256("lower"),
            roots: roots
        });
    }

    function _run(bytes[] memory txs) internal returns (uint256) {
        uint64[] memory heights = new uint64[](txs.length);
        for (uint256 i; i < txs.length; ++i) heights[i] = uint64(11_657_000 + i);
        return batch.executeBatch(1, heights, txs, _emptyProofs(txs.length), _shared());
    }

    // ---------------------------------------------------------------- //

    function test_settlesThreeMeasurementsInOneCall() public {
        bytes[] memory txs = new bytes[](3);
        txs[0] = _emit(keccak256("b-1"), CONTRIBUTOR, block.timestamp - 60);
        txs[1] = _emit(keccak256("b-2"), CONTRIBUTOR, block.timestamp - 60);
        txs[2] = _emit(keccak256("b-3"), OTHER, block.timestamp - 60);

        assertEq(_run(txs), 3, "all three should settle");
        assertTrue(batch.settled(keccak256("b-1")));
        assertTrue(batch.settled(keccak256("b-3")));
        assertEq(batch.rewards(CONTRIBUTOR), REWARD * 2);
        assertEq(batch.rewards(OTHER), REWARD);
    }

    /// @notice One continuity proof covers the whole batch — the point of the exercise.
    function test_wholeBatchSharesOneContinuityProof() public {
        bytes[] memory txs = new bytes[](4);
        for (uint256 i; i < 4; ++i) {
            txs[i] = _emit(keccak256(abi.encode("share", i)), CONTRIBUTOR, block.timestamp - 60);
        }
        vm.recordLogs();
        _run(txs);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].topics[0] == keccak256("BatchSettled(uint256,uint256,uint64)")) {
                (uint256 measurements, uint256 transactions, uint64 chainKey) =
                    abi.decode(entries[i].data, (uint256, uint256, uint64));
                assertEq(measurements, 4);
                assertEq(transactions, 4);
                assertEq(chainKey, 1);
                found = true;
            }
        }
        assertTrue(found, "BatchSettled not emitted");
    }

    /// @notice The optimisation must not open a hole the single-proof path closes.
    function test_forgedRegistryCannotSettleInABatch() public {
        SourceBatchRegistry impostor = new SourceBatchRegistry(address(this));

        vm.recordLogs();
        impostor.submitMeasurement(
            keccak256("b-forged"), keccak256("z"), CONTRIBUTOR, keccak256("s"), block.timestamp - 60, 1, 999
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entries[0].emitter,
            topics: entries[0].topics,
            data: entries[0].data
        });

        bytes[] memory txs = new bytes[](1);
        txs[0] = EvmTxFixture.buildType2(1, logs);

        // Nothing in the batch is settleable, so the call reverts on its way out rather than at
        // the forged entry. Either way the forgery pays nothing — which is the actual invariant.
        vm.expectRevert(SignalProofBatchSettlement.NoMeasurementSettled.selector);
        _run(txs);
        assertFalse(batch.settled(keccak256("b-forged")), "forged measurement must not settle");
        assertEq(batch.rewards(CONTRIBUTOR), 0, "forged batch must not pay out");
    }

    /// @notice One forged entry must NOT be able to strand the honest measurements beside it.
    ///
    /// This is the grief case: if the batch reverted on a foreign emitter, anyone could destroy
    /// every batch containing their transaction, indefinitely, for the cost of one Sepolia tx.
    /// The forged entry is skipped and the honest one settles.
    function test_oneForgedEntryDoesNotStrandTheHonestOnes() public {
        SourceBatchRegistry impostor = new SourceBatchRegistry(address(this));
        bytes[] memory txs = new bytes[](2);
        txs[0] = _emit(keccak256("b-good"), CONTRIBUTOR, block.timestamp - 60);

        vm.recordLogs();
        impostor.submitMeasurement(
            keccak256("b-bad"), keccak256("z"), CONTRIBUTOR, keccak256("s"), block.timestamp - 60, 1, 1
        );
        Vm.Log[] memory e = vm.getRecordedLogs();
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: e[0].emitter, topics: e[0].topics, data: e[0].data});
        txs[1] = EvmTxFixture.buildType2(1, logs);

        assertEq(_run(txs), 1, "the honest measurement still settles");
        assertTrue(batch.settled(keccak256("b-good")));
        assertFalse(batch.settled(keccak256("b-bad")), "the forged one is skipped, never settled");
        assertEq(batch.rewards(CONTRIBUTOR), REWARD, "paid once, for the honest entry only");
    }

    function test_rejectsBatchWithAFailedSourceTransaction() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmTxFixture.measurementLog(
            address(registry), sig, keccak256("b-rev"), keccak256("z"), CONTRIBUTOR,
            keccak256("s"), block.timestamp - 60, 28, 91
        );
        bytes[] memory txs = new bytes[](1);
        txs[0] = EvmTxFixture.buildType2(0, logs); // receiptStatus = 0

        vm.expectRevert(
            abi.encodeWithSelector(SignalProofBatchSettlement.SourceTransactionFailed.selector, uint8(0))
        );
        _run(txs);
    }

    function test_rejectsBatchTheVerifierDoesNotAccept() public {
        verifier.setShouldVerify(false);
        bytes[] memory txs = new bytes[](1);
        txs[0] = _emit(keccak256("b-badproof"), CONTRIBUTOR, block.timestamp - 60);

        vm.expectRevert(SignalProofBatchSettlement.BatchVerificationFailed.selector);
        _run(txs);
    }

    /// @notice A stale entry is skipped, not fatal — one old row must not strand a valid batch.
    function test_staleEntryIsSkippedButTheBatchStillSettles() public {
        bytes[] memory txs = new bytes[](2);
        txs[0] = _emit(keccak256("b-fresh"), CONTRIBUTOR, block.timestamp - 60);
        txs[1] = _emit(keccak256("b-stale"), CONTRIBUTOR, block.timestamp - MAX_AGE - 1);

        assertEq(_run(txs), 1, "only the fresh one settles");
        assertTrue(batch.settled(keccak256("b-fresh")));
        assertFalse(batch.settled(keccak256("b-stale")));
        assertEq(batch.rewards(CONTRIBUTOR), REWARD);
    }

    function test_alreadySettledEntryIsSkippedNotReverted() public {
        bytes[] memory first = new bytes[](1);
        first[0] = _emit(keccak256("b-dup"), CONTRIBUTOR, block.timestamp - 60);
        _run(first);

        bytes[] memory second = new bytes[](2);
        second[0] = first[0]; // same measurement again
        second[1] = _emit(keccak256("b-new"), CONTRIBUTOR, block.timestamp - 60);

        assertEq(_run(second), 1, "only the new one settles");
        assertEq(batch.rewards(CONTRIBUTOR), REWARD * 2, "no double payment");
    }

    function test_batchThatSettlesNothingReverts() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = _emit(keccak256("b-old"), CONTRIBUTOR, block.timestamp - MAX_AGE - 1);
        vm.expectRevert(SignalProofBatchSettlement.NoMeasurementSettled.selector);
        _run(txs);
    }

    function test_rejectsEmptyAndMismatchedBatches() public {
        bytes[] memory none = new bytes[](0);
        uint64[] memory noHeights = new uint64[](0);
        vm.expectRevert(SignalProofBatchSettlement.EmptyBatch.selector);
        batch.executeBatch(1, noHeights, none, _emptyProofs(0), _shared());

        bytes[] memory one = new bytes[](1);
        one[0] = _emit(keccak256("b-mismatch"), CONTRIBUTOR, block.timestamp - 60);
        uint64[] memory two = new uint64[](2);
        vm.expectRevert(SignalProofBatchSettlement.LengthMismatch.selector);
        batch.executeBatch(1, two, one, _emptyProofs(1), _shared());
    }

    function test_claimPaysOutAfterABatch() public {
        bytes[] memory txs = new bytes[](2);
        txs[0] = _emit(keccak256("b-c1"), CONTRIBUTOR, block.timestamp - 60);
        txs[1] = _emit(keccak256("b-c2"), CONTRIBUTOR, block.timestamp - 60);
        _run(txs);

        uint256 before = CONTRIBUTOR.balance;
        vm.prank(CONTRIBUTOR);
        batch.claim();
        assertEq(CONTRIBUTOR.balance, before + REWARD * 2);
        assertEq(batch.rewards(CONTRIBUTOR), 0);
    }
}
