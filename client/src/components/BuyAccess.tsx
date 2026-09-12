/**
 * Buy API access: pay CTC into the reward pool, prove the payment, receive a key.
 *
 * The payment is a plain transfer to SignalProofSettlement — the same balance contributors
 * `claim()` from — so the buyer's money is, literally, the contributors' reward. Redemption asks
 * the wallet for one signature over the transaction hash, because a key must only ever go to the
 * address that paid. The key is deterministic per payment: redeeming again returns the same key,
 * which is also the recovery path.
 */

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWalletContext } from "@/contexts/WalletContext";
import { CC3_TESTNET_CHAIN_ID } from "@/hooks/useWallet";
import {
  buildAccessSigningMessage,
  clearAccess,
  fetchAccessTerms,
  getStoredAccess,
  redeemAccess,
  storeAccess,
  type AccessTerms,
  type StoredAccess,
} from "@/lib/access";

type Stage =
  | { kind: "idle" }
  | { kind: "paying" }
  | { kind: "confirming"; txHash: string; attempts: number }
  | { kind: "signing"; txHash: string }
  | { kind: "error"; message: string; txHash?: string };

const EXPLORER_TX = "https://creditcoin-testnet.blockscout.com/tx/";
const CONFIRM_POLL_MS = 5_000;
const CONFIRM_MAX_ATTEMPTS = 36; // 3 minutes — CC3 blocks are ~5 s, but public RPCs lag

