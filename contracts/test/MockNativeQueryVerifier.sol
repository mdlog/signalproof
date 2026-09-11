// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Stand-in for the BlockProver precompile at 0xFD2 so contract logic can be tested
///         without a live Creditcoin node. Etched into place with `vm.etch` in the test setup.
/// @dev    Deliberately permissive: it returns whatever the test tells it to. The point of these
///         tests is to prove that SignalProofSettlement enforces the checks the precompile does
///         NOT perform, so the precompile itself is treated as already-passed.
contract MockNativeQueryVerifier {
    bool public shouldVerify = true;
    uint64 public txIndex = 7;

    function setShouldVerify(bool v) external {
        shouldVerify = v;
    }

    function setTxIndex(uint64 v) external {
        txIndex = v;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function verifyAndEmit(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        INativeQueryVerifier.MerkleProof[] calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function verify(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        INativeQueryVerifier.MerkleProof[] calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata)
        external
        view
        returns (uint64)
    {
        return txIndex;
    }
}
