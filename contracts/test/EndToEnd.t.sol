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

/// @notice Full pipeline, both contracts, no hand-written event fixtures.
///
/// The other suites build the source log by hand. This one does not: it calls the real
/// SourceBatchRegistry, captures whatever it actually emitted, wraps that in prover-shaped
/// txBytes, and feeds it to the real SignalProofSettlement. If the two contracts ever disagree
/// about topic layout or data encoding, this is the test that notices — the hand-written fixtures
/// would happily keep agreeing with themselves.
contract EndToEndTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CONTRIBUTOR = address(0xC0FFEE);
    address constant OTHER_CONTRIBUTOR = address(0xDECAF);

    uint256 constant REWARD = 0.001 ether;
    uint256 constant MAX_AGE = 24 hours;

    SourceBatchRegistry registry;
    SignalProofSettlement settlement;
    MockNativeQueryVerifier verifier;

    function setUp() public {
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);

        registry = new SourceBatchRegistry(address(this));
        settlement = new SignalProofSettlement(address(registry), REWARD, MAX_AGE);
        vm.deal(address(settlement), 1 ether);

        vm.warp(1_800_000_000);
    }

    receive() external payable {}

    /// @dev Emit through the real registry and return prover-shaped txBytes for what it emitted.
    function _captureRealEmission(
        bytes32 root,
        bytes32 area,
        address contributor,
        uint256 timestamp
    ) internal returns (bytes memory) {
        vm.recordLogs();
        registry.submitMeasurement(root, area, contributor, keccak256("session"), timestamp, 28, 91);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 1, "registry should emit exactly one event");

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entries[0].emitter,
            topics: entries[0].topics,
            data: entries[0].data
        });

        return EvmTxFixture.buildType2(1, logs);
    }

    function _execute(bytes memory txBytes, uint64 height) internal returns (bool) {
        bytes32[] memory continuityRoots = new bytes32[](1);
        continuityRoots[0] = keccak256("continuity");

        return settlement.execute(
            0,
            1, // chainKey — Sepolia on CC3 Testnet
            height,
            txBytes,
            keccak256(abi.encode("merkleRoot", height)),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            keccak256("lowerEndpointDigest"),
            continuityRoots
        );
    }

    // ---------------------------------------------------------------- //

    /// @notice measurement -> source event -> proof -> settlement -> claim, end to end.
    function test_fullPipelineFromRegistryEmissionToClaimedReward() public {
        bytes32 root = keccak256("e2e-1");
        bytes32 area = keccak256("a9c-46");

        // 1. Source chain: the gateway relays the commitment.
        bytes memory txBytes = _captureRealEmission(root, area, CONTRIBUTOR, block.timestamp - 120);
        assertTrue(registry.registered(root), "source registry should record the root");

        // 2. Destination chain: the proof worker settles it.
        verifier.setTxIndex(1);
        assertTrue(_execute(txBytes, 11_654_807), "settlement should accept the proven event");

        assertTrue(settlement.settled(root), "measurement should be settled");
        assertEq(settlement.rewards(CONTRIBUTOR), REWARD, "reward should accrue");

        // 3. Contributor pulls the reward.
        uint256 before = CONTRIBUTOR.balance;
        vm.prank(CONTRIBUTOR);
        settlement.claim();
        assertEq(CONTRIBUTOR.balance, before + REWARD, "claim should transfer the reward");
        assertEq(settlement.rewards(CONTRIBUTOR), 0, "balance should be zeroed after claim");
    }

    /// @notice The registry's real topic layout must be what the settlement contract decodes.
    function test_settlementReadsTheRegistrysRealTopicLayout() public {
        bytes32 root = keccak256("e2e-topics");
        bytes32 area = keccak256("zone-42");

        bytes memory txBytes =
            _captureRealEmission(root, area, OTHER_CONTRIBUTOR, block.timestamp - 60);
        verifier.setTxIndex(2);

        vm.recordLogs();
        _execute(txBytes, 11_654_808);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (
                entries[i].topics[0]
                    == keccak256("MeasurementVerified(bytes32,bytes32,address,uint256,bytes32)")
            ) {
                // Values must survive the round trip through the encoder unchanged.
                assertEq(entries[i].topics[1], root, "measurementRoot round-tripped");
                assertEq(entries[i].topics[2], area, "areaHash round-tripped");
                assertEq(
                    address(uint160(uint256(entries[i].topics[3]))),
                    OTHER_CONTRIBUTOR,
                    "contributor round-tripped"
                );
                found = true;
            }
        }
        assertTrue(found, "settlement should emit MeasurementVerified");
    }

    /// @notice Several measurements from several contributors settle independently.
    function test_multipleContributorsAccrueSeparately() public {
        bytes memory txA =
            _captureRealEmission(keccak256("e2e-a"), keccak256("z1"), CONTRIBUTOR, block.timestamp - 60);
        verifier.setTxIndex(10);
        _execute(txA, 11_654_810);

        bytes memory txB = _captureRealEmission(
            keccak256("e2e-b"), keccak256("z2"), OTHER_CONTRIBUTOR, block.timestamp - 60
        );
        verifier.setTxIndex(11);
        _execute(txB, 11_654_811);

        assertEq(settlement.rewards(CONTRIBUTOR), REWARD);
        assertEq(settlement.rewards(OTHER_CONTRIBUTOR), REWARD);
    }

    /// @notice A forged registry cannot settle, even with a proof the precompile accepts.
    ///
    /// This is the whole-system statement of the emitter-binding invariant: the attacker controls
    /// their own contract, emits a byte-identical event, and gets a valid inclusion proof. Only
    /// the destination-chain binding stops them.
    function test_forgedRegistryCannotSettleEvenWithValidProof() public {
        SourceBatchRegistry impostorRegistry = new SourceBatchRegistry(address(this));
        bytes32 root = keccak256("e2e-forged");

        vm.recordLogs();
        impostorRegistry.submitMeasurement(
            root, keccak256("z9"), CONTRIBUTOR, keccak256("session"), block.timestamp - 60, 1, 999
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entries[0].emitter,
            topics: entries[0].topics,
            data: entries[0].data
        });
        bytes memory forgedTx = EvmTxFixture.buildType2(1, logs);

        verifier.setTxIndex(20);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalProofSettlement.WrongEmitter.selector,
                address(impostorRegistry),
                address(registry)
            )
        );
        _execute(forgedTx, 11_654_820);

        assertFalse(settlement.settled(root), "forged measurement must not settle");
        assertEq(settlement.rewards(CONTRIBUTOR), 0, "forged measurement must not pay out");
    }

    /// @notice The source chain refuses a duplicate before the destination chain ever sees it.
    function test_duplicateIsStoppedAtTheSourceChain() public {
        bytes32 root = keccak256("e2e-dup");
        _captureRealEmission(root, keccak256("z3"), CONTRIBUTOR, block.timestamp - 60);

        vm.expectRevert(
            abi.encodeWithSelector(SourceBatchRegistry.AlreadyRegistered.selector, root)
        );
        registry.submitMeasurement(
            root, keccak256("z3"), CONTRIBUTOR, keccak256("session"), block.timestamp, 28, 91
        );
    }

    /// @notice Replaying the same proof is refused by ASCBase before app logic runs.
    function test_replayingTheSameProofIsRefused() public {
        bytes memory txBytes = _captureRealEmission(
            keccak256("e2e-replay"), keccak256("z4"), CONTRIBUTOR, block.timestamp - 60
        );
        verifier.setTxIndex(30);
        _execute(txBytes, 11_654_830);

        vm.expectRevert("Query already processed");
        _execute(txBytes, 11_654_830);

        assertEq(settlement.rewards(CONTRIBUTOR), REWARD, "reward must not double");
    }
}
