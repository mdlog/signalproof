// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignedSubmit} from "./SignedSubmit.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

/// @notice A Sepolia contract an attacker deploys. One transaction: register a genuine measurement
///         through the real registry AND emit a lookalike log from itself. The resulting receipt
///         carries two MeasurementSubmitted-signature logs, one legitimate, one not.
contract PoisonEmitter {
    event MeasurementSubmitted(
        bytes32 indexed measurementRoot,
        bytes32 indexed areaHash,
        address indexed contributor,
        bytes32 sessionHash,
        uint256 timestamp,
        uint256 latencyMs,
        uint256 downloadMbps
    );

    function poison(SourceBatchRegistry registry, bytes32 root, address contributor, uint256 ts, bytes calldata sig)
        external
    {
        registry.submitMeasurement(root, keccak256("zone"), contributor, keccak256("s"), ts, 28, 91, sig);
        emit MeasurementSubmitted(keccak256("dust"), keccak256("zone"), address(this), keccak256("s"), ts, 1, 1);
    }
}

contract BatchPoisonTest is SignedSubmit {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address CONTRIBUTOR;
    uint256 constant REWARD = 0.001 ether;
    uint256 constant MAX_AGE = 24 hours;

    SourceBatchRegistry registry;
    SignalProofBatchSettlement batch;
    MockNativeQueryVerifier verifier;
    PoisonEmitter poisoner;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);
        registry = new SourceBatchRegistry(address(this));
        CONTRIBUTOR = _wallet(0xC0FFEE);
        poisoner = new PoisonEmitter();
        batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
        vm.deal(address(batch), 10 ether);
        vm.warp(1_800_000_000);
    }

    function _wrap(Vm.Log[] memory entries) internal pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](entries.length);
        for (uint256 i; i < entries.length; ++i) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: entries[i].emitter, topics: entries[i].topics, data: entries[i].data
            });
        }
        return EvmTxFixture.buildType2(1, logs);
    }

    function _honest(bytes32 root) internal returns (bytes memory) {
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
        return _wrap(vm.getRecordedLogs());
    }

    function _run(bytes[] memory txs) internal returns (uint256) {
        uint64[] memory heights = new uint64[](txs.length);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](txs.length);
        for (uint256 i; i < txs.length; ++i) {
            heights[i] = uint64(11_657_000 + i);
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: keccak256(abi.encode(i)), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("c");
        return batch.executeBatch(
            1,
            heights,
            txs,
            proofs,
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("l"), roots: roots})
        );
    }

    /// @notice First line of defence: the poisoner cannot get into the registry at all.
    ///
    /// The attack needs a receipt containing BOTH a genuine registry log and a lookalike. The
    /// genuine half is what makes an indexer pick the transaction up. With the registry gated on
    /// the relayer, an attacker cannot produce that half from their own transaction.
    function test_thePoisonerCannotProduceTheGenuineHalf() public {
        bytes memory sig = _sig(registry, keccak256("victim-measurement"), CONTRIBUTOR);
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, address(poisoner)));
        poisoner.poison(registry, keccak256("victim-measurement"), CONTRIBUTOR, block.timestamp - 60, sig);
    }

    /// @notice Second line of defence: even a co-emitted lookalike cannot strand the batch.
    ///
    /// Assume the first line fails — a relayer key is compromised, or some future contract is
    /// authorised and turns out to emit its own lookalike alongside. The batch must still settle
    /// the honest measurements and merely ignore the impostor log. Reverting instead would mean one
    /// Sepolia transaction could kill every batch containing it, forever, and take the innocent
    /// measurements down with it. That grief lever is what this test denies.
    function test_aCoEmittedLookalikeIsSkippedNotFatal() public {
        bytes[] memory txs = new bytes[](5);
        for (uint256 i; i < 4; ++i) {
            txs[i] = _honest(keccak256(abi.encode("honest", i)));
        }

        // Hand the poisoner the relayer role: the worst case, not the expected one.
        registry.setRelayer(address(poisoner));

        vm.recordLogs();
        poisoner.poison(
            registry,
            keccak256("victim-measurement"),
            CONTRIBUTOR,
            block.timestamp - 60,
            _sig(registry, keccak256("victim-measurement"), CONTRIBUTOR)
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 2, "receipt carries the real log and the lookalike");
        assertEq(entries[0].emitter, address(registry), "log 0 is genuine");
        assertEq(entries[1].emitter, address(poisoner), "log 1 is the lookalike");
        assertEq(entries[0].topics[0], entries[1].topics[0], "identical event signature");
        txs[4] = _wrap(entries);

        // Four honest measurements plus the genuine one inside the poisoned receipt.
        assertEq(_run(txs), 5, "every genuine measurement settles");

        for (uint256 i; i < 4; ++i) {
            assertTrue(
                batch.settled(keccak256(abi.encode("honest", i))), "innocent measurement survived the poisoned entry"
            );
        }
        assertTrue(batch.settled(keccak256("victim-measurement")), "the genuine half still settles");
        assertFalse(batch.settled(keccak256("dust")), "the lookalike never settles");
        assertEq(batch.rewards(CONTRIBUTOR), REWARD * 5, "paid for the genuine logs only");
    }

    /// @notice The contract never binds heights to the transactions it decodes: every entry can
    ///         claim the SAME height and the call still succeeds.
    function test_heightsAreNeverCheckedAgainstTheTransactions() public {
        bytes[] memory txs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            txs[i] = _honest(keccak256(abi.encode("h", i)));
        }

        uint64[] memory heights = new uint64[](3);
        heights[0] = 1; // three different, arbitrary, mutually inconsistent heights
        heights[1] = 1;
        heights[2] = type(uint64).max;

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](3);
        for (uint256 i; i < 3; ++i) {
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: bytes32(0), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
        bytes32[] memory roots = new bytes32[](0); // EMPTY shared continuity proof
        assertEq(
            batch.executeBatch(
                1,
                heights,
                txs,
                proofs,
                INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: bytes32(0), roots: roots})
            ),
            3,
            "settles with duplicate heights, zero merkle roots and an empty continuity proof"
        );
    }

    /// @notice Transactions carrying no measurement log at all are silently accepted as padding.
    ///         The sibling reverts with NoMeasurementLog; this contract does not.
    function test_batchAcceptsUnrelatedProvedTransactionsAsPadding() public {
        EvmV1Decoder.LogEntryTuple[] memory none = new EvmV1Decoder.LogEntryTuple[](0);
        bytes[] memory txs = new bytes[](3);
        txs[0] = _honest(keccak256("real"));
        txs[1] = EvmTxFixture.buildType2(1, none); // unrelated Sepolia tx, zero logs
        txs[2] = EvmTxFixture.buildType2(1, none); // unrelated Sepolia tx, zero logs
        assertEq(_run(txs), 1, "padding accepted, only the real one settles");
    }

    /// @notice No transaction-level replay marker: the exact same proof payload can be replayed
    ///         forever. It settles nothing the second time, but nothing on chain records that
    ///         (chainKey, height, txIndex) was ever consumed.
    function test_noQueryIdRecordOfWhatWasProved() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = _honest(keccak256("once"));
        assertEq(_run(txs), 1);

        // Replay the identical payload: reverts only because settledCount hits zero, not because
        // the contract remembers the proof.
        vm.expectRevert(SignalProofBatchSettlement.NoMeasurementSettled.selector);
        _run(txs);
    }
}
