/**
 * Header wallet control.
 *
 * Replaces a single button that toggled connect/disconnect with no visible state. Five states, each
 * saying what is true and offering the one action that makes sense:
 *
 *   unsupported     no injected provider          -> where to get one
 *   disconnected    nothing connected             -> Connect
 *   connecting      request open in the wallet    -> nothing (the wallet has focus)
 *   wrong network   connected, not on CC3         -> Switch, prominently
 *   connected       connected, on CC3             -> address + explicit Disconnect
 *
 * The wrong-network state is deliberately loud in the header rather than only in a page banner,
 * because that is where a user looks to check their wallet.
 */

import { useState } from "react";
import { CircleAlert, Check, LogOut, Network, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CC3_TESTNET_CHAIN_ID, chainName, shortAddress } from "@/hooks/useWallet";
import type { useWallet } from "@/hooks/useWallet";

type Props = { wallet: ReturnType<typeof useWallet> };

export default function WalletControl({ wallet }: Props) {
  const [switching, setSwitching] = useState(false);

  const onWrongChain =
    wallet.status === "connected" &&
    wallet.chainId != null &&
    wallet.chainId !== CC3_TESTNET_CHAIN_ID;

  if (wallet.status === "unsupported") {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#DCE5EB] bg-white px-3 text-xs font-semibold text-[#5F7585] transition-colors hover:border-[#BFD1D9]"
      >
        <WalletCards className="h-4 w-4" />
        <span>No wallet found</span>
      </a>
    );
  }

  if (wallet.status !== "connected") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          onClick={() => wallet.connect()}
          disabled={wallet.status === "connecting"}
          aria-label="Connect wallet"
          className="h-9 gap-2 rounded-lg bg-[#102A43] px-3 text-white hover:bg-[#1B3A57]"
        >
          <WalletCards className="h-4 w-4" />
          <span>{wallet.status === "connecting" ? "Check your wallet…" : "Connect wallet"}</span>
        </Button>
        {wallet.error && (
          <span className="max-w-[220px] text-right text-[10px] leading-tight text-[#B44A3C]">
            {wallet.error}
          </span>
        )}
      </div>
    );
  }

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
          title={`Currently on ${chainName(wallet.chainId)}. Needed only to claim rewards.`}
        >
          <CircleAlert className="h-4 w-4" />
          <span>{switching ? "Confirm in your wallet…" : "Switch to CC3 Testnet"}</span>
        </Button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-[#DDF7F1] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#147A70]"
          title={chainName(wallet.chainId)}
        >
          <Check className="h-3 w-3" /> CC3
        </span>
      )}

      {/* The address is the identity that will accrue the reward, so it stays visible. */}
      <span
        className="inline-block rounded-lg border border-[#DCE5EB] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#426176]"
        title={wallet.address ?? undefined}
      >
        {wallet.address ? shortAddress(wallet.address) : ""}
      </span>

      <Button
        size="sm"
        variant="outline"
        onClick={() => wallet.disconnect()}
        aria-label="Disconnect wallet"
        title="Forget this connection here. Only your wallet can revoke the permission itself."
        className="h-9 gap-2 rounded-lg border-[#DCE5EB] bg-white px-3 text-[#5F7585] hover:border-[#BFD1D9] hover:text-[#B44A3C]"
      >
        <LogOut className="h-4 w-4" />
        <span>Disconnect</span>
      </Button>
    </div>
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
