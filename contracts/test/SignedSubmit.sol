// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";

/// @notice Test base for anything that records a measurement: the registry demands the
///         contributor's own EIP-191 signature, so every contributor in a test is a key, not an
///         address literal. `_wallet(key)` registers one; `_sig(registry, root, contributor)`
///         signs exactly what the registry will recover.
abstract contract SignedSubmit is Test {
    mapping(address => uint256) internal keyOf;

    function _wallet(uint256 key) internal returns (address who) {
        who = vm.addr(key);
        keyOf[who] = key;
    }

    function _sig(SourceBatchRegistry registry, bytes32 root, address contributor)
        internal
        view
        returns (bytes memory)
    {
        uint256 key = keyOf[contributor];
        require(key != 0, "SignedSubmit: contributor was not created with _wallet(key)");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.signingDigest(root, contributor));
        return abi.encodePacked(r, s, v);
    }
}
