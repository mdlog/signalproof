#!/usr/bin/env bash
#
# SignalProof — two-chain deployment.
#
#   ./contracts/deploy.sh check     balances and readiness, no transactions
#   ./contracts/deploy.sh sepolia   deploy SourceBatchRegistry  (Ethereum Sepolia)
#   ./contracts/deploy.sh cc3       deploy SignalProofSettlement (Creditcoin CC3 Testnet)
#   ./contracts/deploy.sh batch     deploy SignalProofBatchSettlement (Creditcoin CC3 Testnet)
#   ./contracts/deploy.sh repoint   point the settlement contracts at the current registry
#   ./contracts/deploy.sh siblings  tell the batch contract which routes have already paid
#   ./contracts/deploy.sh fund [single|batch]   top up a settlement reward pool
#   ./contracts/deploy.sh all       sepolia, then cc3, then fund
#
# Deployed addresses are written back into .env, so the server and the next step pick them up
# without any copy-paste.
#
# Why `forge create` and not `forge script`:
#   CC3 Testnet block headers carry no `mixHash` field, so Foundry's shanghai simulation host
#   aborts with "header validation error: `prevrandao` not set" before it ever sends anything.
#   `forge create` estimates gas over plain JSON-RPC instead of replaying against a forked host,
#   so it is unaffected. Contracts still COMPILE for shanghai, matching the Gluwa toolchain —
#   only the simulation step is bypassed.

set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
ENV_FILE="$ROOT_DIR/.env"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
die() { echo "${RED}error:${RST} $*" >&2; exit 1; }
info() { echo "${DIM}·${RST} $*"; }
good() { echo "${GRN}✓${RST} $*"; }
warn() { echo "${YLW}!${RST} $*"; }

[ -f "$ENV_FILE" ] || die ".env not found. Copy .env.example to .env and fill it in."

# Sourcing .env OVERWRITES the caller's environment, so `FUND_AMOUNT_WEI=2ether ./deploy.sh fund`
# would silently send whatever .env says instead. Tunables are captured first and win afterwards,
# which is the direction everyone expects an explicit variable to go.
_ENV_FUND_AMOUNT_WEI="${FUND_AMOUNT_WEI:-}"
_ENV_SETTLEMENT_REWARD_WEI="${SETTLEMENT_REWARD_WEI:-}"
_ENV_SETTLEMENT_MAX_AGE_SECONDS="${SETTLEMENT_MAX_AGE_SECONDS:-}"

set -a; . "$ENV_FILE"; set +a

FUND_AMOUNT_WEI="${_ENV_FUND_AMOUNT_WEI:-${FUND_AMOUNT_WEI:-}}"
SETTLEMENT_REWARD_WEI="${_ENV_SETTLEMENT_REWARD_WEI:-${SETTLEMENT_REWARD_WEI:-}}"
SETTLEMENT_MAX_AGE_SECONDS="${_ENV_SETTLEMENT_MAX_AGE_SECONDS:-${SETTLEMENT_MAX_AGE_SECONDS:-}}"

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is not set in .env}"
: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is not set in .env}"
: "${CREDITCOIN_RPC_URL:?CREDITCOIN_RPC_URL is not set in .env}"

DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")

# The registry accepts submissions from exactly one address. That address must be the key the
# gateway actually signs Sepolia transactions with, or every measurement will be refused on chain.
# Derived here rather than configured separately, so the two can never drift apart.
: "${SEPOLIA_RELAYER_PRIVATE_KEY:?SEPOLIA_RELAYER_PRIVATE_KEY is not set in .env}"
RELAYER=$(cast wallet address --private-key "$SEPOLIA_RELAYER_PRIVATE_KEY")

REWARD_WEI="${SETTLEMENT_REWARD_WEI:-1000000000000000}"      # 0.001 CTC
MAX_AGE="${SETTLEMENT_MAX_AGE_SECONDS:-86400}"               # 24h
FUND_WEI="${FUND_AMOUNT_WEI:-50000000000000000}"             # 0.05 CTC

# Deploy costs measured live against both chains. Ample headroom on top.
MIN_SEPOLIA_WEI=1000000000000000                             # 0.001 ETH
MIN_CC3_WEI=5000000000000000                                 # 0.005 CTC

