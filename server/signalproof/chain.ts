/**
 * Providers, signers, and Attestcoin chain-key resolution.
 *
 * Everything network-facing on the chain path is constructed here exactly once and reused, so the
 * process holds one Sepolia provider, one Creditcoin provider, and one resolved chainKey rather
 * than rebuilding them on every worker tick.
 *
 * The Attestcoin SDK is CommonJS with no browser build. It must never be imported from anything
 * that ends up in the Vite client bundle.
 */

import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { ENV } from "../_core/env";
import {
  CC3_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  SIGNAL_PROOF_BATCH_ABI,
  SIGNAL_PROOF_SETTLEMENT_ABI,
  SOURCE_BATCH_REGISTRY_ABI,
} from "./abi";

/**
 * Timeout for ProofBuilder HTTP calls.
 *
 * The SDK constructor defaults to 10s and wraps getProof in no retry at all, so a cold proof
 * generation that takes longer is a hard failure. We pass a much larger value and layer our own
 * backoff on top.
 */
const PROOF_BUILDER_TIMEOUT_MS = 120_000;

export type ChainContext = {
  sepolia: JsonRpcProvider;
  creditcoin: JsonRpcProvider;
  sepoliaSigner: Wallet;
  creditcoinSigner: Wallet;
  sourceRegistry: Contract;
  settlement: Contract;
  /**
   * Optional second settlement route: many measurements, one continuity proof.
   *
   * Null when BATCH_SETTLEMENT_ADDRESS is unset. The worker treats batching as an optimisation it
   * may or may not have, never as a requirement — the single-proof path settles everything on its
   * own and stays the fallback for any group the batch route cannot form.
   */
  batchSettlement: Contract | null;
  /**
   * Every settlement route whose payouts must not be repeated, read from the batch contract.
   *
   * The batch contract already holds this list on chain, because it enforces the rule there. The
   * worker reads it back rather than keeping its own copy, so a retired route added on chain is
   * honoured here too without a redeploy — and the two can never disagree about which routes have
   * already paid.
   */
  settlementRoutes: Contract[];
  chainInfoProvider: InstanceType<typeof chainInfo.PrecompileChainInfoProvider>;
  proofBuilder: InstanceType<typeof proofProvider.service.ProofBuilder>;
  /** Attestcoin chain key for Ethereum Sepolia. uint64, resolved at startup, never hardcoded. */
  chainKey: number;
};

let cached: ChainContext | null = null;

/**
 * Resolve the Attestcoin chain key for Ethereum Sepolia.
 *
 * Matching on `chainId` rather than on `chainName` is deliberate and load-bearing. The chain
 * reports the name as "Sepolia ethereum", which does not equal the "Ethereum Sepolia" that the SDK
 * docs show — matching on the name silently finds nothing. Resolving at runtime rather than
 * hardcoding 1 is equally deliberate: on CC3 mainnet the key 1 means a different chain entirely,
 * so a hardcoded value would keep working while proving against the wrong chain.
 */
export async function resolveChainKey(
  provider: InstanceType<typeof chainInfo.PrecompileChainInfoProvider>,
): Promise<number> {
  const chains = await provider.getSupportedChains();
  const sepolia = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);

  if (!sepolia) {
    const available = chains.map((c) => `${c.chainName}(${c.chainId})=${c.chainKey}`).join(", ");
    throw new Error(
      `Ethereum Sepolia (${SEPOLIA_CHAIN_ID}) is not attested on this Creditcoin network. Supported: ${available}`,
    );
  }
  return Number(sepolia.chainKey);
}

