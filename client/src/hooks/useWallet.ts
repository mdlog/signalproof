/**
 * Browser wallet, on RainbowKit + wagmi.
 *
 * Scope is deliberately tiny: connect (RainbowKit's modal), read the address and chain, switch to
 * Creditcoin, and the handful of things the product asks a wallet to do:
 *   - `signMeasurement` / `signText` — free, gasless EIP-191 signatures. The measurement signature
 *     is what makes reward attribution a claim by the contributor; the registry recovers it on-chain.
 *   - `claimReward` — `claim()` pays `msg.sender`, so it has to come from the contributor's wallet.
 *   - `sendSettlement` — `execute()` from the contributor's own wallet, calldata built server-side.
 *   - `sendValue` — the buyer's payment into the reward pool.
 *
 * Everything else (gas on both chains for submissions) is the relayer's. The interface is the same
 * one the console used before RainbowKit, so no page changed when the connect UI did.
 */

import { useCallback, useMemo } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { buildMeasurementSigningMessage } from "@shared/measurement";
import { CC3_TESTNET_CHAIN_ID, cc3Testnet } from "@/lib/wagmi";

export { CC3_TESTNET_CHAIN_ID };

/** Creditcoin CC3 Testnet as `wallet_addEthereumChain` sees it. 102031 = 0x18e8f. */
export const CC3_TESTNET_PARAMS = {
  chainId: "0x18e8f",
  chainName: "Creditcoin Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: ["https://rpc.cc3-testnet.creditcoin.network"],
  blockExplorerUrls: ["https://creditcoin-testnet.blockscout.com/"],
} as const;

/** keccak256("claim()") first four bytes. Verified against the deployed ABI in abi.test.ts. */
export const CLAIM_SELECTOR = "0x4e71d92d";

export type WalletStatus = "unsupported" | "disconnected" | "connecting" | "connected";