# Persist a key back into .env, replacing any existing entry.
put_env() {
  local key=$1 val=$2
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  good "$key=$val  ${DIM}(written to .env)${RST}"
}

balance_of() { cast balance --rpc-url "$1" "$DEPLOYER" 2>/dev/null || echo 0; }

require_chain() {
  local rpc=$1 want=$2 name=$3
  local got; got=$(cast chain-id --rpc-url "$rpc") || die "$name RPC unreachable: $rpc"
  [ "$got" = "$want" ] || die "$name RPC reports chain $got, expected $want. Check $rpc"
}

cmd_check() {
  echo
  echo "Deployer: $DEPLOYER"
  echo "Relayer:  $RELAYER  ${DIM}(the only address the registry will accept)${RST}"
  echo

  require_chain "$SEPOLIA_RPC_URL" 11155111 "Sepolia"
  require_chain "$CREDITCOIN_RPC_URL" 102031 "CC3 Testnet"
  good "both RPCs reachable and on the expected chains"
  echo

  local sep cc3
  sep=$(balance_of "$SEPOLIA_RPC_URL")
  cc3=$(balance_of "$CREDITCOIN_RPC_URL")

  printf '  Sepolia  %s ETH  ' "$(cast from-wei "$sep")"
  if [ "$(echo "$sep >= $MIN_SEPOLIA_WEI" | bc)" = 1 ]; then echo "${GRN}funded${RST}"; else
    echo "${RED}NEEDS FUNDING${RST}"
    echo "      https://faucet.quicknode.com/ethereum/sepolia   (no mainnet-balance gate)"
    echo "      https://sepolia-faucet.pk910.de                 (proof-of-work, no prerequisites)"
  fi

  printf '  CC3      %s CTC  ' "$(cast from-wei "$cc3")"
  if [ "$(echo "$cc3 >= $MIN_CC3_WEI" | bc)" = 1 ]; then echo "${GRN}funded${RST}"; else
    echo "${RED}NEEDS FUNDING${RST}"
    echo "      No web faucet exists. Discord only:"
    echo "      https://discord.gg/creditcoin  ->  #token-faucet  ->  /faucet address:$DEPLOYER"
    echo "      Verify at https://creditcoin-testnet.blockscout.com/address/$DEPLOYER"
  fi
  echo
  info "deploy cost, measured live: ~134k gas on Sepolia, ~1.50M gas on CC3 (0.5 gwei => ~0.00075 CTC)"
  echo
  if [ -n "${SOURCE_BATCH_REGISTRY_ADDRESS:-}" ]; then
    good "registry already deployed: $SOURCE_BATCH_REGISTRY_ADDRESS"
    local gate
    gate=$(cast call "$SOURCE_BATCH_REGISTRY_ADDRESS" "relayer()(address)" --rpc-url "$SEPOLIA_RPC_URL" 2>/dev/null || echo "")
    if [ -z "$gate" ]; then
      echo "  ${RED}UNGATED${RST} — this registry has no relayer() and accepts submissions from anyone."
      echo "          Anyone can name themselves contributor and drain the reward pool."
      echo "          Redeploy with './deploy.sh sepolia', then repoint the settlement contracts."
    elif [ "${gate,,}" = "${RELAYER,,}" ]; then
      good "  gated on the gateway relayer"
    else
      warn "  gated on $gate, but the gateway signs as $RELAYER — submissions will be refused"
    fi
  fi
  [ -n "${SETTLEMENT_CONTRACT_ADDRESS:-}" ] && good "settlement already deployed: $SETTLEMENT_CONTRACT_ADDRESS"

  if [ -n "${BATCH_SETTLEMENT_ADDRESS:-}" ]; then
    good "batch settlement deployed: $BATCH_SETTLEMENT_ADDRESS"
    local n
    n=$(cast call "$BATCH_SETTLEMENT_ADDRESS" "siblingCount()(uint256)" --rpc-url "$CREDITCOIN_RPC_URL" 2>/dev/null || echo "")
    if [ -z "$n" ]; then
      echo "  ${RED}NO CROSS-CHECK${RST} — this batch contract has no siblingCount(). The same measurement"
      echo "                 can settle here AND on the single-proof route, paying twice."
    elif [ "$n" = "0" ]; then
      warn "  siblingSettlements is empty — nothing stops a measurement paying on both routes."
      warn "  Run: ./deploy.sh siblings \$SETTLEMENT_CONTRACT_ADDRESS"
    else
      good "  defers to $n prior route(s) before paying"
      local i=0
      while [ "$i" -lt "$n" ]; do
        echo "      [$i] $(cast call "$BATCH_SETTLEMENT_ADDRESS" "siblingSettlements(uint256)(address)" "$i" --rpc-url "$CREDITCOIN_RPC_URL")"
        i=$((i + 1))
      done
    fi
  fi
  return 0
}