/** Build the chain context, verifying that both RPCs point where we think they do. */
export async function getChainContext(): Promise<ChainContext> {
  if (cached) return cached;

  const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, { staticNetwork: true });
  const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });

  // Fail loudly at boot rather than producing proofs against the wrong network later.
  const [sepoliaNet, creditcoinNet] = await Promise.all([
    sepolia.getNetwork(),
    creditcoin.getNetwork(),
  ]);
  if (Number(sepoliaNet.chainId) !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `SEPOLIA_RPC_URL points at chain ${sepoliaNet.chainId}, expected ${SEPOLIA_CHAIN_ID}`,
    );
  }
  if (Number(creditcoinNet.chainId) !== CC3_TESTNET_CHAIN_ID) {
    throw new Error(
      `CREDITCOIN_RPC_URL points at chain ${creditcoinNet.chainId}, expected ${CC3_TESTNET_CHAIN_ID} (CC3 Testnet). Devnet is 102032 and mainnet is 102030.`,
    );
  }

  const sepoliaSigner = new Wallet(ENV.sepoliaRelayerPrivateKey, sepolia);
  const creditcoinSigner = new Wallet(ENV.creditcoinRelayerPrivateKey, creditcoin);

  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
  const chainKey = await resolveChainKey(chainInfoProvider);

  const configuredKey = Number(ENV.attestcoinChainKey);
  if (Number.isFinite(configuredKey) && configuredKey !== chainKey) {
    console.warn(
      `[SignalProof] ATTESTCOIN_CHAIN_KEY=${configuredKey} disagrees with the chain-resolved key ${chainKey}. Using the resolved value.`,
    );
  }

  cached = {
    sepolia,
    creditcoin,
    sepoliaSigner,
    creditcoinSigner,
    sourceRegistry: new Contract(
      ENV.sourceBatchRegistryAddress,
      SOURCE_BATCH_REGISTRY_ABI as unknown as string[],
      sepoliaSigner,
    ),
    settlement: new Contract(
      ENV.settlementContractAddress,
      SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[],
      creditcoinSigner,
    ),
    batchSettlement: ENV.batchSettlementAddress
      ? new Contract(
          ENV.batchSettlementAddress,
          SIGNAL_PROOF_BATCH_ABI as unknown as string[],
          creditcoinSigner,
        )
      : null,
    settlementRoutes: [],
    chainInfoProvider,
    proofBuilder: new proofProvider.service.ProofBuilder(
      chainKey,
      ENV.attestcoinProofServiceUrl,
      PROOF_BUILDER_TIMEOUT_MS,
    ),
    chainKey,
  };

  cached.settlementRoutes = await resolveSettlementRoutes(cached, creditcoinSigner);

  console.log(
    `[SignalProof] chain context ready — Sepolia chainKey=${chainKey}, registry=${ENV.sourceBatchRegistryAddress}, settlement=${ENV.settlementContractAddress}` +
      (ENV.batchSettlementAddress ? `, batch=${ENV.batchSettlementAddress}` : ", batch=disabled") +
      `, routes checked for prior payment=${cached.settlementRoutes.length}`,
  );

  return cached;
}

/**
 * Latest source-chain height attested onto Creditcoin.
 *
 * The worker polls this instead of calling `waitUntilHeightAttested`, which blocks for up to 20
 * minutes. A blocking call inside a polling loop would freeze every other measurement in the
 * queue behind whichever one happened to be first.
 */
export async function getLatestAttestedHeight(ctx: ChainContext): Promise<number> {
  const result = await ctx.chainInfoProvider.getLatestAttestedHeightAndHash(ctx.chainKey);
  return Number(result.height);
}

/**
 * The settlement contracts to ask "have you already paid for this?".
 *
 * Starts from the two configured routes and adds whatever siblings the batch contract names —
 * typically a retired route, which still holds the measurements it settled before it was replaced.
 * Reading the list rather than hardcoding it means retiring a route is a single on-chain call.
 */
async function resolveSettlementRoutes(
  ctx: ChainContext,
  signer: Wallet,
): Promise<Contract[]> {
  const byAddress = new Map<string, Contract>();
  const add = (contract: Contract, address: string) => {
    byAddress.set(address.toLowerCase(), contract);
  };

  add(ctx.settlement, ENV.settlementContractAddress);
  if (ctx.batchSettlement) add(ctx.batchSettlement, ENV.batchSettlementAddress);

  if (ctx.batchSettlement) {
    try {
      const count = Number((await ctx.batchSettlement.siblingCount()) as bigint);
      for (let i = 0; i < count; i++) {
        const address = (await ctx.batchSettlement.siblingSettlements(i)) as string;
        if (byAddress.has(address.toLowerCase())) continue;
        add(
          new Contract(address, SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[], signer),
          address,
        );
      }
    } catch {
      // An older batch contract has no sibling list. Not an error — just fewer routes to ask.
    }
  }
  return [...byAddress.values()];
}

/** Reset the memoised context. Tests only. */
export function __resetChainContext(): void {
  cached = null;
}