export type WalletState = {
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
  /** Human-readable, mapped from the wallet's error. Never a raw provider message. */
  error: string | null;
  walletName: string | null;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

/** What a wallet error means, in the product's words. */
function describeError(err: unknown, action = "the request"): string {
  const e = err as { name?: string; code?: number; shortMessage?: string; message?: string };
  if (e?.name === "UserRejectedRequestError" || e?.code === 4001) return `You declined ${action}.`;
  if (e?.name === "ConnectorNotConnectedError") return "Connect a wallet first.";
  if (e?.name === "ChainMismatchError" || e?.name === "SwitchChainError") return "Switch to Creditcoin CC3 Testnet first.";
  if (e?.code === -32002) return "A request is already open in your wallet. Check it.";
  const message = e?.shortMessage ?? e?.message;
  return message ? message.slice(0, 160) : `Could not complete ${action}.`;
}

/**
 * Dev-only seam for end-to-end tests: a scripted EIP-1193 provider the harness sets on the window
 * connects without any modal. Compiled out of production builds.
 */
function testProvider(): Eip1193Provider | null {
  if (!import.meta.env.DEV) return null;
  const test = (globalThis as { __signalproofTestProvider?: Eip1193Provider }).__signalproofTestProvider;
  return test?.request ? test : null;
}

export function useWallet() {
  const account = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const { openConnectModal } = useConnectModal();

  const state: WalletState = useMemo(() => {
    const status: WalletStatus =
      account.status === "connected" ? "connected" : account.status === "connecting" || account.status === "reconnecting" ? "connecting" : "disconnected";
    return {
      status,
      address: account.address ?? null,
      chainId: account.chainId ?? null,
      error: null,
      walletName: account.connector?.name ?? null,
    };
  }, [account.status, account.address, account.chainId, account.connector?.name]);

  /** Open RainbowKit's wallet picker — or, under test, connect the scripted provider directly. */
  const connect = useCallback(async () => {
    const test = testProvider();
    if (test) {
      await connectAsync({
        connector: injected({ target: { id: "signalproof-test", name: "SignalProof test wallet", provider: test as never } }),
      });
      return;
    }
    openConnectModal?.();
  }, [connectAsync, openConnectModal]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch {
      /* already disconnected */
    }
  }, [disconnectAsync]);

  /** Only needed to claim, pay, or self-settle — never to submit a measurement. */
  const switchToCreditcoin = useCallback(async (): Promise<boolean> => {
    try {
      await switchChainAsync({ chainId: cc3Testnet.id });
      return true;
    } catch {
      return false;
    }
  }, [switchChainAsync]);

  const requireCc3 = useCallback(
    (what: string): string | null => {
      if (!account.address) return "Connect a wallet first.";
      if (account.chainId !== CC3_TESTNET_CHAIN_ID) return `Switch to Creditcoin CC3 Testnet before ${what}.`;
      return null;
    },
    [account.address, account.chainId],
  );

  /** `claim()` on a settlement contract: the only transaction the product asks a contributor for. */
  const claimReward = useCallback(
    async (settlementAddress: string): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const blocked = requireCc3("claiming");
      if (blocked) return { ok: false, error: blocked };
      try {
        const txHash = await sendTransactionAsync({ to: settlementAddress as `0x${string}`, data: CLAIM_SELECTOR, chainId: CC3_TESTNET_CHAIN_ID });
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err, "the claim") };
      }
    },
    [requireCc3, sendTransactionAsync],
  );

  /** `execute()` from the contributor's own wallet, with calldata the server built from the live proof. */
  const sendSettlement = useCallback(
    async (settlementAddress: string, calldata: string, gasLimit: string): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const blocked = requireCc3("settling");
      if (blocked) return { ok: false, error: blocked };
      try {
        const txHash = await sendTransactionAsync({
          to: settlementAddress as `0x${string}`,
          data: calldata as `0x${string}`,
          gas: BigInt(gasLimit),
          chainId: CC3_TESTNET_CHAIN_ID,
        });
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err, "the settlement") };
      }
    },
    [requireCc3, sendTransactionAsync],
  );

  /** Plain CTC into the settlement contract — the buyer's payment lands in the reward pool. */
  const sendValue = useCallback(
    async (to: string, valueWei: bigint): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const blocked = requireCc3("paying");
      if (blocked) return { ok: false, error: blocked };
      try {
        const txHash = await sendTransactionAsync({ to: to as `0x${string}`, value: valueWei, chainId: CC3_TESTNET_CHAIN_ID });
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err, "the payment") };
      }
    },
    [requireCc3, sendTransactionAsync],
  );

  /** EIP-191 over arbitrary text — proving that the redeemer of an API key is the address that paid. */
  const signText = useCallback(
    async (message: string): Promise<{ ok: boolean; signature?: string; error?: string }> => {
      if (!account.address) return { ok: false, error: "Connect a wallet first." };
      try {
        const signature = await signMessageAsync({ message });
        return { ok: true, signature };
      } catch (err) {
        return { ok: false, error: describeError(err, "to sign") };
      }
    },
    [account.address, signMessageAsync],
  );

  /**
   * Sign a measurement root with the contributor's key. The shared builder produces the exact text
   * the registry contract rebuilds and recovers on-chain, so the two can never disagree.
   */
  const signMeasurement = useCallback(
    async (measurementRoot: string, contributorAddress: string): Promise<{ ok: boolean; signature?: string; error?: string }> => {
      if (!account.address) return { ok: false, error: "Connect a wallet first." };
      // A measurement takes ~20 s to collect — enough time to switch accounts in the wallet. The
      // payload names whichever address the run started with; signing as another would be refused
      // by the gateway as SIGNATURE_MISMATCH, which reads as "broken" rather than "you switched".
      if (contributorAddress.toLowerCase() !== account.address.toLowerCase()) {
        return { ok: false, error: "Your wallet switched accounts during the test. Run it again." };
      }
      try {
        const signature = await signMessageAsync({ message: buildMeasurementSigningMessage({ measurementRoot, contributorAddress }) });
        return { ok: true, signature };
      } catch (err) {
        return { ok: false, error: describeError(err, "to sign the measurement") };
      }
    },
    [account.address, signMessageAsync],
  );

  return { ...state, connect, disconnect, switchToCreditcoin, claimReward, sendSettlement, sendValue, signText, signMeasurement };
}

export function chainName(chainId: number | null): string {
  switch (chainId) {
    case CC3_TESTNET_CHAIN_ID: return "Creditcoin CC3 Testnet";
    case 102032: return "Creditcoin Devnet";
    case 102030: return "Creditcoin Mainnet";
    case 11155111: return "Ethereum Sepolia";
    case 1: return "Ethereum Mainnet";
    case null: return "an unknown network";
    default: return `chain ${chainId}`;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
