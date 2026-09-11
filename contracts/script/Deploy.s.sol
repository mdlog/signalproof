// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {SourceBatchRegistry} from "../src/SourceBatchRegistry.sol";
import {SignalProofSettlement} from "../src/SignalProofSettlement.sol";
import {SignalProofBatchSettlement} from "../src/SignalProofBatchSettlement.sol";

/// @notice Step 1 of 2 — deploy the commitment log on Ethereum Sepolia.
///
/// Run:
///   RELAYER_ADDRESS=0x... forge script script/Deploy.s.sol:DeploySourceRegistry \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
///
/// Then export the printed address as SOURCE_BATCH_REGISTRY_ADDRESS before step 2.
contract DeploySourceRegistry is Script {
    function run() external returns (SourceBatchRegistry registry) {
        // The gateway relayer, not the deployer. It is the address whose signature-checked
        // submissions the registry will accept; see SourceBatchRegistry's authorisation note.
        // Defaults to the deployer so a single-key setup still works, but a mismatch here is
        // the difference between a gated registry and a drainable reward pool, so it is
        // printed back for confirmation.
        address relayer = vm.envOr("RELAYER_ADDRESS", msg.sender);

        vm.startBroadcast();
        registry = new SourceBatchRegistry(relayer);
        vm.stopBroadcast();

        console.log("SourceBatchRegistry deployed at:", address(registry));
        console.log("authorised relayer:", relayer);
        console.log("chain id:", block.chainid);
        console.log("");
        console.log("Next: export SOURCE_BATCH_REGISTRY_ADDRESS=%s", address(registry));
    }
}

/// @notice Step 2 of 2 — deploy the settlement ASC on Creditcoin CC3 Testnet.
///
/// Requires SOURCE_BATCH_REGISTRY_ADDRESS from step 1: the settlement contract binds to that
/// address permanently at construction, and refuses to settle events from anything else.
///
/// Run:
///   forge script script/Deploy.s.sol:DeploySettlement \
///     --rpc-url $CREDITCOIN_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY \
///     --verifier blockscout --verifier-url https://creditcoin-testnet.blockscout.com/api --verify
contract DeploySettlement is Script {
    /// @dev 0.001 CTC per verified measurement. Small on purpose — the CC3 faucet is a Discord
    ///      bot with an undocumented dispense amount, so the reward pool cannot be assumed deep.
    uint256 constant DEFAULT_REWARD = 0.001 ether;
    uint256 constant DEFAULT_MAX_AGE = 24 hours;

    function run() external returns (SignalProofSettlement settlement) {
        address sourceRegistry = vm.envAddress("SOURCE_BATCH_REGISTRY_ADDRESS");
        require(sourceRegistry != address(0), "SOURCE_BATCH_REGISTRY_ADDRESS not set");

        uint256 reward = vm.envOr("SETTLEMENT_REWARD_WEI", DEFAULT_REWARD);
        uint256 maxAge = vm.envOr("SETTLEMENT_MAX_AGE_SECONDS", DEFAULT_MAX_AGE);

        vm.startBroadcast();
        settlement = new SignalProofSettlement(sourceRegistry, reward, maxAge);
        vm.stopBroadcast();

        console.log("SignalProofSettlement deployed at:", address(settlement));
        console.log("chain id:              ", block.chainid);
        console.log("bound sourceRegistry:  ", sourceRegistry);
        console.log("rewardAmount (wei):    ", reward);
        console.log("maxMeasurementAge (s): ", maxAge);
        console.log("");
        console.log("Next: export SETTLEMENT_CONTRACT_ADDRESS=%s", address(settlement));
        console.log("Then fund the reward pool, e.g.:");
        console.log("  cast send %s --value 0.05ether --rpc-url $CREDITCOIN_RPC_URL", address(settlement));
    }
}

/// @notice Optional — top up the settlement reward pool.
///
/// Run:
///   forge script script/Deploy.s.sol:FundSettlement \
///     --rpc-url $CREDITCOIN_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract FundSettlement is Script {
    function run() external {
        address payable settlement = payable(vm.envAddress("SETTLEMENT_CONTRACT_ADDRESS"));
        uint256 amount = vm.envOr("FUND_AMOUNT_WEI", uint256(0.05 ether));

        vm.startBroadcast();
        (bool ok,) = settlement.call{value: amount}("");
        require(ok, "funding failed");
        vm.stopBroadcast();

        console.log("Funded %s with %s wei", settlement, amount);
        console.log("New balance:", settlement.balance);
    }
}

/// @notice Optional — deploy the batch settlement contract alongside the single-proof one.
///
/// Deployed SEPARATELY and additively: SignalProofSettlement keeps its address and the settlements
/// already recorded against it. The batch contract is a second route, not a replacement, so nothing
/// already proven on chain is invalidated by adding it.
///
/// Run:
///   forge create src/SignalProofBatchSettlement.sol:SignalProofBatchSettlement \
///     --rpc-url $CREDITCOIN_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast \
///     --constructor-args $SOURCE_BATCH_REGISTRY_ADDRESS 1000000000000000 86400
contract DeployBatchSettlement is Script {
    function run() external returns (SignalProofBatchSettlement batch) {
        address sourceRegistry = vm.envAddress("SOURCE_BATCH_REGISTRY_ADDRESS");
        require(sourceRegistry != address(0), "SOURCE_BATCH_REGISTRY_ADDRESS not set");
        uint256 reward = vm.envOr("SETTLEMENT_REWARD_WEI", uint256(0.001 ether));
        uint256 maxAge = vm.envOr("SETTLEMENT_MAX_AGE_SECONDS", uint256(24 hours));

        vm.startBroadcast();
        batch = new SignalProofBatchSettlement(sourceRegistry, reward, maxAge);
        vm.stopBroadcast();

        console.log("SignalProofBatchSettlement deployed at:", address(batch));
        console.log("bound sourceRegistry:", sourceRegistry);
    }
}