export default function BuyAccess() {
  const wallet = useWalletContext();
  const [terms, setTerms] = useState<AccessTerms | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [access, setAccess] = useState<StoredAccess | null>(() => getStoredAccess());
  const [curl, setCurl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoverHash, setRecoverHash] = useState("");

  useEffect(() => {
    fetchAccessTerms().then(setTerms).catch((e) => setTermsError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** Poll the redeem endpoint until the payment is mined, then hand over to signing. */
  const redeem = async (txHash: string) => {
    if (!wallet.address) return;
    setStage({ kind: "signing", txHash });
    const signed = await wallet.signText(buildAccessSigningMessage(txHash, wallet.address));
    if (!signed.ok || !signed.signature) {
      setStage({ kind: "error", message: signed.error ?? "You declined to sign.", txHash });
      return;
    }
    let attempts = 0;
    for (;;) {
      const result = await redeemAccess({ txHash, address: wallet.address, signature: signed.signature });
      if (result.ok) {
        const stored = { key: result.key, expiresAt: result.expiresAt, txHash: result.txHash };
        storeAccess(stored);
        setAccess(stored);
        setCurl(result.curl);
        setStage({ kind: "idle" });
        return;
      }
      if (result.code !== "TX_NOT_FOUND" || attempts >= CONFIRM_MAX_ATTEMPTS) {
        setStage({ kind: "error", message: describeRedeemError(result.code, result.detail), txHash });
        return;
      }
      attempts += 1;
      setStage({ kind: "confirming", txHash, attempts });
      await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
    }
  };

  const buy = async () => {
    if (!terms || !wallet.address) return;
    if (wallet.chainId !== CC3_TESTNET_CHAIN_ID) {
      const switched = await wallet.switchToCreditcoin();
      if (!switched) {
        setStage({ kind: "error", message: "Switch your wallet to Creditcoin CC3 Testnet to pay." });
        return;
      }
    }
    setStage({ kind: "paying" });
    const sent = await wallet.sendValue(terms.payTo, BigInt(terms.priceWei));
    if (!sent.ok || !sent.txHash) {
      setStage({ kind: "error", message: sent.error ?? "The payment was not sent." });
      return;
    }
    await redeem(sent.txHash);
  };

  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1700);
  };

  if (termsError) {
    return <Card className="rounded-xl border-[#DCE5EB] bg-white"><CardContent className="p-5 text-xs text-[#B44A3C]">Access terms unavailable: {termsError}</CardContent></Card>;
  }
  if (!terms || !terms.enabled) return null; // keyless clone: nothing is metered, nothing to sell

  const busy = stage.kind === "paying" || stage.kind === "confirming" || stage.kind === "signing";

  return (
    <Card className="rounded-xl border-[#DCE5EB] bg-white">
      <CardContent className="p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#147A70]"><KeyRound className="h-3.5 w-3.5" /> API access</div>
            <h3 className="mt-2 font-display text-xl font-bold">{terms.price} for {terms.days} days, paid into the reward pool.</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#73879A]">
              The payment is a plain CTC transfer to <code className="font-mono">{terms.payTo.slice(0, 8)}…{terms.payTo.slice(-4)}</code> — the settlement contract's own balance, which contributors <code className="font-mono">claim()</code> from. You are paying the people who measured. The key unlocks per-area samples with provenance, briefs and exports; the dashboard and the catalog stay free, because the data itself is public on two chains. What is metered is the service.
            </p>
            <ol className="mt-3 space-y-1 text-[11px] text-[#5F7585]">
              <li><span className="font-semibold text-[#102A43]">1.</span> Your wallet sends {terms.price} on Creditcoin CC3 Testnet (gas is yours).</li>
              <li><span className="font-semibold text-[#102A43]">2.</span> You sign one message naming the transaction — proof that the payer is you.</li>
              <li><span className="font-semibold text-[#102A43]">3.</span> The server verifies the payment on chain and returns a key derived from it. Same payment, same key: sign again to recover it.</li>
            </ol>
          </div>
          <div className="w-full max-w-sm shrink-0 space-y-3">
            {access ? (
              <div className="rounded-xl border border-[#DDF7F1] bg-[#F5FFFC] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#147A70]"><ShieldCheck className="h-4 w-4" /> Key active until {new Date(access.expiresAt).toLocaleDateString()}</div>
                <div className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-[#426176]">{access.key}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  <button onClick={() => copy(access.key)} className="inline-flex items-center gap-1 font-semibold text-[#147A70]">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy key</button>
                  {curl && <button onClick={() => copy(curl)} className="inline-flex items-center gap-1 font-semibold text-[#147A70]"><Copy className="h-3.5 w-3.5" /> Copy curl</button>}
                  <a href={EXPLORER_TX + access.txHash} target="_blank" rel="noreferrer" className="font-semibold text-[#147A70]">Payment on Blockscout</a>
                  <button onClick={() => { clearAccess(); setAccess(null); setCurl(null); }} className="text-[#8EA0AC]">Forget on this browser</button>
                </div>
              </div>
            ) : (
              <>
                <Button onClick={() => void buy()} disabled={busy || wallet.status !== "connected"} title={wallet.status === "connected" ? undefined : "Connect the wallet that will pay."} className="w-full gap-2 rounded-xl bg-[#F06A59] text-white hover:bg-[#dc5b4b]">
                  <Zap className="h-4 w-4" />
                  {stage.kind === "paying" ? "Confirm the payment in your wallet…" : stage.kind === "signing" ? "Sign to redeem…" : stage.kind === "confirming" ? `Waiting for the block… (${stage.attempts * 5}s)` : `Buy API access — ${terms.price}`}
                </Button>
                {wallet.status !== "connected" && <div className="text-[11px] text-[#8EA0AC]">Connect a wallet first — the key is issued to the address that pays.</div>}
                <div className="rounded-xl border border-[#DCE5EB] p-3">
                  <div className="text-[11px] font-semibold text-[#426176]">Already paid? Redeem the transaction</div>
                  <div className="mt-2 flex gap-2">
                    <input value={recoverHash} onChange={(e) => setRecoverHash(e.target.value.trim())} placeholder="0x… CC3 transaction hash" className="min-w-0 flex-1 rounded-lg border border-[#DCE5EB] px-2 py-1.5 font-mono text-[10px]" />
                    <Button size="sm" variant="outline" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(recoverHash) || wallet.status !== "connected"} onClick={() => void redeem(recoverHash)} className="rounded-lg border-[#DCE5EB]">Redeem</Button>
                  </div>
                </div>
              </>
            )}
            {stage.kind === "error" && (
              <div className="rounded-lg border border-[#F06A59]/30 bg-[#FFF8F6] px-3 py-2 text-[11px] leading-relaxed text-[#B44A3C]">
                {stage.message}
                {stage.txHash && <> · <a href={EXPLORER_TX + stage.txHash} target="_blank" rel="noreferrer" className="underline">transaction</a> · <button onClick={() => void redeem(stage.txHash!)} className="underline">try redeeming again</button></>}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function describeRedeemError(code: string, detail?: string): string {
  const copy: Record<string, string> = {
    TX_NOT_FOUND: "The transaction is not on Creditcoin yet, or the RPC has not seen it. Wait a moment and redeem it again.",
    WRONG_RECIPIENT: "That transaction did not pay the settlement contract.",
    UNDERPAID: "That transaction paid less than the price.",
    TX_FAILED: "That transaction reverted, so nothing reached the pool.",
    SIGNER_MISMATCH: "The signature does not come from the address that sent the payment. Connect the paying wallet.",
    ACCESS_NOT_CONFIGURED: "This deployment does not meter the API.",
  };
  return copy[code] ?? (detail ? `${code}: ${detail}` : code);
}
