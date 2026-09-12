/**
 * The live Attestcoin proof for one measurement, in the terms the precompile sees it: the attested
 * Sepolia height, the Merkle path to that block's transaction root, the continuity roots that
 * chain the block to an attestation checkpoint, and the exact execute() call built from them.
 * Fetched with no key — a keyless clone shows the same panel.
 */
import type { ReactNode } from "react";
import type { RouterOutputs } from "@/lib/trpc";

export type ProofLookup = RouterOutputs["signalproof"]["proofFor"];
export type ProofQuery = { isLoading: boolean; data: ProofLookup | undefined };

export default function ProofPanel({ query, settled }: { query: ProofQuery; settled: boolean }) {
  const mono = "font-mono text-[10px] text-[#426176] break-all";
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8EA0AC]">{label}</div>
      <div className={mono}>{value}</div>
    </div>
  );
  if (query.isLoading) {
    return <div className="mt-3 rounded-lg border border-[#DCE5EB] bg-[#F8FBFC] px-3 py-3 text-xs text-[#73879A]">Asking the Attestcoin proof service for this transaction's inclusion and continuity proof…</div>;
  }
  const data = query.data;
  if (!data) return null;
  if (!data.ok) {
    return (
      <div className="mt-3 rounded-lg border border-[#FFF0D2] bg-[#FFFBF2] px-3 py-3 text-xs text-[#9A6517]">
        {data.code === "NOT_ATTESTED_YET"
          ? "No proof yet: Creditcoin has not attested this Sepolia block. Attestation advances about 10 blocks every 2 minutes; the row above shows the countdown."
          : `The proof service could not answer: ${data.detail}`}
      </div>
    );
  }
  const p = data.proof;
  return (
    <div className="mt-3 rounded-lg border border-[#DCE5EB] bg-[#F8FBFC] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#102A43]">Attestcoin proof {settled ? "— what the precompile verified" : "— ready to submit"}</div>
        <div className="font-mono text-[10px] text-[#8EA0AC]">chainKey {p.chainKey} · verifier {p.precompile.slice(0, 6)}…{p.precompile.slice(-4)}</div>
      </div>
      <div className="divide-y divide-[#EDF2F5]">
        {row("Attested height", <>{p.attestedHeight.toLocaleString()} <span className="text-[#8EA0AC]">(Sepolia block, tx index {p.txIndex})</span></>)}
        {row("Transaction", <>{p.txBytesLength.toLocaleString()} bytes of RLP-encoded transaction + receipt — the precompile decodes the receipt status and the MeasurementSubmitted log from these</>)}
        {row("Merkle inclusion", <>root {p.merkle.root.slice(0, 10)}… · {p.merkle.siblingCount} sibling{p.merkle.siblingCount === 1 ? "" : "s"}: {p.merkle.siblings.slice(0, 3).map((s) => `${s.isLeft ? "L" : "R"} ${s.hash.slice(0, 10)}…`).join(", ")}{p.merkle.siblingCount > 3 ? ` +${p.merkle.siblingCount - 3} more` : ""}</>)}
        {row("Continuity", <>{p.continuity.rootCount} root{p.continuity.rootCount === 1 ? "" : "s"} from lower endpoint {p.continuity.lowerEndpointDigest.slice(0, 10)}… — the walk from this block back to an attestation checkpoint</>)}
        {row("execute()", <>selector {p.execute.selector} · action 0 · calldata {((p.execute.calldata.length - 2) / 2).toLocaleString()} bytes · gas ceiling {Number(p.execute.gasLimit).toLocaleString()}</>)}
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-[#8EA0AC]">Anyone holding this proof may call execute(); the settlement contract then checks the receipt status, the emitting contract, the contributor's on-chain signature and the freshness window before paying.</div>
    </div>
  );
}