extract_address() { grep -oE 'Deployed to: 0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}' | head -1; }
extract_txhash() { grep -oE 'Transaction hash: 0x[0-9a-fA-F]{64}' | grep -oE '0x[0-9a-fA-F]{64}' | head -1; }

# Record the deploy block so log scans start there instead of at genesis. Without it the first
# page load walks the entire chain: 23 seconds on Sepolia, measured, versus 0.6 with it.
record_deploy_block() {
  local key=$1 rpc=$2 txhash=$3
  [ -n "$txhash" ] || { warn "no transaction hash in the deploy output; $key not recorded"; return 0; }
  local blk
  blk=$(cast receipt "$txhash" blockNumber --rpc-url "$rpc" 2>/dev/null) || { warn "could not read the deploy block"; return 0; }
  put_env "$key" "$blk"
}

cmd_sepolia() {
  require_chain "$SEPOLIA_RPC_URL" 11155111 "Sepolia"
  local bal; bal=$(balance_of "$SEPOLIA_RPC_URL")
  [ "$(echo "$bal >= $MIN_SEPOLIA_WEI" | bc)" = 1 ] || \
    die "Sepolia balance $(cast from-wei "$bal") ETH is below the 0.001 ETH minimum. Run './deploy.sh check' for faucet links."

  info "deploying SourceBatchRegistry to Ethereum Sepolia..."
  info "  authorised relayer: $RELAYER"
  local out addr
  out=$(cd "$CONTRACTS_DIR" && forge create src/SourceBatchRegistry.sol:SourceBatchRegistry \
        --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
        --constructor-args "$RELAYER" 2>&1) || { echo "$out"; die "deploy failed"; }
  addr=$(echo "$out" | extract_address)
  [ -n "$addr" ] || { echo "$out"; die "could not parse the deployed address"; }

  put_env SOURCE_BATCH_REGISTRY_ADDRESS "$addr"
  record_deploy_block SOURCE_BATCH_REGISTRY_DEPLOY_BLOCK "$SEPOLIA_RPC_URL" "$(echo "$out" | extract_txhash)"
  good "https://sepolia.etherscan.io/address/$addr"

  # Read it back. A registry gated on the wrong address is silently broken: deploys fine,
  # verifies fine, and refuses every measurement the gateway ever sends.
  local onchain
  onchain=$(cast call "$addr" "relayer()(address)" --rpc-url "$SEPOLIA_RPC_URL")
  if [ "${onchain,,}" = "${RELAYER,,}" ]; then
    good "on-chain relayer matches the gateway key"
  else
    die "on-chain relayer is $onchain but the gateway signs as $RELAYER"
  fi

  info "verifying on Etherscan..."
  (cd "$CONTRACTS_DIR" && forge verify-contract "$addr" src/SourceBatchRegistry.sol:SourceBatchRegistry \
     --chain-id 11155111 --watch \
     --constructor-args "$(cast abi-encode 'constructor(address)' "$RELAYER")" \
     2>&1 | tail -4) || warn "verification did not complete — the contract is deployed regardless"
}

