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
///         So authorisation lives here, at the only point that can hold it. The gateway verifies
///         the contributor's signature over the measurement root before relaying
///         (server/routers.ts, verifyMeasurementIntegrity), and the relayer is the trust boundary
///         that carries that verification on-chain.
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
    function submitMeasurement(
        bytes32 measurementRoot,
        bytes32 areaHash,
        address contributor,
        bytes32 sessionHash,
        uint256 timestamp,
        uint256 latencyMs,
        uint256 downloadMbps
    ) external {
        if (msg.sender != relayer) revert NotAuthorised(msg.sender);
        if (measurementRoot == bytes32(0)) revert EmptyRoot();
        if (contributor == address(0)) revert ZeroContributor();
        if (registered[measurementRoot]) revert AlreadyRegistered(measurementRoot);

        registered[measurementRoot] = true;

        emit MeasurementSubmitted(
            measurementRoot,
            areaHash,
            contributor,
            sessionHash,
            timestamp,
            latencyMs,
            downloadMbps
        );
    }
}
