// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SignalProofSettlement} from "../src/SignalProofSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

contract SignalProofSettlementTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    address constant SOURCE_REGISTRY = address(0x50AACE);
    address constant IMPOSTOR = address(0xBAD);
    address constant CONTRIBUTOR = address(0xC0FFEE);

    uint256 constant REWARD = 0.01 ether;
    uint256 constant MAX_AGE = 24 hours;

    SignalProofSettlement settlement;
    MockNativeQueryVerifier verifier;

    /// @dev Cached in setUp. Reading it through the contract inside a test would be an EXTERNAL
    ///      call, and vm.expectRevert latches onto the next external call — it would swallow the
    ///      expectation before `execute` ever ran.
    bytes32 sig;

    bytes32 constant AREA = keccak256("a9c-46");
    bytes32 constant SESSION = keccak256("session-1");

    function setUp() public {
        // Put the mock where ASCBase expects the precompile.
        MockNativeQueryVerifier impl = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(impl).code);
        verifier = MockNativeQueryVerifier(VERIFIER_PRECOMPILE);
        verifier.setShouldVerify(true);
        verifier.setTxIndex(7);

        settlement = new SignalProofSettlement(SOURCE_REGISTRY, REWARD, MAX_AGE);
        sig = settlement.MEASUREMENT_SUBMITTED_SIG();
        vm.deal(address(settlement), 10 ether);

        // Move off genesis so freshness arithmetic is meaningful.
        vm.warp(1_800_000_000);
    }

    // ---------------------------------------------------------------- //
    // helpers                                                          //
    // ---------------------------------------------------------------- //

    function _emptySiblings() internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory) {
        return new INativeQueryVerifier.MerkleProofEntry[](0);
    }

    function _execute(bytes memory txBytes) internal returns (bool) {
        bytes32[] memory continuityRoots = new bytes32[](1);
        continuityRoots[0] = keccak256("root");

        return settlement.execute(
            0, // action
            1, // chainKey (Sepolia on CC3 Testnet)
            uint64(11_654_807), // blockHeight
            txBytes,
            keccak256("merkleRoot"),
            _emptySiblings(),
            keccak256("lowerEndpointDigest"),
            continuityRoots
        );
    }

    function _validTx(bytes32 root, uint256 timestamp) internal view returns (bytes memory) {
        return EvmTxFixture.singleLogTx(
            EvmTxFixture.measurementLog(SOURCE_REGISTRY, sig, root, AREA, CONTRIBUTOR, SESSION, timestamp, 28, 91)
        );
    }

    // ---------------------------------------------------------------- //
    // happy path                                                       //
    // ---------------------------------------------------------------- //

    function test_settlesValidMeasurementAndAccruesReward() public {
        bytes32 root = keccak256("m-1");

        assertTrue(_execute(_validTx(root, block.timestamp - 60)));

        assertTrue(settlement.settled(root), "measurement should be marked settled");
        assertEq(settlement.rewards(CONTRIBUTOR), REWARD, "reward should accrue to contributor");
        assertEq(address(CONTRIBUTOR).balance, 0, "no push transfer on the verification path");
    }

    function test_emitsMeasurementVerified() public {
        bytes32 root = keccak256("m-emit");
        vm.recordLogs();
        _execute(_validTx(root, block.timestamp - 60));

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].topics[0] == keccak256("MeasurementVerified(bytes32,bytes32,address,uint256,bytes32)")) {
                assertEq(entries[i].topics[1], root);
                assertEq(entries[i].topics[2], AREA);
                assertEq(address(uint160(uint256(entries[i].topics[3]))), CONTRIBUTOR);
                found = true;
            }
        }
        assertTrue(found, "MeasurementVerified not emitted");
    }

    // ---------------------------------------------------------------- //
    // SECURITY 2 — emitter binding                                     //
    // This is the check the Attestcoin docs example omits. Mirrors      //
    // Gluwa's ASCLoanManagerSourceBinding.t.sol.                        //
    // ---------------------------------------------------------------- //

    function test_rejectsWrongEmitter() public {
        bytes memory forged = EvmTxFixture.singleLogTx(
            EvmTxFixture.measurementLog(
                IMPOSTOR, // <-- lookalike contract, everything else identical
                sig,
                keccak256("m-forged"),
                AREA,
                CONTRIBUTOR,
                SESSION,
                block.timestamp - 60,
                28,
                91
            )
        );

        vm.expectRevert(abi.encodeWithSelector(SignalProofSettlement.WrongEmitter.selector, IMPOSTOR, SOURCE_REGISTRY));
        _execute(forged);

        assertEq(settlement.rewards(CONTRIBUTOR), 0, "forged event must not pay out");
    }

    function test_rejectsWhenSourceRegistryUnset() public {
        settlement.setSourceRegistry(address(0));
        vm.expectRevert(SignalProofSettlement.SourceRegistryNotSet.selector);
        _execute(_validTx(keccak256("m-unset"), block.timestamp - 60));
    }

    // ---------------------------------------------------------------- //
    // SECURITY 1 — receipt status                                      //
    // ---------------------------------------------------------------- //

    function test_rejectsFailedSourceTransaction() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmTxFixture.measurementLog(
            SOURCE_REGISTRY, sig, keccak256("m-reverted"), AREA, CONTRIBUTOR, SESSION, block.timestamp - 60, 28, 91
        );
        bytes memory revertedTx = EvmTxFixture.buildType2(0, logs); // receiptStatus = 0

        vm.expectRevert(abi.encodeWithSelector(SignalProofSettlement.SourceTransactionFailed.selector, uint8(0)));
        _execute(revertedTx);
    }

    // ---------------------------------------------------------------- //
    // replay                                                           //
    // ---------------------------------------------------------------- //

    function test_rejectsReplayedQueryId() public {
        bytes32 root = keccak256("m-replay-query");
        _execute(_validTx(root, block.timestamp - 60));

        // Same chainKey/height/merkleRoot/siblings => same queryId => ASCBase blocks it.
        vm.expectRevert("Query already processed");
        _execute(_validTx(root, block.timestamp - 60));
    }

    function test_rejectsReplayedMeasurementRootAcrossDifferentQueries() public {
        bytes32 root = keccak256("m-replay-root");
        _execute(_validTx(root, block.timestamp - 60));

        // Different txIndex => different queryId => ASCBase lets it through, so the
        // second layer inside _settleOne must catch it.
        verifier.setTxIndex(99);

        vm.expectRevert(abi.encodeWithSelector(SignalProofSettlement.MeasurementAlreadySettled.selector, root));
        _execute(_validTx(root, block.timestamp - 60));
    }

    // ---------------------------------------------------------------- //
    // freshness                                                        //
    // ---------------------------------------------------------------- //

    function test_rejectsStaleMeasurement() public {
        uint256 stale = block.timestamp - MAX_AGE - 1;
        vm.expectRevert(
            abi.encodeWithSelector(SignalProofSettlement.MeasurementTooOld.selector, stale, block.timestamp)
        );
        _execute(_validTx(keccak256("m-stale"), stale));
    }

    function test_rejectsFutureMeasurement() public {
        uint256 future = block.timestamp + 1;
        vm.expectRevert(
            abi.encodeWithSelector(SignalProofSettlement.MeasurementInFuture.selector, future, block.timestamp)
        );
        _execute(_validTx(keccak256("m-future"), future));
    }

    function test_acceptsMeasurementExactlyAtAgeBoundary() public {
        uint256 edge = block.timestamp - MAX_AGE;
        assertTrue(_execute(_validTx(keccak256("m-edge"), edge)));
    }

    // ---------------------------------------------------------------- //
    // proof verification failure                                       //
    // ---------------------------------------------------------------- //

    function test_rejectsWhenPrecompileSaysProofInvalid() public {
        verifier.setShouldVerify(false);
        vm.expectRevert("Proof of inclusion verification failed");
        _execute(_validTx(keccak256("m-badproof"), block.timestamp - 60));
    }

    function test_rejectsTransactionWithNoMeasurementLog() public {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = keccak256("SomethingElse(uint256)");
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: SOURCE_REGISTRY, topics: topics, data: abi.encode(uint256(1))});

        vm.expectRevert(SignalProofSettlement.NoMeasurementLog.selector);
        _execute(EvmTxFixture.buildType2(1, logs));
    }

    // ---------------------------------------------------------------- //
    // rewards — pull pattern                                           //
    // ---------------------------------------------------------------- //

    function test_claimTransfersAndZeroesBalance() public {
        _execute(_validTx(keccak256("m-claim"), block.timestamp - 60));

        uint256 before = CONTRIBUTOR.balance;
        vm.prank(CONTRIBUTOR);
        settlement.claim();

        assertEq(CONTRIBUTOR.balance, before + REWARD);
        assertEq(settlement.rewards(CONTRIBUTOR), 0);
    }

    function test_doubleClaimReverts() public {
        _execute(_validTx(keccak256("m-claim2"), block.timestamp - 60));

        vm.prank(CONTRIBUTOR);
        settlement.claim();

        vm.prank(CONTRIBUTOR);
        vm.expectRevert(SignalProofSettlement.NothingToClaim.selector);
        settlement.claim();
    }

    function test_claimRevertsWhenPoolUnderfunded() public {
        _execute(_validTx(keccak256("m-underfunded"), block.timestamp - 60));

        // Drain the pool via the owner path.
        settlement.withdraw(address(settlement).balance);

        vm.prank(CONTRIBUTOR);
        vm.expectRevert(abi.encodeWithSelector(SignalProofSettlement.InsufficientBalance.selector, REWARD, uint256(0)));
        settlement.claim();

        // Accounting is preserved — the contributor can still claim once refunded.
        assertEq(settlement.rewards(CONTRIBUTOR), REWARD);
    }

    function test_rewardAccruesAcrossMultipleMeasurements() public {
        _execute(_validTx(keccak256("m-a"), block.timestamp - 60));
        verifier.setTxIndex(8);
        _execute(_validTx(keccak256("m-b"), block.timestamp - 60));

        assertEq(settlement.rewards(CONTRIBUTOR), REWARD * 2);
    }

    // ---------------------------------------------------------------- //
    // admin                                                            //
    // ---------------------------------------------------------------- //

    function test_onlyOwnerCanSetSourceRegistry() public {
        vm.prank(IMPOSTOR);
        vm.expectRevert(SignalProofSettlement.NotOwner.selector);
        settlement.setSourceRegistry(IMPOSTOR);
    }

    function test_onlyOwnerCanSetRewardAmount() public {
        vm.prank(IMPOSTOR);
        vm.expectRevert(SignalProofSettlement.NotOwner.selector);
        settlement.setRewardAmount(1 ether);
    }

    function test_zeroRewardStillSettles() public {
        settlement.setRewardAmount(0);
        bytes32 root = keccak256("m-zero");
        assertTrue(_execute(_validTx(root, block.timestamp - 60)));
        assertTrue(settlement.settled(root));
        assertEq(settlement.rewards(CONTRIBUTOR), 0);
    }

    /// @dev The test contract is the contract owner, and `withdraw` pays the owner.
    receive() external payable {}

    function test_receiveFundsThePool() public {
        uint256 before = address(settlement).balance;
        (bool ok,) = address(settlement).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(settlement).balance, before + 1 ether);
    }
}
