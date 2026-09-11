// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title SourceBatchRegistry
/// @notice Source-chain commitment log for SignalProof measurements (Ethereum Sepolia).
/// @dev    Intentionally minimal. The contract stores a commitment, never the raw measurement,
///         never coordinates, never PII. Its only job is to emit a canonical event that the
///         Attestcoin Protocol can prove inclusion of, and to refuse the same measurementRoot
///         twice so a replay never reaches the destination chain in the first place.
///
///         WHY THIS IS NOT PERMISSIONLESS.
///
///         `contributor` and `timestamp` are chosen by the caller, and the destination-chain
///         contracts read both out of this event to decide who gets paid. Emitter binding on the
///         destination side proves only WHERE an event came from — it cannot know whether this
///         registry should have accepted it. Left open, anyone could call this with their own
///         address as `contributor` and a fresh `timestamp`, obtain a genuine inclusion proof, and
///         drain the reward pool one legitimate-looking measurement at a time. Every downstream
///         check would pass, because nothing about the measurement would be forged — only
///         unauthorised.
///
///         So authorisation lives here, at the only point that can hold it, in two layers that
///         cover different attackers:
///
///         1. ADMISSION — only the relayer may submit. The gateway's checks (freshness, geohash
///            precision, uniqueness, rate limit) are what that key carries on-chain; an outsider
///            with a perfectly valid signature is still refused.
///         2. ATTRIBUTION — the contributor's own EIP-191 signature over the measurement is
///            recovered HERE, from the same text the wallet displayed. A relayer that names a
///            different payee holds no signature for that pairing, so it cannot forge attribution
///            even though it is trusted for admission. Before this check lived on-chain, the
///            gateway verified the signature and the destination chain simply believed it.
contract SourceBatchRegistry {
    /// @notice Emitted once per accepted measurement.
    /// @dev    `contributor` is indexed because SignalProofSettlement on Creditcoin reads it from
    ///         topics[3] to decide who accrues the reward. The architecture doc's original
    ///         pseudocode omitted this field, which left the destination chain with no way to
    ///         identify a payee.
    event MeasurementSubmitted(
        bytes32 indexed measurementRoot,
        bytes32 indexed areaHash,
        address indexed contributor,
        bytes32 sessionHash,
        uint256 timestamp,
        uint256 latencyMs,
        uint256 downloadMbps
    );

    /// @notice measurementRoot => already registered.
    mapping(bytes32 => bool) public registered;

    /// @notice The only address permitted to record measurements.
    address public relayer;
    address public owner;

    event RelayerUpdated(address indexed previous, address indexed current);
    event OwnershipTransferred(address indexed previous, address indexed current);

    error AlreadyRegistered(bytes32 measurementRoot);
    error EmptyRoot();
    error ZeroContributor();
    error NotAuthorised(address caller);
    error NotOwner();
    error ZeroAddress();
    error SignatureMismatch(address recovered, address contributor);
    error BadSignatureLength(uint256 length);

    bytes16 private constant HEX_DIGITS = "0123456789abcdef";

    constructor(address relayer_) {
        if (relayer_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        relayer = relayer_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RelayerUpdated(address(0), relayer_);
    }

    /// @notice Rotate the relayer. A relayer key can be lost or compromised; redeploying the
    ///         registry would orphan every measurement already recorded against this address.
    function setRelayer(address relayer_) external {
        if (msg.sender != owner) revert NotOwner();
        if (relayer_ == address(0)) revert ZeroAddress();
        emit RelayerUpdated(relayer, relayer_);
        relayer = relayer_;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record a measurement commitment.
    /// @param measurementRoot Canonical hash of the full measurement payload.
    /// @param areaHash        Coarse area bucket. Never a precise coordinate.
    /// @param contributor     Address that accrues the reward on Creditcoin.
    /// @param sessionHash     Rotating opaque session identifier.
    /// @param timestamp       Measurement time, epoch seconds, as reported by the gateway.
    /// @param latencyMs       Observed latency in milliseconds.
    /// @param downloadMbps    Observed download throughput in Mbps.
    /// @param signature       The contributor's EIP-191 signature (65 bytes, r‖s‖v) over
    ///                        `signingMessage(measurementRoot, contributor)`.
    function submitMeasurement(
        bytes32 measurementRoot,
        bytes32 areaHash,
        address contributor,
        bytes32 sessionHash,
        uint256 timestamp,
        uint256 latencyMs,
        uint256 downloadMbps,
        bytes calldata signature
    ) external {
        if (msg.sender != relayer) revert NotAuthorised(msg.sender);
        if (measurementRoot == bytes32(0)) revert EmptyRoot();
        if (contributor == address(0)) revert ZeroContributor();
        if (registered[measurementRoot]) revert AlreadyRegistered(measurementRoot);

        address recovered = recoverContributor(measurementRoot, contributor, signature);
        if (recovered != contributor) revert SignatureMismatch(recovered, contributor);

        registered[measurementRoot] = true;

        emit MeasurementSubmitted(
            measurementRoot, areaHash, contributor, sessionHash, timestamp, latencyMs, downloadMbps
        );
    }

    /// @notice The exact text the contributor's wallet displayed and signed (personal_sign).
    /// @dev    Mirrors shared/measurement.ts `buildMeasurementSigningMessage` byte for byte; the
    ///         hex parts are lowercase because keccak256 emits lowercase and the client lowercases
    ///         the address before building the text. Pinned by a signature vector produced with
    ///         ethers in the TypeScript tests.
    function signingMessage(bytes32 measurementRoot, address contributor) public pure returns (string memory) {
        return string.concat(
            unicode"SignalProof — confirm this measurement\n\n",
            "Signing proves this measurement is yours, so the reward is credited to your address.\n",
            "It authorises no transaction and cannot move your funds.\n\n",
            "Measurement: 0x",
            _hex(abi.encodePacked(measurementRoot)),
            "\n",
            "Contributor: 0x",
            _hex(abi.encodePacked(contributor))
        );
    }

    /// @notice EIP-191 digest of `signingMessage`: keccak256("\x19Ethereum Signed Message:\n" ‖ len ‖ text).
    function signingDigest(bytes32 measurementRoot, address contributor) public pure returns (bytes32) {
        bytes memory message = bytes(signingMessage(measurementRoot, contributor));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", _decimal(message.length), message));
    }

    /// @notice Recover the signer of `signingMessage(measurementRoot, contributor)`.
    /// @dev    Accepts v as 27/28 or 0/1; some wallets return the latter.
    function recoverContributor(bytes32 measurementRoot, address contributor, bytes calldata signature)
        public
        pure
        returns (address)
    {
        if (signature.length != 65) revert BadSignatureLength(signature.length);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        return ecrecover(signingDigest(measurementRoot, contributor), v, r, s);
    }

    function _hex(bytes memory data) private pure returns (string memory) {
        bytes memory out = new bytes(data.length * 2);
        for (uint256 i; i < data.length; ++i) {
            uint8 b = uint8(data[i]);
            out[2 * i] = HEX_DIGITS[b >> 4];
            out[2 * i + 1] = HEX_DIGITS[b & 0x0f];
        }
        return string(out);
    }

    function _decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 t = value; t != 0; t /= 10) {
            ++digits;
        }
        bytes memory out = new bytes(digits);
        while (value != 0) {
            out[--digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(out);
    }
}
