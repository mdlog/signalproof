// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockNativeQueryVerifier} from "./MockNativeQueryVerifier.sol";
import {EvmTxFixture} from "./EvmTxFixture.sol";

contract BatchGasProbe is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CONTRIBUTOR = address(0xC0FFEE);
    uint256 constant REWARD = 0.001 ether;
    uint256 constant MAX_AGE = 24 hours;
    uint256 constant CC3_BLOCK_GAS = 75_000_000;

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
        vm.deal(address(batch), 100 ether);
        vm.warp(1_800_000_000);
    }

    function _tx(bytes32 root, uint256 logsPerTx) internal view returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](logsPerTx);
        for (uint256 j; j < logsPerTx; ++j) {
            logs[j] = EvmTxFixture.measurementLog(
                address(registry),
                sig,
                keccak256(abi.encode(root, j)),
                keccak256("z"),
                CONTRIBUTOR,
                keccak256("s"),
                block.timestamp - 60,
                28,
                91
            );
        }
        return EvmTxFixture.buildType2(1, logs);
    }

    function _measure(uint256 n, uint256 logsPerTx) internal returns (uint256 gasUsed) {
        bytes[] memory txs = new bytes[](n);
        uint64[] memory heights = new uint64[](n);
        INativeQueryVerifier.MerkleProof[] memory proofs =
            new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            txs[i] = _tx(keccak256(abi.encode(n, logsPerTx, i, block.number)), logsPerTx);
            heights[i] = uint64(11_657_000 + i);
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: keccak256(abi.encode(i)),
                siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = keccak256("c");
        INativeQueryVerifier.ContinuityProof memory shared =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("l"), roots: roots});

        uint256 before = gasleft();
        batch.executeBatch(1, heights, txs, proofs, shared);
        gasUsed = before - gasleft();
    }

    /// @notice Gas per entry is NOT constant: memory allocated by the decoder is never reclaimed,
    ///         so the quadratic memory-expansion term dominates as the batch grows.
    function test_gasScalingOneLogPerTx() public {
        uint256[6] memory sizes = [uint256(1), 10, 25, 50, 100, 200];
        uint256 prev;
        uint256 prevN;
        for (uint256 k; k < sizes.length; ++k) {
            // fresh contract per size so `settled` never interferes
            batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
            vm.deal(address(batch), 100 ether);
            uint256 g = _measure(sizes[k], 1);
            uint256 perEntry = g / sizes[k];
            uint256 marginal = prevN == 0 ? 0 : (g - prev) / (sizes[k] - prevN);
            console.log("n=%s totalGas=%s perEntry=%s", sizes[k], g, perEntry);
            console.log("        marginal gas per extra entry: %s", marginal);
            prev = g;
            prevN = sizes[k];
        }
    }

    /// @notice Where one call stops fitting in a CC3 block (75,000,000 gas).
    ///
    /// A ladder, not a binary search. The search this replaced probed sizes into the thousands and
    /// exhausted the test's own gas budget before it could report anything — an OOG in the harness
    /// reads as "no answer", not "the batch is too big". The ladder walks upward and stops at the
    /// first size over the limit, so the number it prints is one it actually measured.
    function test_reportBlockGasCeiling() public {
        uint256[4] memory ladder = [uint256(200), 400, 600, 800];
        uint256 lastFitting;
        for (uint256 k; k < ladder.length; ++k) {
            batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
            vm.deal(address(batch), 1000 ether);
            uint256 g = _measure(ladder[k], 1);
            console.log("n=%s totalGas=%s", ladder[k], g);
            if (g > CC3_BLOCK_GAS) {
                console.log("first size over the 75,000,000 block limit: %s", ladder[k]);
                console.log("largest measured size that still fits:      %s", lastFitting);
                return;
            }
            lastFitting = ladder[k];
        }
        console.log("still fits at n=%s; the ceiling is above the ladder", lastFitting);
    }

    /// @notice Same ladder, but with 8 measurement logs packed into each proved transaction.
    ///
    /// This is the shape the worker should actually aim for: measurements per PROOF is what the
    /// batch overload saves on, and packing logs into fewer transactions beats adding transactions.
    function test_reportBlockGasCeilingMultiLog() public {
        uint256[4] memory ladder = [uint256(25), 50, 100, 200];
        uint256 lastFitting;
        for (uint256 k; k < ladder.length; ++k) {
            batch = new SignalProofBatchSettlement(address(registry), REWARD, MAX_AGE);
            vm.deal(address(batch), 1000 ether);
            uint256 g = _measure(ladder[k], 8);
            console.log("n=%s (8 logs each, %s measurements) totalGas=%s", ladder[k], ladder[k] * 8, g);
            if (g > CC3_BLOCK_GAS) {
                console.log("first size over the block limit: %s txs", ladder[k]);
                console.log("largest measured size that fits: %s txs", lastFitting);
                return;
            }
            lastFitting = ladder[k];
        }
        console.log("still fits at n=%s txs; the ceiling is above the ladder", lastFitting);
    }
}