cmd_cc3() {
  require_chain "$CREDITCOIN_RPC_URL" 102031 "CC3 Testnet"
  local registry="${SOURCE_BATCH_REGISTRY_ADDRESS:-}"
  [ -n "$registry" ] || die "SOURCE_BATCH_REGISTRY_ADDRESS is not set. Run './deploy.sh sepolia' first."

  local bal; bal=$(balance_of "$CREDITCOIN_RPC_URL")
  [ "$(echo "$bal >= $MIN_CC3_WEI" | bc)" = 1 ] || \
    die "CC3 balance $(cast from-wei "$bal") CTC is below the 0.005 CTC minimum. Run './deploy.sh check' for the Discord faucet route."

  info "deploying SignalProofSettlement to CC3 Testnet..."
  info "  bound sourceRegistry: $registry"
  info "  rewardAmount:         $REWARD_WEI wei"
  info "  maxMeasurementAge:    $MAX_AGE s"

  local out addr
  out=$(cd "$CONTRACTS_DIR" && forge create src/SignalProofSettlement.sol:SignalProofSettlement \
        --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
        --constructor-args "$registry" "$REWARD_WEI" "$MAX_AGE" 2>&1) || { echo "$out"; die "deploy failed"; }
  addr=$(echo "$out" | extract_address)
  [ -n "$addr" ] || { echo "$out"; die "could not parse the deployed address"; }

  put_env SETTLEMENT_CONTRACT_ADDRESS "$addr"
  record_deploy_block SETTLEMENT_DEPLOY_BLOCK "$CREDITCOIN_RPC_URL" "$(echo "$out" | extract_txhash)"
  good "https://creditcoin-testnet.blockscout.com/address/$addr"

  info "verifying on Blockscout (no API key required)..."
  (cd "$CONTRACTS_DIR" && forge verify-contract "$addr" src/SignalProofSettlement.sol:SignalProofSettlement \
     --chain-id 102031 --verifier blockscout \
     --verifier-url https://creditcoin-testnet.blockscout.com/api \
     --constructor-args "$(cast abi-encode 'constructor(address,uint256,uint256)' "$registry" "$REWARD_WEI" "$MAX_AGE")" \
     2>&1 | tail -4) || warn "verification did not complete — the contract is deployed regardless, retry later"
}

cmd_batch() {
  require_chain "$CREDITCOIN_RPC_URL" 102031 "CC3 Testnet"
  local registry="${SOURCE_BATCH_REGISTRY_ADDRESS:-}"
  [ -n "$registry" ] || die "SOURCE_BATCH_REGISTRY_ADDRESS is not set. Run './deploy.sh sepolia' first."

  info "deploying SignalProofBatchSettlement to CC3 Testnet..."
  info "  bound sourceRegistry: $registry"
  local out addr
  out=$(cd "$CONTRACTS_DIR" && forge create src/SignalProofBatchSettlement.sol:SignalProofBatchSettlement \
        --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
        --constructor-args "$registry" "$REWARD_WEI" "$MAX_AGE" 2>&1) || { echo "$out"; die "deploy failed"; }
  addr=$(echo "$out" | extract_address)
  [ -n "$addr" ] || { echo "$out"; die "could not parse the deployed address"; }

  put_env BATCH_SETTLEMENT_ADDRESS "$addr"
  record_deploy_block BATCH_SETTLEMENT_DEPLOY_BLOCK "$CREDITCOIN_RPC_URL" "$(echo "$out" | extract_txhash)"
  good "https://creditcoin-testnet.blockscout.com/address/$addr"

  info "verifying on Blockscout..."
  (cd "$CONTRACTS_DIR" && forge verify-contract "$addr" src/SignalProofBatchSettlement.sol:SignalProofBatchSettlement \
     --chain-id 102031 --verifier blockscout \
     --verifier-url https://creditcoin-testnet.blockscout.com/api \
     --constructor-args "$(cast abi-encode 'constructor(address,uint256,uint256)' "$registry" "$REWARD_WEI" "$MAX_AGE")" \
     2>&1 | tail -4) || warn "verification did not complete — the contract is deployed regardless"
}

