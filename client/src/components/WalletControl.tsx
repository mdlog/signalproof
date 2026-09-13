/**
 * Header wallet control, on RainbowKit.
 *
 * RainbowKit owns the picker (every installed wallet, WalletConnect for phones) and the account
 * modal; this component renders the states in the console's own vocabulary:
 *
 *   disconnected    -> Connect (opens RainbowKit's wallet list)
 *   connecting      -> nothing to press; the wallet has focus
 *   wrong network   -> Switch, prominently — only claim/pay/self-settle need CC3
 *   connected       -> CC3 chip, the address (a link to that address's own profile), Disconnect
 *
 * The wrong-network state is deliberately loud in the header rather than only in a page banner,
 * because that is where a user looks to check their wallet.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CircleAlert, Check, LogOut, Network, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CC3_TESTNET_CHAIN_ID, chainName, shortAddress } from "@/hooks/useWallet";
import type { useWallet } from "@/hooks/useWallet";

type Props = { wallet: ReturnType<typeof useWallet> };

export default function WalletControl({ wallet }: Props) {
  const [switching, setSwitching] = useState(false);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
        const ready = mounted;
        const connected = ready && Boolean(account) && Boolean(chain);

        if (!connected) {
          return (
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                onClick={() => (wallet.status === "disconnected" ? void wallet.connect() : openConnectModal())}
                disabled={!ready}
                aria-label="Connect wallet"
                className="h-9 gap-2 rounded-lg bg-[#102A43] px-3 text-white hover:bg-[#1B3A57]"
              >
                <WalletCards className="h-4 w-4" />
                <span className="hidden sm:inline">{wallet.status === "connecting" ? "Check your wallet…" : "Connect wallet"}</span>
                <span className="sm:hidden">{wallet.status === "connecting" ? "Wallet…" : "Connect"}</span>
              </Button>
              {wallet.error && <span className="max-w-[220px] text-right text-[10px] leading-tight text-[#B44A3C]">{wallet.error}</span>}
            </div>
          );
        }

        const onWrongChain = chain!.id !== CC3_TESTNET_CHAIN_ID;
        const address = account!.address;

        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onWrongChain ? (
              <Button
                size="sm"
                onClick={async () => {
                  setSwitching(true);
                  try {
                    await wallet.switchToCreditcoin();
                  } finally {
                    setSwitching(false);
                  }
                }}
                disabled={switching}
                className="h-9 gap-2 rounded-lg bg-[#9A6517] px-3 text-white hover:bg-[#7A5312]"
                title={`Currently on ${chainName(chain!.id)}. Needed only to claim rewards, pay for access, or self-settle.`}
              >
                <CircleAlert className="h-4 w-4" />
                <span className="hidden sm:inline">{switching ? "Confirm in your wallet…" : "Switch to CC3 Testnet"}</span>
                <span className="sm:hidden">{switching ? "Wallet…" : "Switch"}</span>
              </Button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-[#DDF7F1] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#147A70]"
                title={chainName(chain!.id)}
              >
                <Check className="h-3 w-3" /> CC3
              </span>
            )}

            {/* The address is the identity that will accrue the reward, so it stays visible — and it
                links to that identity's own page: what it measured, earned and claimed. */}
            <Link
              href={`/contributors/${address}`}
              className="inline-block rounded-lg border border-[#DCE5EB] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#426176] hover:border-[#31B7A6] hover:text-[#147A70]"
              title={`${address} — open my profile`}
            >
              {shortAddress(address)}
            </Link>

            <Button
              size="sm"
              variant="outline"
              onClick={openAccountModal}
              aria-label="Wallet account"
              title={`Connected with ${account!.displayName}${wallet.walletName ? ` via ${wallet.walletName}` : ""}. Opens the account panel (copy, explorer, disconnect).`}
              className="hidden h-9 gap-2 rounded-lg border-[#DCE5EB] bg-white px-3 text-[#5F7585] hover:border-[#BFD1D9] sm:inline-flex"
            >
              <WalletCards className="h-4 w-4" />
              <span>{wallet.walletName ?? "Wallet"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => void wallet.disconnect()}
              aria-label="Disconnect wallet"
              title="Forget this connection here. Only your wallet can revoke the permission itself."
              className="h-9 gap-2 rounded-lg border-[#DCE5EB] bg-white px-3 text-[#5F7585] hover:border-[#BFD1D9] hover:text-[#B44A3C]"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Disconnect</span>
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/** Full-width banner for the wrong-network case, shown under the header in every mode. */
export function WrongChainBanner({ wallet }: Props) {
  const [switching, setSwitching] = useState(false);

  const show =
    wallet.status === "connected" &&
    wallet.chainId != null &&
    wallet.chainId !== CC3_TESTNET_CHAIN_ID;
  if (!show) return null;

  return (
    <div className="border-b border-[#F4B95E]/40 bg-[#FFF8EC]">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3 px-5 py-3 lg:px-9">
        <CircleAlert className="h-4 w-4 shrink-0 text-[#9A6517]" />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-[#7A5312]">
          <span className="font-semibold">
            Your wallet is on {chainName(wallet.chainId)}, not Creditcoin CC3 Testnet.
          </span>{" "}
          Measurements still work — the relayer signs and pays gas on both chains. You only need CC3
          to claim a reward, because <code className="font-mono">claim()</code> runs as your own
          address.
        </div>
        <Button
          size="sm"
          onClick={async () => {
            setSwitching(true);
            try {
              await wallet.switchToCreditcoin();
            } finally {
              setSwitching(false);
            }
          }}
          disabled={switching}
          className="shrink-0 gap-2 rounded-lg bg-[#9A6517] text-white hover:bg-[#7A5312]"
        >
          <Network className="h-3.5 w-3.5" />
          {switching ? "Confirm in your wallet…" : "Switch to CC3 Testnet"}
        </Button>
      </div>
    </div>
  );
}
