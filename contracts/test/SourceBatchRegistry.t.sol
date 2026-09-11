// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";

contract SourceBatchRegistryTest is Test {
    SourceBatchRegistry registry;

    address constant RELAYER = address(0x5E1A7E5);

    // The contributor is a key, not an address: every submission must carry its signature.
    uint256 constant CONTRIBUTOR_KEY = 0xA11CE;
    address CONTRIBUTOR;

    bytes32 constant ROOT = keccak256("m-1");
    bytes32 constant AREA = keccak256("a9c-46");
    bytes32 constant SESSION = keccak256("session-1");

    // Produced by server/signalproof/signing.test.ts with ethers' Wallet.signMessage over the text
    // buildMeasurementSigningMessage returns. Anvil default account #1, a public test key. If the
    // TypeScript message changes, regenerate these together with that test.
    uint256 constant VECTOR_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    bytes32 constant VECTOR_ROOT = 0xd7151ae32d6cb45ae12166f0a5bd951e1cf9a5a0cb685a367d0f366ba1ebe7a4;
    address constant VECTOR_CONTRIBUTOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    bytes constant VECTOR_SIG =
        hex"1aa9f13afbf718409dd383bede96a6c4de9bfc725ccdaf4e8eb5bc1f24b295ad40c5ffc93a6b8fbab0c4f729e605d563367b2714be9a6b240a54cbb260b2c0b31c";

    function setUp() public {
        registry = new SourceBatchRegistry(RELAYER);
        CONTRIBUTOR = vm.addr(CONTRIBUTOR_KEY);
        vm.warp(1_800_000_000);
    }

    function _sign(uint256 key, bytes32 root, address contributor) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.signingDigest(root, contributor));
        return abi.encodePacked(r, s, v);
    }

    /// @dev The signature is computed BEFORE any prank/expectRevert: `signingDigest` is an
    ///      external call and would otherwise consume the cheatcode meant for `submitMeasurement`.
    function _submit(bytes32 root) internal {
        bytes memory sig = _sign(CONTRIBUTOR_KEY, root, CONTRIBUTOR);
        _submitWith(root, sig);
    }

    function _submitWith(bytes32 root, bytes memory sig) internal {
        vm.prank(RELAYER);
        registry.submitMeasurement(root, AREA, CONTRIBUTOR, SESSION, block.timestamp, 28, 91, sig);
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
            keccak256("MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)")
        );
        assertEq(entries[0].topics[1], ROOT, "topics[1] must be measurementRoot");
        assertEq(entries[0].topics[2], AREA, "topics[2] must be areaHash");
        assertEq(address(uint160(uint256(entries[0].topics[3]))), CONTRIBUTOR, "topics[3] must be contributor");

        (bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps) =
            abi.decode(entries[0].data, (bytes32, uint256, uint256, uint256));
        assertEq(sessionHash, SESSION);
        assertEq(timestamp, block.timestamp);
        assertEq(latencyMs, 28);
        assertEq(downloadMbps, 91);
    }

    function test_rejectsDuplicateRoot() public {
        _submit(ROOT);
        bytes memory sig = _sign(CONTRIBUTOR_KEY, ROOT, CONTRIBUTOR);
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.AlreadyRegistered.selector, ROOT));
        _submitWith(ROOT, sig);
    }

    function test_rejectsEmptyRoot() public {
        bytes memory sig = _sign(CONTRIBUTOR_KEY, bytes32(0), CONTRIBUTOR);
        vm.expectRevert(SourceBatchRegistry.EmptyRoot.selector);
        _submitWith(bytes32(0), sig);
    }

    function test_rejectsZeroContributor() public {
        vm.expectRevert(SourceBatchRegistry.ZeroContributor.selector);
        vm.prank(RELAYER);
        registry.submitMeasurement(ROOT, AREA, address(0), SESSION, block.timestamp, 28, 91, new bytes(65));
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
        bytes memory sig = _sign(CONTRIBUTOR_KEY, root, CONTRIBUTOR);
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.AlreadyRegistered.selector, root));
        _submitWith(root, sig);
    }

    // ------------------------------------------------------------------------------------------
    // Signature enforcement
    // ------------------------------------------------------------------------------------------

    /// @notice The bytes a real wallet signs through the TypeScript client are accepted here. This
    ///         is the only test that proves the two implementations of the message agree.
    function test_acceptsASignatureProducedByTheTypeScriptClient() public {
        vm.prank(RELAYER);
        registry.submitMeasurement(
            VECTOR_ROOT, keccak256("qqguw6"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 28, 91, VECTOR_SIG
        );
        assertTrue(registry.registered(VECTOR_ROOT));
    }

    function test_signingMessageMatchesTheClientText() public view {
        string memory expected = string.concat(
            unicode"SignalProof — confirm this measurement\n\n",
            "Signing proves this measurement is yours, so the reward is credited to your address.\n",
            "It authorises no transaction and cannot move your funds.\n\n",
            "Measurement: 0xd7151ae32d6cb45ae12166f0a5bd951e1cf9a5a0cb685a367d0f366ba1ebe7a4\n",
            "Contributor: 0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
        );
        assertEq(registry.signingMessage(VECTOR_ROOT, VECTOR_CONTRIBUTOR), expected);
    }

    function testFuzz_recoversTheSignerForAnyRoot(bytes32 root, uint248 keySeed) public view {
        // secp256k1 order minus one: the largest valid private key.
        uint256 key = bound(uint256(keySeed), 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        address contributor = vm.addr(key);
        assertEq(registry.recoverContributor(root, contributor, _sign(key, root, contributor)), contributor);
    }

    /// @notice A relayer that names someone else as the payee holds no signature for that pairing.
    function test_rejectsASignatureFromSomeoneElse() public {
        bytes memory sig = _sign(VECTOR_KEY, VECTOR_ROOT, VECTOR_CONTRIBUTOR);
        address other = address(0xBEEF);
        address recovered = registry.recoverContributor(VECTOR_ROOT, other, sig);
        assertTrue(recovered != other, "recovery must not land on the substituted payee");

        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.SignatureMismatch.selector, recovered, other));
        vm.prank(RELAYER);
        registry.submitMeasurement(VECTOR_ROOT, keccak256("z"), other, keccak256("s"), block.timestamp, 1, 1, sig);
    }

    /// @notice A signature over a different root does not carry over to this one.
    function test_rejectsASignatureOverAnotherRoot() public {
        bytes memory sig = _sign(CONTRIBUTOR_KEY, keccak256("other-root"), CONTRIBUTOR);
        vm.expectRevert();
        vm.prank(RELAYER);
        registry.submitMeasurement(ROOT, AREA, CONTRIBUTOR, SESSION, block.timestamp, 28, 91, sig);
    }

    function test_rejectsAMalformedSignature() public {
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.BadSignatureLength.selector, 3));
        vm.prank(RELAYER);
        registry.submitMeasurement(
            VECTOR_ROOT, keccak256("z"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 1, 1, hex"010203"
        );
    }

    /// @notice Both controls stay: an outsider with a perfectly valid signature is still refused,
    ///         because the gateway's admission checks are what the relayer gate carries on-chain.
    function test_theRelayerGateIsStillCheckedFirst() public {
        address outsider = address(0xA77ACC);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, outsider));
        registry.submitMeasurement(
            VECTOR_ROOT, keccak256("z"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 1, 1, VECTOR_SIG
        );
    }

    /// @notice Wallets that return v as 0/1 instead of 27/28 are normalised, not rejected.
    function test_acceptsLegacyVValues() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTRIBUTOR_KEY, registry.signingDigest(ROOT, CONTRIBUTOR));
        bytes memory sig = abi.encodePacked(r, s, uint8(v - 27));
        vm.prank(RELAYER);
        registry.submitMeasurement(ROOT, AREA, CONTRIBUTOR, SESSION, block.timestamp, 28, 91, sig);
        assertTrue(registry.registered(ROOT));
    }
}
