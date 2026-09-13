/**
 * Browser wallet connection.
 *
 * Scope is deliberately tiny: connect, read the address, watch for changes, and two signatures.
 *
 * The relayer pays gas on both chains, so contributing costs the user nothing. The wallet is asked
 * for exactly two things:
 *   - `signMeasurement` — a free, gasless personal_sign over the measurement root. This is what
 *     makes reward attribution a claim by the contributor rather than an assertion by whoever
 *     called the API.
 *   - `claimReward` — the only real transaction, because `claim()` pays `msg.sender` and therefore
 *     has to originate from the contributor's own wallet on Creditcoin.
 *
 * No wallet library. `ethers` is already a dependency and its BrowserProvider implements EIP-6963
 * discovery, so wagmi/RainbowKit would add a large surface for capability we already have.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dedupeAnnouncements, pickWallet, WALLET_PREFERENCE_KEY, type WalletInfo } from "@/lib/walletChoice";
import { buildMeasurementSigningMessage } from "@shared/measurement";

/** Creditcoin CC3 Testnet, for wallet_addEthereumChain. 102031 = 0x18e8f. */
export const CC3_TESTNET_PARAMS = {
  chainId: "0x18e8f",
  chainName: "Creditcoin Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: ["https://rpc.cc3-testnet.creditcoin.network"],
  blockExplorerUrls: ["https://creditcoin-testnet.blockscout.com/"],
} as const;

export const CC3_TESTNET_CHAIN_ID = 102031;

/** keccak256("claim()") first four bytes. Verified against the deployed ABI in abi.test.ts. */
export const CLAIM_SELECTOR = "0x4e71d92d";

export type WalletStatus =
  | "unsupported" // no injected provider found at all
  | "disconnected"
  | "choosing" // several wallets are installed and none was chosen yet
  | "connecting"
  | "connected";

