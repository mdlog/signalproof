// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";

contract SourceBatchRegistryTest is Test {
    SourceBatchRegistry registry;

    address constant CONTRIBUTOR = address(0xC0FFEE);
    bytes32 constant ROOT = keccak256("m-1");
    bytes32 constant AREA = keccak256("a9c-46");
    bytes32 constant SESSION = keccak256("session-1");

    function setUp() public {
        registry = new SourceBatchRegistry(address(this));
        vm.warp(1_800_000_000);
    }

    function _submit(bytes32 root) internal {
        registry.submitMeasurement(root, AREA, CONTRIBUTOR, SESSION, block.timestamp, 28, 91);
    }

    function test_registersMeasurement() public {
        _submit(ROOT);
        assertTrue(registry.registered(ROOT));
    }

    /// @dev The topic layout here is the contract that SignalProofSettlement decodes against.
    ///      If this test changes, the destination-chain parser must change with it.
    function test_emitsExpectedTopicLayout() public {
        vm.recordLogs();
        _submit(ROOT);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 1);

        assertEq(
            entries[0].topics[0],
            keccak256(
                "MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)"
            )
        );
        assertEq(entries[0].topics[1], ROOT, "topics[1] must be measurementRoot");
        assertEq(entries[0].topics[2], AREA, "topics[2] must be areaHash");
        assertEq(
            address(uint160(uint256(entries[0].topics[3]))),
            CONTRIBUTOR,
            "topics[3] must be contributor"
        );

        (bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps) =
            abi.decode(entries[0].data, (bytes32, uint256, uint256, uint256));
        assertEq(sessionHash, SESSION);
        assertEq(timestamp, block.timestamp);
        assertEq(latencyMs, 28);
        assertEq(downloadMbps, 91);
    }

    function test_rejectsDuplicateRoot() public {
        _submit(ROOT);
        vm.expectRevert(
            abi.encodeWithSelector(SourceBatchRegistry.AlreadyRegistered.selector, ROOT)
        );
        _submit(ROOT);
    }

    function test_rejectsEmptyRoot() public {
        vm.expectRevert(SourceBatchRegistry.EmptyRoot.selector);
        _submit(bytes32(0));
    }

    function test_rejectsZeroContributor() public {
        vm.expectRevert(SourceBatchRegistry.ZeroContributor.selector);
        registry.submitMeasurement(ROOT, AREA, address(0), SESSION, block.timestamp, 28, 91);
    }

    function test_distinctRootsBothRegister() public {
        _submit(keccak256("a"));
        _submit(keccak256("b"));
        assertTrue(registry.registered(keccak256("a")));
        assertTrue(registry.registered(keccak256("b")));
    }

    function testFuzz_anyNonZeroRootRegistersOnce(bytes32 root) public {
        vm.assume(root != bytes32(0));
        _submit(root);
        assertTrue(registry.registered(root));
        vm.expectRevert(
            abi.encodeWithSelector(SourceBatchRegistry.AlreadyRegistered.selector, root)
        );
        _submit(root);
    }
}
