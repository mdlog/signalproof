// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignedSubmit} from "./SignedSubmit.sol";
import {SignalProofSettlement} from "../src/SignalProofSettlement.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

/// @notice Two settlement contracts reading one registry: does a measurement pay twice?
///
/// `settled` is per-contract, `execute` and `executeBatch` are permissionless, and both contracts
/// are bound to the same registry. Nothing about the second settlement is forged — the measurement
/// is genuine, the contributor is genuine, the proof is genuine. It is simply the same work paid
/// for twice, out of two pools, by anyone willing to send the transaction.
///
/// The cross-check that closes it can only be added to a contract that has not shipped yet, so it
/// lives on the batch side and is exercised here.
contract DoubleSettlementTest is SignedSubmit {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address CONTRIBUTOR;
    address constant OPPORTUNIST = address(0xBADBAD);

    uint256 constant REWARD = 0.001 ether;
    uint256 constant MAX_AGE = 24 hours;
    uint256 constant POOL = 0.05 ether;

    SourceBatchRegistry registry;
    SignalProofSettlement single;
    SignalProofBatchSettlement batch;
    MockNativeQueryVerifier verifier;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);

        registry = new SourceBatchRegistry(address(this));
        CONTRIBUTOR = _wallet(0xC0FFEE);
        single = new SignalProofSettlement(address(registry), REWARD, MAX_AGE);
        batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
        vm.deal(address(single), POOL);
        vm.deal(address(batch), POOL);
        vm.warp(1_800_000_000);
    }

    receive() external payable {}

    function _siblings(address one) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = one;
    }

    function _emit(bytes32 root) internal returns (bytes memory) {
        vm.recordLogs();
        registry.submitMeasurement(
            root,
            keccak256("zone"),
            CONTRIBUTOR,
            keccak256("s"),
            block.timestamp - 60,
            28,
            91,
            _sig(registry, root, CONTRIBUTOR)
        );
        Vm.Log[] memory e = vm.getRecordedLogs();
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: e[0].emitter, topics: e[0].topics, data: e[0].data});
        return EvmTxFixture.buildType2(1, logs);
    }

    function _single(bytes memory txBytes) internal returns (bool) {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");
        return single.execute(
            0,
            1,
            11_657_000,
            txBytes,
            keccak256("merkle"),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            keccak256("lower"),
            roots
        );
    }

    function _batch(bytes memory txBytes) internal returns (uint256) {
        bytes[] memory txs = new bytes[](1);
        txs[0] = txBytes;
        uint64[] memory heights = new uint64[](1);
        heights[0] = 11_657_000;

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = INativeQueryVerifier.MerkleProof({
            root: keccak256("merkle"), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
        });
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");
        return batch.executeBatch(
            1,
            heights,
            txs,
            proofs,
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("lower"), roots: roots})
        );
    }

    // ---------------------------------------------------------------- //

    /// @notice The cross-check: the batch route refuses what the single route already paid for.
    function test_batchRefusesAMeasurementTheSingleRouteAlreadySettled() public {
        batch.setSiblingSettlements(_siblings(address(single)));
        bytes memory txBytes = _emit(keccak256("dbl-1"));

        assertTrue(_single(txBytes), "single settles first");
        assertEq(single.rewards(CONTRIBUTOR), REWARD);

        // Anyone may call this — that is the point. It must settle nothing.
        vm.prank(OPPORTUNIST);
        vm.expectRevert(SignalProofBatchSettlement.NoMeasurementSettled.selector);
        _batch(txBytes);

        assertFalse(batch.settled(keccak256("dbl-1")), "must not settle on the batch route too");
        assertEq(batch.rewards(CONTRIBUTOR), 0, "must not accrue a second time");
        assertEq(address(batch).balance, POOL, "batch pool untouched");
    }

    /// @notice One poisoned entry must not strand the honest ones beside it here either.
    function test_alreadyPaidEntryIsSkippedNotFatalInsideABatch() public {
        batch.setSiblingSettlements(_siblings(address(single)));
        bytes memory paid = _emit(keccak256("dbl-paid"));
        bytes memory fresh = _emit(keccak256("dbl-fresh"));
        _single(paid);

        bytes[] memory txs = new bytes[](2);
        txs[0] = paid;
        txs[1] = fresh;
        uint64[] memory heights = new uint64[](2);
        heights[0] = 11_657_000;
        heights[1] = 11_657_001;
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        for (uint256 i; i < 2; ++i) {
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: keccak256(abi.encode(i)), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");

        uint256 count = batch.executeBatch(
            1,
            heights,
            txs,
            proofs,
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("lower"), roots: roots})
        );

        assertEq(count, 1, "only the unpaid one settles");
        assertTrue(batch.settled(keccak256("dbl-fresh")));
        assertFalse(batch.settled(keccak256("dbl-paid")));
        assertEq(batch.rewards(CONTRIBUTOR), REWARD, "paid once on this route");
    }

    /// @notice Without the sibling configured the hole is wide open — this is the finding itself.
    ///
    /// Kept as an executable statement of why `setSiblingSettlement` is not optional. Nothing here
    /// is forged: one genuine measurement, two genuine proofs, two contracts, two payouts.
    function test_withoutTheCrossCheckTheSameMeasurementPaysTwice() public {
        bytes memory txBytes = _emit(keccak256("dbl-2"));

        _single(txBytes);
        vm.prank(OPPORTUNIST);
        assertEq(_batch(txBytes), 1, "second contract settles the same measurement");

        assertEq(single.rewards(CONTRIBUTOR) + batch.rewards(CONTRIBUTOR), REWARD * 2, "one measurement, two rewards");
    }

    /// @notice The cross-check must not block the ordinary case.
    function test_crossCheckDoesNotBlockAMeasurementNobodyHasSettled() public {
        batch.setSiblingSettlements(_siblings(address(single)));
        bytes memory txBytes = _emit(keccak256("dbl-3"));

        assertEq(_batch(txBytes), 1, "settles normally through the batch route");
        assertEq(batch.rewards(CONTRIBUTOR), REWARD);
    }

    /// @notice A retired route still counts. This is why the sibling is a list, not one address.
    ///
    /// Redeploying a settlement contract does not un-pay what the old one already paid. The
    /// replacement has to defer to its predecessor as well as to its peers, or the first thing the
    /// redeploy does is pay a second time for everything the retired route settled.
    function test_aRetiredRouteIsStillDeferredTo() public {
        SignalProofBatchSettlement retired = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
        vm.deal(address(retired), POOL);

        bytes memory txBytes = _emit(keccak256("dbl-retired"));

        // The retired route settles it, then is replaced.
        bytes[] memory txs = new bytes[](1);
        txs[0] = txBytes;
        uint64[] memory heights = new uint64[](1);
        heights[0] = 11_657_000;
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = INativeQueryVerifier.MerkleProof({
            root: keccak256("merkle"), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
        });
        bytes32[] memory continuity = new bytes32[](1);
        continuity[0] = keccak256("continuity");
        retired.executeBatch(
            1,
            heights,
            txs,
            proofs,
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("lower"), roots: continuity})
        );
        assertTrue(retired.settled(keccak256("dbl-retired")));

        address[] memory list = new address[](2);
        list[0] = address(single);
        list[1] = address(retired);
        batch.setSiblingSettlements(list);
        assertEq(batch.siblingCount(), 2);

        vm.expectRevert(SignalProofBatchSettlement.NoMeasurementSettled.selector);
        _batch(txBytes);
        assertEq(batch.rewards(CONTRIBUTOR), 0, "the replacement must not re-pay");
    }

    /// @notice The list is bounded, because every entry is read for every measurement in a batch.
    function test_theSiblingListIsBounded() public {
        uint256 max = batch.MAX_SIBLINGS();
        address[] memory tooMany = new address[](max + 1);
        for (uint256 i; i < tooMany.length; ++i) {
            tooMany[i] = address(uint160(i + 1));
        }

        vm.expectRevert(abi.encodeWithSelector(SignalProofBatchSettlement.TooManySiblings.selector, max + 1, max));
        batch.setSiblingSettlements(tooMany);
    }

    /// @notice Only the owner may point the batch contract at a sibling.
    function test_onlyOwnerCanSetTheSibling() public {
        vm.prank(OPPORTUNIST);
        vm.expectRevert(SignalProofBatchSettlement.NotOwner.selector);
        batch.setSiblingSettlements(_siblings(address(single)));
    }

    /// @notice A sibling that reverts or is not a settlement contract must not brick the route.
    ///
    /// The sibling is an external call into a contract this one does not control. If a bad address
    /// is ever configured, the batch route must degrade to "no cross-check" rather than stop
    /// settling entirely.
    function test_anUnresponsiveSiblingDoesNotBrickTheBatchRoute() public {
        batch.setSiblingSettlements(_siblings(address(0xDEAD))); // no code at all
        bytes memory txBytes = _emit(keccak256("dbl-4"));

        assertEq(_batch(txBytes), 1, "settles despite the sibling being unreadable");
        assertEq(batch.rewards(CONTRIBUTOR), REWARD);
    }
}