export type WalletState = {
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
  /** Human-readable, already mapped from EIP-1193 error codes. Never a raw provider message. */
  error: string | null;
  walletName: string | null;
  /** Installed wallets to choose from, only while status is "choosing". */
  choices: WalletInfo[];
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

/** EIP-1193 error codes we can say something useful about. */
function describeError(err: unknown, action = "the connection request", walletName: string | null = null): string {
  const code = (err as { code?: number })?.code;
  // Named, because with several wallets installed the one that answered may not be the one the
  // user was looking at: "Rabby Wallet rejected…" explains what "You rejected…" hid.
  if (code === 4001) {
    return action === "the connection request"
      ? `${walletName ?? "The wallet"} rejected the connection request. Unlock it, or choose another wallet.`
      : `${walletName ?? "The wallet"} declined ${action}.`;
  }
  if (code === -32002) return "A connection request is already open in your wallet. Check it.";
  if (code === 4900) return "Your wallet is disconnected from all chains.";
  if (code === 4901) return "Your wallet is not connected to the requested chain.";
  const message = (err as { message?: string })?.message;
  return message ? message.slice(0, 160) : "Could not connect to a wallet.";
}

function injected(): Eip1193Provider | null {
  const eth = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

/**
 * Dev-only seam for end-to-end tests: a provider the harness sets on the window wins discovery,
 * so a browser with a real wallet installed can still be driven by a scripted one. Compiled out
 * of production builds — `import.meta.env.DEV` is a build-time constant.
 */
function testProvider(): Eip1193Provider | null {
  if (!import.meta.env.DEV) return null;
  const test = (globalThis as { __signalproofTestProvider?: Eip1193Provider }).__signalproofTestProvider;
  return test?.request ? test : null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    status: "disconnected",
    address: null,
    chainId: null,
    error: null,
    walletName: null,
    choices: [],
  });
  const providerRef = useRef<Eip1193Provider | null>(null);
  /** Every EIP-6963 announcement seen, so a chosen uuid can be mapped back to its provider. */
  const announcedRef = useRef<Map<string, { info: WalletInfo; provider: Eip1193Provider }>>(new Map());

  /** Discover a provider: EIP-6963 first, then the legacy window.ethereum. */
  /**
   * Every installed wallet, through EIP-6963; the legacy window.ethereum as a last resort.
   *
   * ethers' own discover() returns the FIRST wallet that announces itself, which on a machine with
   * several extensions is whichever loaded first — not the one the user meant. One such machine
   * had eleven, led by Rabby, and every "Connect wallet" click went there.
   */
  const discoverAll = useCallback(async (): Promise<WalletInfo[]> => {
    const announced: Array<{ info: WalletInfo; provider: Eip1193Provider }> = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info: WalletInfo; provider: Eip1193Provider }>).detail;
      if (detail?.info?.uuid && typeof detail.provider?.request === "function") announced.push(detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((r) => setTimeout(r, 400));
    window.removeEventListener("eip6963:announceProvider", onAnnounce);

    for (const a of announced) announcedRef.current.set(a.info.uuid, a);
    const unique = dedupeAnnouncements(announced.map((a) => a.info));
    if (unique.length > 0) return unique;

    const legacy = injected();
    if (legacy) {
      const info: WalletInfo = { uuid: "legacy", name: "Injected wallet", rdns: "legacy", icon: "" };
      announcedRef.current.set("legacy", { info, provider: legacy });
      return [info];
    }
    return [];
  }, []);

  const rememberedRdns = (): string | null => {
    try {
      return localStorage.getItem(WALLET_PREFERENCE_KEY);
    } catch {
      return null;
    }
  };

  const adopt = (info: WalletInfo): Eip1193Provider | null => {
    const entry = announcedRef.current.get(info.uuid);
    if (!entry) return null;
    setState((s) => ({ ...s, walletName: info.name, choices: [] }));
    providerRef.current = entry.provider;
    return entry.provider;
  };

  /**
   * Discover a provider without asking: the test seam, then the remembered wallet, then the only
   * wallet. With several wallets and no memory this returns null — the silent paths (reconnect on
   * load, claim, sign) stay silent, and connect() is the one place that asks.
   */
  const discover = useCallback(async (): Promise<Eip1193Provider | null> => {
    const test = testProvider();
    if (test) return test;
    const choice = pickWallet(await discoverAll(), rememberedRdns());
    return choice.kind === "pick" ? adopt(choice.wallet) : null;
  }, [discoverAll]);

  /**
   * Restore an existing authorisation without prompting.
   *
   * `eth_accounts` returns the already-permitted accounts and never opens the wallet UI, so a
   * returning visitor is reconnected silently. `eth_requestAccounts` is reserved for the click.
   */
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const test = testProvider();
      const wallets = test ? [] : await discoverAll();
      if (cancelled) return;

      if (!test && wallets.length === 0) {
        setState((s) => ({ ...s, status: "unsupported" }));
        return;
      }
      // Several wallets and nothing remembered: stay "disconnected" and let the click ask.
      const choice = test ? null : pickWallet(wallets, rememberedRdns());
      const provider = test ?? (choice?.kind === "pick" ? adopt(choice.wallet) : null);
      if (!provider) return;
      providerRef.current = provider;

      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        if (cancelled) return;
        if (accounts?.length) {
          setState((s) => ({
            ...s,
            status: "connected",
            address: accounts[0],
            chainId: Number.parseInt(chainIdHex, 16),
          }));
        }
      } catch {
        /* leave as disconnected */
      }

      const onAccounts = (...args: never[]) => {
        const accounts = args[0] as unknown as string[];
        setState((s) =>
          accounts?.length
            ? { ...s, status: "connected", address: accounts[0], error: null }
            : { ...s, status: "disconnected", address: null, chainId: null },
        );
      };
      const onChain = (...args: never[]) => {
        // React to the change rather than reloading the page — a reload here would discard an
        // in-flight measurement.
        const chainIdHex = args[0] as unknown as string;
        setState((s) => ({ ...s, chainId: Number.parseInt(chainIdHex, 16), error: null }));
      };

      provider.on?.("accountsChanged", onAccounts);
      provider.on?.("chainChanged", onChain);

      unsubscribe = () => {
        provider.removeListener?.("accountsChanged", onAccounts);
        provider.removeListener?.("chainChanged", onChain);
      };
      if (cancelled) unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [discoverAll]);

  const requestAccounts = useCallback(async (provider: Eip1193Provider) => {
    providerRef.current = provider;
    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
      setState((s) => ({
        ...s,
        status: accounts?.length ? "connected" : "disconnected",
        address: accounts?.[0] ?? null,
        chainId: Number.parseInt(chainIdHex, 16),
        error: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "disconnected",
        error: describeError(err, "the connection request", s.walletName),
      }));
    }
  }, []);

  const connect = useCallback(async () => {
    // A test provider set after mount must still win: the click is the moment it is looked for.
    const test = testProvider();
    if (test) return requestAccounts(test);
    if (providerRef.current) return requestAccounts(providerRef.current);

    const choice = pickWallet(await discoverAll(), rememberedRdns());
    if (choice.kind === "none") {
      setState((s) => ({ ...s, status: "unsupported" }));
      return;
    }
    if (choice.kind === "ask") {
      setState((s) => ({ ...s, status: "choosing", choices: choice.wallets, error: null }));
      return;
    }
    const provider = adopt(choice.wallet);
    if (provider) await requestAccounts(provider);
  }, [discoverAll, requestAccounts]);

  /** The user picked one of several installed wallets; remember it and connect. */
  const chooseWallet = useCallback(
    async (uuid: string) => {
      const entry = announcedRef.current.get(uuid);
      if (!entry) return;
      try {
        localStorage.setItem(WALLET_PREFERENCE_KEY, entry.info.rdns);
      } catch {
        /* a private window forgets; connecting still works */
      }
      const provider = adopt(entry.info);
      if (provider) await requestAccounts(provider);
    },
    [requestAccounts],
  );

  /** Back out of the wallet list without connecting. */
  const cancelChoice = useCallback(() => {
    setState((s) => ({ ...s, status: "disconnected", choices: [] }));
  }, []);

  /**
   * Forget the connection locally.
   *
   * EIP-1193 has no disconnect method — permission lives in the wallet, and only the user can
   * revoke it there. This clears our state and says so rather than implying more.
   */
  const disconnect = useCallback(() => {
    setState((s) => ({ ...s, status: "disconnected", address: null, error: null }));
  }, []);

  /** Only needed to claim rewards, never to submit a measurement. */
  const switchToCreditcoin = useCallback(async (): Promise<boolean> => {
    const provider = providerRef.current ?? (await discover());
    if (!provider) {
      setState((s) => ({ ...s, error: "No wallet to switch." }));
      return false;
    }
    providerRef.current = provider;
    setState((s) => ({ ...s, error: null }));
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CC3_TESTNET_PARAMS.chainId }],
      });
      return true;
    } catch (err) {
      // 4902 = chain unknown to the wallet. Adding it is the documented fallback.
      if ((err as { code?: number })?.code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [CC3_TESTNET_PARAMS],
          });
          return true;
        } catch (addErr) {
          setState((s) => ({ ...s, error: describeError(addErr) }));
          return false;
        }
      }
      setState((s) => ({ ...s, error: describeError(err) }));
      return false;
    }
  }, [discover]);

  /**
   * Send SignalProofSettlement.claim() from the connected wallet.
   *
   * This is the ONLY transaction this app ever asks the user to sign. It has to be theirs, because
   * the contract pays `msg.sender` — a relayer calling it would pay the relayer.
   *
   * Requires the wallet to be on CC3; the caller switches first. Calldata is the bare 4-byte
   * selector for `claim()`, so nothing here needs an ABI or a contract instance.
   */
  const claimReward = useCallback(
    async (settlementAddress: string): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const provider = providerRef.current ?? (await discover());
      if (!provider) return { ok: false, error: "No wallet available." };
      if (!state.address) return { ok: false, error: "Connect a wallet first." };

      try {
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        if (Number.parseInt(chainIdHex, 16) !== CC3_TESTNET_CHAIN_ID) {
          return { ok: false, error: "Switch to Creditcoin CC3 Testnet before claiming." };
        }
        const txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: state.address,
              to: settlementAddress,
              // keccak256("claim()")[0:4]
              data: CLAIM_SELECTOR,
            },
          ],
        })) as string;
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err) };
      }
    },
    [discover, state.address],
  );

  /**
   * Send a settlement — `execute()` on the settlement contract — from the user's own wallet.
   *
   * `execute()` is permissionless by design: anyone holding a valid proof may settle it, and all
   * authorisation lives in the contract's checks. This is that property made visible. The server
   * built the calldata from the live Attestcoin proof; the wallet only signs and pays CC3 gas.
   */
  const sendSettlement = useCallback(
    async (
      settlementAddress: string,
      calldata: string,
      gasLimit: string,
    ): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const provider = providerRef.current ?? (await discover());
      if (!provider) return { ok: false, error: "No wallet available." };
      if (!state.address) return { ok: false, error: "Connect a wallet first." };

      try {
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        if (Number.parseInt(chainIdHex, 16) !== CC3_TESTNET_CHAIN_ID) {
          return { ok: false, error: "Switch to Creditcoin CC3 Testnet before settling." };
        }
        const txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: state.address,
              to: settlementAddress,
              data: calldata,
              gas: "0x" + BigInt(gasLimit).toString(16),
            },
          ],
        })) as string;
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err) };
      }
    },
    [discover, state.address],
  );

  /**
   * Send plain CTC from the connected wallet — the buyer's payment into the reward pool.
   *
   * A value transfer to the settlement contract lands in `receive()`, which credits the pool and
   * emits `Funded`. No calldata, no ABI: the buyer pays exactly what contributors later claim.
   */
  const sendValue = useCallback(
    async (to: string, valueWei: bigint): Promise<{ ok: boolean; txHash?: string; error?: string }> => {
      const provider = providerRef.current ?? (await discover());
      if (!provider) return { ok: false, error: "No wallet available." };
      if (!state.address) return { ok: false, error: "Connect a wallet first." };
      try {
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        if (Number.parseInt(chainIdHex, 16) !== CC3_TESTNET_CHAIN_ID) {
          return { ok: false, error: "Switch to Creditcoin CC3 Testnet before paying." };
        }
        const txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: state.address, to, value: "0x" + valueWei.toString(16) }],
        })) as string;
        return { ok: true, txHash };
      } catch (err) {
        return { ok: false, error: describeError(err, "the payment") };
      }
    },
    [discover, state.address],
  );

  /**
   * Sign an arbitrary text with the connected wallet (EIP-191 personal_sign). Used to prove that
   * the redeemer of an API key is the address that paid for it.
   */
  const signText = useCallback(
    async (message: string): Promise<{ ok: boolean; signature?: string; error?: string }> => {
      const provider = providerRef.current ?? (await discover());
      if (!provider || !state.address) return { ok: false, error: "Connect a wallet first." };
      try {
        const signature = (await provider.request({ method: "personal_sign", params: [message, state.address] })) as string;
        return { ok: true, signature };
      } catch (err) {
        return { ok: false, error: describeError(err, "to sign") };
      }
    },
    [discover, state.address],
  );

  /**
   * Sign a measurement root with the contributor's key.
   *
   * Free, gasless, and off-chain — but it is what turns reward attribution into a claim BY the
   * contributor rather than an assertion by whoever called the API. The server recovers the signer
   * and refuses anything that does not match the named contributor.
   */
  const signMeasurement = useCallback(
    async (
      measurementRoot: string,
      contributorAddress: string,
    ): Promise<{ ok: boolean; signature?: string; error?: string }> => {
      const provider = providerRef.current ?? (await discover());
      if (!provider || !state.address) return { ok: false, error: "Connect a wallet first." };

      // A measurement takes ~20 s to collect, which is ample time for the user to switch accounts
      // in their wallet. The payload names whichever address the run started with; signing as a
      // different one would be refused by the gateway as SIGNATURE_MISMATCH — accurate, but it
      // would read as "the app is broken" rather than "you switched accounts".
      if (contributorAddress.toLowerCase() !== state.address.toLowerCase()) {
        return {
          ok: false,
          error: "Your wallet switched accounts during the test. Run it again.",
        };
      }

      try {
        // The shared builder, never the bare root: personal_sign takes its message as hex, so a
        // 0x-prefixed root is decoded to 32 bytes before hashing and can never match a server that
        // verifies text. A message that is not valid hex has one possible reading in every wallet.
        const message = buildMeasurementSigningMessage({ measurementRoot, contributorAddress });
        const signature = (await provider.request({
          method: "personal_sign",
          params: [message, state.address],
        })) as string;
        return { ok: true, signature };
      } catch (err) {
        return { ok: false, error: describeError(err, "to sign the measurement") };
      }
    },
    [discover, state.address],
  );

  return { ...state, connect, chooseWallet, cancelChoice, disconnect, switchToCreditcoin, claimReward, sendSettlement, sendValue, signText, signMeasurement };
}

/** Names the chains a user is plausibly on, so the banner can say more than a bare number. */
export function chainName(chainId: number | null): string {
  if (chainId == null) return "unknown network";
  const known: Record<number, string> = {
    1: "Ethereum Mainnet",
    11155111: "Ethereum Sepolia",
    102030: "Creditcoin Mainnet",
    102031: "Creditcoin CC3 Testnet",
    102032: "Creditcoin Devnet",
    137: "Polygon",
    56: "BNB Chain",
    8453: "Base",
    42161: "Arbitrum One",
    10: "OP Mainnet",
  };
  return known[chainId] ?? `chain ${chainId}`;
}

/** `0x1234…abcd` for display. Never truncate an address that a user must verify in full. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
