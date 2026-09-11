// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignalProofSettlement} from "../src/SignalProofSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

/// @notice Proof that emitter binding alone does not authorise a payout.
///
/// The settlement contracts check WHERE a MeasurementSubmitted came from. They do not, and cannot,
/// check whether the registry should have accepted it. While `submitMeasurement` is permissionless
/// with a caller-chosen `contributor`, an attacker does not need a lookalike registry — the real one
/// will mint them a genuine event naming themselves as payee.
///
/// This test exists to fail loudly if that authorisation is ever removed again.
contract RegistryAuthorisationTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant ATTACKER = address(0xBADBAD);
    address constant RELAYER = address(0x8E11E4);

    uint256 constant REWARD = 0.001 ether;
    uint256 constant POOL = 0.05 ether;

    SourceBatchRegistry registry;
    SignalProofSettlement settlement;
    MockNativeQueryVerifier verifier;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);

        registry = new SourceBatchRegistry(RELAYER);
        settlement = new SignalProofSettlement(address(registry), REWARD, 24 hours);
        vm.deal(address(settlement), POOL);
        vm.warp(1_800_000_000);
    }

    receive() external payable {}

    /// @notice The authorisation that closes the hole: only the relayer may record a measurement.
    function test_attackerCannotSelfMintAMeasurement() public {
        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, ATTACKER)
        );
        registry.submitMeasurement(
            keccak256("self-minted"),
            keccak256("anywhere"),
            ATTACKER, // names itself as payee
            keccak256("session"),
            block.timestamp,
            0,
            0
        );
    }

    /// @notice And the pool therefore survives the attempt.
    function test_poolSurvivesASelfMintingAttempt() public {
        for (uint256 i; i < 5; ++i) {
            vm.prank(ATTACKER);
            vm.expectRevert();
            registry.submitMeasurement(
                keccak256(abi.encode("fake", i)),
                keccak256("z"),
                ATTACKER,
                keccak256("s"),
                block.timestamp,
                0,
                0
            );
        }
        assertEq(settlement.rewards(ATTACKER), 0, "attacker accrued nothing");
        assertEq(address(settlement).balance, POOL, "pool untouched");
    }

    /// @notice The relayer still works, so the authorisation did not break the product.
    function test_relayerCanStillRecordAndSettle() public {
        bytes32 root = keccak256("honest");

        vm.recordLogs();
        vm.prank(RELAYER);
        registry.submitMeasurement(
            root, keccak256("qqguw6"), address(0xC0FFEE), keccak256("s"), block.timestamp - 60, 28, 91
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entries[0].emitter,
            topics: entries[0].topics,
            data: entries[0].data
        });

        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("continuity");
        assertTrue(
            settlement.execute(
                0,
                1,
                11_657_000,
                EvmTxFixture.buildType2(1, logs),
                keccak256("merkle"),
                new INativeQueryVerifier.MerkleProofEntry[](0),
                keccak256("lower"),
                roots
            )
        );
        assertEq(settlement.rewards(address(0xC0FFEE)), REWARD);
    }

    /// @notice The relayer can be rotated without redeploying, since a key can be lost.
    function test_ownerCanRotateTheRelayer() public {
        address next = address(0xBEEF);
        registry.setRelayer(next);

        vm.prank(RELAYER);
        vm.expectRevert();
        registry.submitMeasurement(keccak256("old"), keccak256("z"), ATTACKER, keccak256("s"), block.timestamp, 0, 0);

        vm.prank(next);
        registry.submitMeasurement(keccak256("new"), keccak256("z"), ATTACKER, keccak256("s"), block.timestamp, 0, 0);
        assertTrue(registry.registered(keccak256("new")));
    }
}
