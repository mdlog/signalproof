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
import { Link } from "wouter";
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

  if (wallet.status === "choosing") {
    return (
      <div className="relative">
        <div className="absolute right-0 top-0 z-50 w-64 rounded-xl border border-[#DCE5EB] bg-white p-2 shadow-[0_12px_32px_rgba(16,42,67,.14)]">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold text-[#426176]">
            {wallet.choices.length} wallets installed — which one?
          </div>
          <ul className="max-h-72 overflow-auto">
            {wallet.choices.map((w) => (
              <li key={w.uuid}>
                <button
                  onClick={() => wallet.chooseWallet(w.uuid)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-[#102A43] hover:bg-[#F5F8FA]"
                >
                  {w.icon ? (
                    <img src={w.icon} alt="" className="h-5 w-5 rounded" />
                  ) : (
                    <WalletCards className="h-5 w-5 text-[#8EA0AC]" />
                  )}
                  <span className="truncate">{w.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between border-t border-[#EDF2F5] px-2 pt-2 text-[10px] text-[#8EA0AC]">
            <span>Remembered for next time</span>
            <button onClick={() => wallet.cancelChoice()} className="font-semibold text-[#426176]">Cancel</button>
          </div>
        </div>
        <Button size="sm" disabled className="h-9 gap-2 rounded-lg bg-[#102A43] px-3 text-white opacity-90">
          <WalletCards className="h-4 w-4" />
          <span>Choose a wallet</span>
        </Button>
      </div>
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
          <span className="hidden sm:inline">{wallet.status === "connecting" ? "Check your wallet…" : "Connect wallet"}</span>
          <span className="sm:hidden">{wallet.status === "connecting" ? "Wallet…" : "Connect"}</span>
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

      {/* The address is the identity that will accrue the reward, so it stays visible — and it
          links to that identity's own page: what it measured, earned and claimed. */}
      <Link
        href={`/contributors/${wallet.address ?? ""}`}
        className="inline-block rounded-lg border border-[#DCE5EB] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#426176] hover:border-[#31B7A6] hover:text-[#147A70]"
        title={wallet.address ? `${wallet.address} — open my profile` : undefined}
      >
        {wallet.address ? shortAddress(wallet.address) : ""}
      </Link>

      <Button
        size="sm"
        variant="outline"
        onClick={() => wallet.disconnect()}
        aria-label="Disconnect wallet"
        title="Forget this connection here. Only your wallet can revoke the permission itself."
        className="h-9 gap-2 rounded-lg border-[#DCE5EB] bg-white px-3 text-[#5F7585] hover:border-[#BFD1D9] hover:text-[#B44A3C]"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Disconnect</span>
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
