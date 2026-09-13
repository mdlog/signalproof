/**
 * Contributor reward: what is owed, and the one button that pays it out.
 *
 * `claim()` is the only transaction this product ever asks a user to sign. Everything else is paid
 * for by the relayer, which is why connecting a wallet needs no balance at all. Claiming does — it
 * runs as `msg.sender`, so it must come from the contributor's own wallet, on Creditcoin, with
 * enough CTC for gas.
 *
 * Every failure branch says which of those is missing rather than showing a disabled button with no
 * explanation.
 */

import { useState } from "react";
import { ArrowUpRight, Check, CircleAlert, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { CC3_TESTNET_CHAIN_ID, chainName, type useWallet } from "@/hooks/useWallet";

const EXPLORER = "https://creditcoin-testnet.blockscout.com";

/** wei → CTC, trimmed. Avoids pulling in a formatter for one call site. */
function toCtc(wei: string): string {
  const v = Number(BigInt(wei)) / 1e18;
  if (v === 0) return "0";
  return v.toFixed(v >= 1 ? 3 : 6).replace(/0+$/, "").replace(/\.$/, "");
}

export default function ClaimReward({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = wallet.status === "connected" && Boolean(wallet.address);
  const onCc3 = wallet.chainId === CC3_TESTNET_CHAIN_ID;

  /** Full history for this address: what was measured, earned, and already withdrawn. */
  const stats = trpc.signalproof.contributorStats.useQuery(
    { address: wallet.address ?? "0x0000000000000000000000000000000000000000" },
    { enabled: connected, refetchInterval: 30_000 },
  );

  const rewards = trpc.signalproof.rewardsFor.useQuery(
    { address: wallet.address ?? "0x0000000000000000000000000000000000000000" },
    { enabled: connected, refetchInterval: 20_000 },
  );

  const data = rewards.data;
  const accrued = data?.wei ?? "0";
  const hasReward = accrued !== "0";

  // Routes with a non-zero accrual. Empty when nothing is owed anywhere, which is the ordinary
  // case for a wallet that has not contributed yet.
  const payable = (data?.routes ?? []).filter((r) => r.wei !== "0");

  if (!connected) {
    return (
      <Card className="rounded-xl border-[#DCE5EB] bg-white">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A0AFBB]">
            <Wallet className="h-3.5 w-3.5" /> Contributor reward
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#73879A]">
            Connect a wallet to see what that address has accrued. Reading a balance costs nothing —
            only claiming needs gas.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-[#DCE5EB] bg-white">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A0AFBB]">
          <Wallet className="h-3.5 w-3.5" /> Contributor reward
        </div>

        <div className="mt-3 flex items-end gap-1.5">
          <span className="font-display text-3xl font-bold text-[#102A43]">
            {rewards.isLoading ? "—" : toCtc(accrued)}
          </span>
          <span className="pb-1 text-sm text-[#8EA0AC]">CTC</span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-[#8EA0AC]">
          accrued to {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}
        </div>

        {!hasReward && !rewards.isLoading && (
          <p className="mt-3 text-xs leading-relaxed text-[#73879A]">
            Nothing accrued yet. A reward appears once one of this address's measurements settles on
            Creditcoin.
          </p>
        )}

        {/* Earned and claimed are two different, independently checkable numbers. Their difference
            must equal the contract's rewards() balance — if it ever does not, something is wrong. */}
        {stats.data && !stats.data.error && stats.data.totals.submitted > 0 && (
          <div className="mt-4 space-y-2 border-t border-[#ECF1F4] pt-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="font-display text-lg font-bold text-[#102A43]">
                  {stats.data.totals.submitted}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#A0AFBB]">
                  measured
                </div>
              </div>
              <div>
                <div className="font-display text-lg font-bold text-[#147A70]">
                  {stats.data.totals.settled}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#A0AFBB]">
                  settled
                </div>
              </div>
              <div>
                <div className="font-display text-lg font-bold text-[#102A43]">
                  {stats.data.areas.length}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#A0AFBB]">
                  areas
                </div>
              </div>
            </div>

            <div className="space-y-1 font-mono text-[10px] text-[#5F7585]">
              <div className="flex justify-between">
                <span>earned all time</span>
                <span className="text-[#102A43]">{toCtc(stats.data.totals.earnedWei)} CTC</span>
              </div>
              <div className="flex justify-between">
                <span>already claimed</span>
                <span className="text-[#102A43]">{toCtc(stats.data.totals.claimedWei)} CTC</span>
              </div>
            </div>

            {stats.data.claims.length > 0 && (
              <div className="pt-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#A0AFBB]">
                  claim history
                </div>
                {stats.data.claims.slice(0, 4).map((c) => (
                  <a
                    key={c.txHash}
                    href={`${EXPLORER}/tx/${c.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#426176] hover:text-[#102A43]"
                  >
                    <span>
                      {c.txHash.slice(0, 8)}…{c.txHash.slice(-4)}
                    </span>
                    <span className="flex items-center gap-1">
                      {toCtc(c.amountWei)} CTC <ArrowUpRight className="h-2.5 w-2.5" />
                    </span>
                  </a>
                ))}
              </div>
            )}

            {stats.data.areas.length > 0 && (
              <div className="pt-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#A0AFBB]">
                  areas measured
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {stats.data.areas.map((a) => (
                    <span
                      key={a}
                      className="rounded bg-[#F1F6F8] px-1.5 py-0.5 font-mono text-[10px] text-[#426176]"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* The pool can be drained even when an accrual exists; the contract reverts in that case,
            so say it before the user spends gas finding out. */}
        {hasReward && data && !data.claimable && (
          <div className="mt-3 flex gap-2 rounded-lg border border-[#F06A59]/25 bg-[#FFF8F6] px-3 py-2 text-[11px] leading-relaxed text-[#B44A3C]">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The reward pool holds {toCtc(data.poolWei)} CTC, less than you are owed. Claiming would
              revert. The pool needs topping up.
            </span>
          </div>
        )}

        {hasReward && !onCc3 && (
          <div className="mt-3 flex gap-2 rounded-lg border border-[#F4B95E]/40 bg-[#FFF8EC] px-3 py-2 text-[11px] leading-relaxed text-[#7A5312]">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your wallet is on {chainName(wallet.chainId)}. Claiming runs as your own address on
              Creditcoin, so switch first — and keep a little CTC for gas.
            </span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-[#F06A59]/25 bg-[#FFF8F6] px-3 py-2 text-[11px] leading-relaxed text-[#B44A3C]">
            {error}
          </div>
        )}

        {txHash && (
          <a
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-2 rounded-lg border border-[#31B7A6]/30 bg-[#F5FFFC] px-3 py-2 text-[11px] font-semibold text-[#147A70]"
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            Claim sent — view on Blockscout
            <ArrowUpRight className="ml-auto h-3 w-3" />
          </a>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!onCc3 ? (
            <Button
              size="sm"
              onClick={() => wallet.switchToCreditcoin()}
              className="gap-2 rounded-lg bg-[#9A6517] text-white hover:bg-[#7A5312]"
            >
              Switch to CC3 Testnet
            </Button>
          ) : (
            // One button per settlement route that owes this address something. The two contracts
            // hold separate balances and `claim()` on one pays nothing that accrued on the other,
            // so a single button would silently strand whatever the other route owes.
            payable.map((route) => (
              <Button
                key={route.address}
                size="sm"
                disabled={!route.claimable || pending}
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  setTxHash(null);
                  const result = await wallet.claimReward(route.address);
                  setPending(false);
                  if (result.ok && result.txHash) {
                    setTxHash(result.txHash);
                    // Give the chain a moment, then re-read rather than assuming it went to zero.
                    setTimeout(() => rewards.refetch(), 6000);
                  } else {
                    setError(result.error ?? "The claim did not go through.");
                  }
                }}
                className="gap-2 rounded-lg bg-[#102A43] text-white hover:bg-[#1B3A57]"
              >
                <Zap className="h-3.5 w-3.5" />
                {pending
                  ? "Confirm in your wallet…"
                  : `Claim ${toCtc(route.wei)} CTC${payable.length > 1 ? ` (${route.label})` : ""}`}
              </Button>
            ))
          )}
          {onCc3 && payable.length === 0 && (
            // Disabled for a reason the user can read: the balance is still being read, the RPC did
            // not answer, or there is genuinely nothing accrued. A bare greyed-out button says none of that.
            <Button
              size="sm"
              disabled
              title={rewards.isLoading ? "Reading the settlement contract…" : rewards.isError ? "Could not read the settlement contract." : "No reward accrued to this address yet."}
              className="gap-2 rounded-lg bg-[#102A43] text-white"
            >
              <Zap className="h-3.5 w-3.5" />
              {rewards.isLoading ? "Reading rewards…" : rewards.isError ? "Rewards unavailable" : "Nothing to claim yet"}
            </Button>
          )}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-[#A0AFBB]">
          This is the only transaction SignalProof asks you to sign. Submitting a measurement costs
          you nothing — the relayer pays gas on both chains.
        </p>
      </CardContent>
    </Card>
  );
}
