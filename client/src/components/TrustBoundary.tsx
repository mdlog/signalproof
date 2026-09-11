import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";
import type { RouterOutputs } from "@/lib/trpc";

type Snapshot = RouterOutputs["signalproof"]["onchain"];

const SEPOLIA = "https://sepolia.etherscan.io/address";
const CC3 = "https://creditcoin-testnet.blockscout.com/address";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Row({
  label,
  value,
  href,
  tone = "ok",
  detail,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: "ok" | "warn";
  detail: string;
}) {
  const Icon = tone === "ok" ? ShieldCheck : ShieldAlert;
  const colour = tone === "ok" ? "text-[#147A70]" : "text-[#B44A3C]";
  return (
    <div className="flex gap-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colour}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold text-[#102A43]">{label}</span>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-[#147A70] hover:underline"
            >
              {value} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span className="font-mono text-[10px] text-[#8EA0AC]">{value}</span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[#73879A]">{detail}</p>
      </div>
    </div>
  );
}

/**
 * The three checks that make a settled measurement mean something.
 *
 * Judges are shown proofs and settlements everywhere else in this UI. None of that establishes
 * that a payout was *earned* — a genuine, provable event still only proves where it came from, not
 * that the registry should have accepted it. This panel names the control that closes that gap and
 * points at the address it is enforced on, so the claim is checkable rather than asserted.
 */
export function TrustBoundary({ snap }: { snap: Snapshot | undefined }) {
  if (!snap?.configured) return null;

  const gated = Boolean(snap.registryRelayer);

  return (
    <Card className="rounded-xl border-[#DCE5EB] bg-white">
      <CardHeader className="px-6 pb-2 pt-6">
        <CardTitle className="font-display text-xl">Trust boundary</CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-[#8EA0AC]">
          What stops a valid proof from becoming an unearned payout.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        <Row
          label="Source registry is gated"
          value={short(snap.registryAddress)}
          href={`${SEPOLIA}/${snap.registryAddress}#readContract`}
          tone={gated ? "ok" : "warn"}
          detail={
            gated
              ? `submitMeasurement accepts one relayer — ${short(snap.registryRelayer!)}, readable as relayer() on the contract. The gateway verifies the contributor's signature over the measurement root before relaying, so the address named as payee is the address that signed.`
              : "This registry has no relayer(): anyone can write to it naming themselves as payee, obtain a real inclusion proof, and drain the pool. Every downstream check would still pass."
          }
        />
        <Row
          label="Emitter binding"
          value={short(snap.settlementAddress)}
          href={`${CC3}/${snap.settlementAddress}`}
          detail="Settlement refuses any MeasurementSubmitted that did not come from the bound registry, so a lookalike contract on Sepolia cannot settle here even with a proof the precompile accepts."
        />
        {snap.batchSettlementAddress && (
          <Row
            label="Batch route, same checks"
            value={short(snap.batchSettlementAddress)}
            href={`${CC3}/${snap.batchSettlementAddress}`}
            detail="Many measurements settle under one continuity proof. It re-implements every check the single-proof path enforces — an optimisation must not become the weaker route."
          />
        )}
      </CardContent>
    </Card>
  );
}
