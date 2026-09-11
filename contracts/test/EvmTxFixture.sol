// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Builds `txBytes` in exactly the shape the Attestcoin prover produces, so tests exercise
///         the real EvmV1Decoder rather than a hand-rolled stand-in.
/// @dev    Encoding contract, from EvmV1Decoder's own docblock:
///           abi.encode(uint8 txType, bytes[] chunks)
///           chunk[0] common tx fields, chunk[1] type-specific, chunk[last] receipt fields
///         Types 0-2 have 3 chunks, types 3-4 have 4.
library EvmTxFixture {
    /// @notice Build a type-2 (EIP-1559) transaction payload carrying `logs` and `receiptStatus`.
    function buildType2(
        uint8 receiptStatus,
        EvmV1Decoder.LogEntryTuple[] memory logs
    ) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);

        // chunk[0] — common tx fields
        chunks[0] = abi.encode(
            uint64(1), // nonce
            uint64(200000), // gasLimit
            address(0xA11CE), // from
            false, // toIsNull
            address(0xB0B), // to
            uint256(0), // value
            bytes("") // data
        );

        // chunk[1] — type-2 specific fields
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(11155111), // chainId (Sepolia)
            uint128(1 gwei), // maxPriorityFeePerGas
            uint128(30 gwei), // maxFeePerGas
            accessList,
            uint8(0), // yParity
            bytes32(0), // r
            bytes32(0) // s
        );

        // chunk[2] — receipt fields
        chunks[2] = abi.encode(receiptStatus, uint64(120000), logs, bytes(""));

        return abi.encode(uint8(2), chunks);
    }

    /// @notice Build the log a real SourceBatchRegistry.submitMeasurement call would emit.
    function measurementLog(
        address emitter,
        bytes32 eventSig,
        bytes32 measurementRoot,
        bytes32 areaHash,
        address contributor,
        bytes32 sessionHash,
        uint256 timestamp,
        uint256 latencyMs,
        uint256 downloadMbps
    ) internal pure returns (EvmV1Decoder.LogEntryTuple memory entry) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = eventSig;
        topics[1] = measurementRoot;
        topics[2] = areaHash;
        topics[3] = bytes32(uint256(uint160(contributor)));

        entry = EvmV1Decoder.LogEntryTuple({
            address_: emitter,
            topics: topics,
            data: abi.encode(sessionHash, timestamp, latencyMs, downloadMbps)
        });
    }

    /// @notice Convenience: a single-log type-2 payload with a successful receipt.
    function singleLogTx(EvmV1Decoder.LogEntryTuple memory entry)
        internal
        pure
        returns (bytes memory)
    {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = entry;
        return buildType2(1, logs);
    }
}
