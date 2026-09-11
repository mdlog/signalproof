// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignedSubmit} from "./SignedSubmit.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";
import {SignalProofSettlement} from "../src/SignalProofSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

/// @notice Regression record for the unlimited-mint finding.
///
/// These tests were written to DEMONSTRATE a live vulnerability: `submitMeasurement` was
/// permissionless while `contributor` and `timestamp` were caller-chosen, so anyone could mint
/// themselves genuine, fully-provable measurements and drain the reward pool. They passed. That is
/// why the registry now gates on a relayer.
///
/// They are kept, with their assertions inverted, because the exploit path is the specification of
/// what must stay closed. If the gate is ever removed, these fail first.
contract AdvUnlimitedMint is SignedSubmit {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address ATTACKER;

    uint256 constant REWARD = 0.001 ether; // deploy.sh:42
    uint256 constant MAX_AGE = 24 hours; // deploy.sh:43
    uint256 constant POOL = 0.05 ether; // deploy.sh:44

    SourceBatchRegistry registry;
    SignalProofBatchSettlement batch;
    SignalProofSettlement single;
    MockNativeQueryVerifier verifier;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);

        registry = new SourceBatchRegistry(address(this));
        ATTACKER = _wallet(0xBAD);
        batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
        single = new SignalProofSettlement(address(registry), REWARD, MAX_AGE);
        vm.deal(address(batch), POOL);
        vm.deal(address(single), POOL);
        vm.warp(1_800_000_000);
    }

    function _emit(bytes32 root, address contributor, uint256 ts) internal returns (bytes memory) {
        vm.recordLogs();
        registry.submitMeasurement(
            root, keccak256("zone"), contributor, keccak256("s"), ts, 28, 91, _sig(registry, root, contributor)
        );
        Vm.Log[] memory e = vm.getRecordedLogs();
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: e[0].emitter, topics: e[0].topics, data: e[0].data});
        return EvmTxFixture.buildType2(1, logs);
    }

    function _proofs(uint256 n) internal pure returns (INativeQueryVerifier.MerkleProof[] memory p) {
        p = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            p[i] = INativeQueryVerifier.MerkleProof({
                root: keccak256(abi.encode("m", i)), siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
    }

    function _shared() internal pure returns (INativeQueryVerifier.ContinuityProof memory) {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");
        return INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("lower"), roots: roots});
    }

    /// The attacker cannot assemble the batch at all: the mint fails at the source chain.
    ///
    /// Note where this reverts. Not in `executeBatch` — the batch contract would happily settle
    /// these, because every one of them would be a real event from the real registry with a real
    /// inclusion proof. Nothing downstream can tell them apart. The only place the attack is
    /// distinguishable is the moment of admission, which is why the check lives there.
    function test_attackerCannotAssembleABatchOfSelfNamedMeasurements() public {
        bytes32 junk = keccak256("junk-0");
        bytes memory sig = _sig(registry, junk, ATTACKER);
        vm.prank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, ATTACKER));
        registry.submitMeasurement(junk, keccak256("zone"), ATTACKER, keccak256("s"), block.timestamp, 28, 91, sig);

        assertEq(batch.rewards(ATTACKER), 0, "nothing accrued");
        assertEq(address(batch).balance, POOL, "pool untouched");
    }

    /// The same block protects the single-proof sibling, since both read the same registry.
    ///
    /// One authorisation point covers every settlement route, present and future. That is the
    /// argument for fixing it upstream rather than adding a payee allowlist to each contract.
    function test_theSingleProofSiblingIsCoveredByTheSameGate() public {
        for (uint256 i; i < 5; ++i) {
            bytes32 solo = keccak256(abi.encode("solo", i));
            bytes memory sig = _sig(registry, solo, ATTACKER);
            vm.prank(ATTACKER);
            vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, ATTACKER));
            registry.submitMeasurement(solo, keccak256("zone"), ATTACKER, keccak256("s"), block.timestamp, 28, 91, sig);
        }
        assertEq(single.rewards(ATTACKER), 0, "sibling accrued nothing");
        assertEq(address(single).balance, POOL, "sibling pool untouched");
    }

    /// @notice Freshness is not the control, and never was — authorisation is.
    ///
    /// Kept as a warning against re-deriving safety from `maxMeasurementAge`. The timestamp is
    /// whatever the submitter wrote, so a year can pass and a submission still lands inside the
    /// window. That is acceptable ONLY because the submitter is now the relayer, which stamps the
    /// gateway's own clock. Tighten the window all you like; it filters nothing on its own.
    function test_freshnessWindowIsNotTheControl() public {
        bytes[] memory txs = new bytes[](1);
        uint64[] memory h = new uint64[](1);
        h[0] = 1;

        vm.warp(block.timestamp + 365 days);
        // Submitted by the relayer (address(this)) — an attacker cannot reach this line.
        txs[0] = _emit(keccak256("fresh-forever"), ATTACKER, block.timestamp);

        assertEq(batch.executeBatch(1, h, txs, _proofs(1), _shared()), 1);
        assertEq(batch.rewards(ATTACKER), REWARD, "age alone stops nothing");
    }
}
