/**
 * Wallet stack: RainbowKit for the connect UI, wagmi for connectors and chain state, viem underneath.
 *
 * Two chains are declared. Creditcoin CC3 Testnet is where the only user transactions happen
 * (`claim()`, paying for API access, self-settling a proof); Ethereum Sepolia is listed so a wallet
 * that happens to be on it is recognised rather than shown as "unknown network" — submitting a
 * measurement never needs the wallet on any particular chain.
 *
 * A WalletConnect project id enables the QR/mobile-wallet route; without one, injected wallets
 * (MetaMask and friends) still connect, which is what the console needs.
 */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { reconnect } from "@wagmi/core";
import { http, type Chain } from "viem";
import { sepolia } from "viem/chains";

export const CC3_TESTNET_CHAIN_ID = 102031;

/** Creditcoin CC3 Testnet — not Devnet (102032) and not Mainnet (102030). */
export const cc3Testnet: Chain = {
  id: CC3_TESTNET_CHAIN_ID,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://creditcoin-testnet.blockscout.com" } },
  testnet: true,
};

const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || "signalproof-no-walletconnect";

export const wagmiConfig = getDefaultConfig({
  appName: "SignalProof",
  appDescription: "Verifiable connectivity data, settled on Creditcoin via the Attestcoin Protocol.",
  appIcon: "https://signalproof.mdloglabs.org/icon-512.png",
  projectId,
  chains: [cc3Testnet, sepolia],
  transports: {
    [cc3Testnet.id]: http("https://rpc.cc3-testnet.creditcoin.network"),
    [sepolia.id]: http(),
  },
  ssr: false,
});

/** Whether a WalletConnect project id is configured — the QR/mobile route needs one. */
export const walletConnectEnabled = projectId !== "signalproof-no-walletconnect";

/**
 * Reconnect only the wallet used last time.
 *
 * wagmi's default reconnect asks every installed wallet `isAuthorized()` in turn and waits for each
 * answer. On a browser with several extensions one locked wallet (Rabby, Leap) never answers, the
 * loop never ends, and the header sits on "connecting" forever. So `WagmiProvider` gets
 * `reconnectOnMount={false}` and this runs instead: the one connector wagmi recorded as most recent,
 * behind a timeout, and nothing else is probed.
 */
export async function reconnectRecentWallet(): Promise<void> {
  let recent: string | null = null;
  try {
    recent = JSON.parse(localStorage.getItem("wagmi.recentConnectorId") ?? "null") as string | null;
  } catch {
    return;
  }
  if (!recent) return;
  const connector = wagmiConfig.connectors.find((c) => c.id === recent);
  if (!connector) return;
  await Promise.race([
    reconnect(wagmiConfig, { connectors: [connector] }).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 6_000)),
  ]);
}