# Point the already-deployed settlement contracts at a newly deployed registry.
#
# The settlement contracts bind to a source registry so that only events from THAT address can
# settle. Redeploying the registry therefore orphans them until they are repointed. Everything
# already settled survives: `settled` is keyed by measurementRoot and `rewards` by address, so
# neither the seven settled measurements nor any unclaimed balance is touched.
cmd_repoint() {
  require_chain "$CREDITCOIN_RPC_URL" 102031 "CC3 Testnet"
  local registry="${SOURCE_BATCH_REGISTRY_ADDRESS:-}"
  [ -n "$registry" ] || die "SOURCE_BATCH_REGISTRY_ADDRESS is not set."

  local gate
  gate=$(cast call "$registry" "relayer()(address)" --rpc-url "$SEPOLIA_RPC_URL" 2>/dev/null || echo "")
  [ -n "$gate" ] || die "$registry has no relayer() — repointing to an ungated registry is the bug, not the fix."

  for target in "${SETTLEMENT_CONTRACT_ADDRESS:-}" "${BATCH_SETTLEMENT_ADDRESS:-}"; do
    [ -n "$target" ] || continue
    local current
    current=$(cast call "$target" "sourceRegistry()(address)" --rpc-url "$CREDITCOIN_RPC_URL")
    if [ "${current,,}" = "${registry,,}" ]; then
      good "$target already points at $registry"
      continue
    fi
    info "repointing $target: $current -> $registry"
    cast send "$target" "setSourceRegistry(address)" "$registry" \
      --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null
    current=$(cast call "$target" "sourceRegistry()(address)" --rpc-url "$CREDITCOIN_RPC_URL")
    [ "${current,,}" = "${registry,,}" ] || die "repoint did not take: $target still reads $current"
    good "$target -> $registry"
  done
}

# ./deploy.sh fund [single|batch]   — default single
#
# The two settlement contracts hold separate pools. They pay from their own balance and neither can
# draw on the other, so a batch contract with an empty pool settles measurements and then fails to
# pay them out.
# ./deploy.sh siblings <addr>[,<addr>...]
#
# Tell the batch contract which other settlement routes have already paid for measurements, so it
# never pays for the same one again. Retired routes belong on this list too: replacing a contract
# does not un-pay what it settled, and the replacement would otherwise re-pay all of it.
cmd_siblings() {
  local target="${BATCH_SETTLEMENT_ADDRESS:-}"
  [ -n "$target" ] || die "BATCH_SETTLEMENT_ADDRESS is not set. Run './deploy.sh batch' first."

  local list="${1:-${SETTLEMENT_CONTRACT_ADDRESS:-}}"
  [ -n "$list" ] || die "no sibling addresses given and SETTLEMENT_CONTRACT_ADDRESS is unset"

  info "pointing $target at sibling route(s): $list"
  cast send "$target" "setSiblingSettlements(address[])" "[$list]" \
    --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

  local n; n=$(cast call "$target" "siblingCount()(uint256)" --rpc-url "$CREDITCOIN_RPC_URL")
  good "siblingCount() = $n"
  local i=0
  while [ "$i" -lt "$n" ]; do
    echo "    [$i] $(cast call "$target" "siblingSettlements(uint256)(address)" "$i" --rpc-url "$CREDITCOIN_RPC_URL")"
    i=$((i + 1))
  done
}

cmd_fund() {
  local which="${1:-single}" target
  case "$which" in
    single) target="${SETTLEMENT_CONTRACT_ADDRESS:-}"
            [ -n "$target" ] || die "SETTLEMENT_CONTRACT_ADDRESS is not set. Run './deploy.sh cc3' first." ;;
    batch)  target="${BATCH_SETTLEMENT_ADDRESS:-}"
            [ -n "$target" ] || die "BATCH_SETTLEMENT_ADDRESS is not set. Run './deploy.sh batch' first." ;;
    *)      die "fund takes 'single' or 'batch', not '$which'" ;;
  esac

  info "funding the $which reward pool with $(cast from-wei "$FUND_WEI") CTC..."
  cast send "$target" --value "$FUND_WEI" \
    --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null
  good "$which pool balance: $(cast from-wei "$(cast balance --rpc-url "$CREDITCOIN_RPC_URL" "$target")") CTC"
}

case "${1:-check}" in
  check)   cmd_check ;;
  sepolia) cmd_sepolia ;;
  cc3)     cmd_cc3 ;;
  batch)   cmd_batch ;;
  repoint) cmd_repoint ;;
  siblings) cmd_siblings "${2:-}" ;;
  fund)    cmd_fund "${2:-single}" ;;
  all)     cmd_sepolia; echo; set -a; . "$ENV_FILE"; set +a; cmd_cc3; echo; set -a; . "$ENV_FILE"; set +a; cmd_fund ;;
  *)       die "unknown command '$1'. Use: check | sepolia | cc3 | batch | repoint | siblings | fund | all" ;;
esac
