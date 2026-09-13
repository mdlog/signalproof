/**
 * Public verifier: paste any of a measurement's three hashes and see where it sits on both chains.
 *
 * The page is a shareable URL, so an API sample, an explorer link and a README hash all resolve
 * to the same evidence. The four-step rail is the pipeline itself — commitment, attestation,
 * proof, settlement — each step with the transaction that proves it, or the honest reason it has
 * none yet. Nothing here is metered.
 */
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Check, CheckCircle2, Clock3, Copy, ExternalLink, Search, ShieldCheck } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import ProofPanel from "@/components/ProofPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const HASH = /^(0x)?[0-9a-fA-F]{64}$/;

function short(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function formatCtc(wei: string | null): string {
  if (!wei) return "0";
  const v = Number(BigInt(wei)) / 1e18;
  return v.toFixed(v >= 1 ? 2 : 4).replace(/\.?0+$/, "") || "0";
}

export default function VerifyPage() {
  const params = useParams<{ hash?: string }>();
  const [, navigate] = useLocation();
  const [input, setInput] = useState(params.hash ?? "");
  const [copied, setCopied] = useState(false);
  const hash = params.hash?.trim() ?? "";

  useEffect(() => setInput(params.hash ?? ""), [params.hash]);

  const query = trpc.signalproof.verify.useQuery(
    { hash },
    { enabled: hash.length > 0, refetchInterval: hash ? 20_000 : false, refetchOnWindowFocus: false },
  );

  const submit = () => {
    const v = input.trim();
    if (!v) return;
    navigate(`/verify/${v}`);
  };

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1700);
  };

  const r = query.data;
  const m = r?.found ? r.measurement : null;

  return (
    <PageFrame title="Verify a proof" activeId="verify">
      <div className="mb-7 max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> Public verifier</div>
        <h1 className="mt-3 font-display text-[28px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-4xl sm:tracking-[-0.04em]">Any hash, both chains, <span className="text-[#147A70]">one answer.</span></h1>
        <p className="mt-4 text-sm leading-relaxed text-[#6C8291]">Paste a measurement root, the Sepolia transaction that committed it, or the Creditcoin transaction that settled it. The page shows what the two chains agree on and the Attestcoin proof the precompile verified. No key, no account — verification is never metered.</p>
      </div>

      <Card className="rounded-xl border-[#DCE5EB] bg-white">
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="0x… measurement root, Sepolia tx hash, or Creditcoin tx hash"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[#DCE5EB] px-4 py-3 font-mono text-xs text-[#102A43] outline-none focus:border-[#31B7A6]"
            />
            <Button onClick={submit} disabled={!HASH.test(input.trim())} className="gap-2 rounded-xl bg-[#102A43] text-white hover:bg-[#173956]"><Search className="h-4 w-4" /> Verify</Button>
          </div>
          {input.trim() && !HASH.test(input.trim()) && <div className="mt-2 text-[11px] text-[#9A6517]">Expected 64 hex characters, with or without 0x.</div>}
        </CardContent>
      </Card>

      {hash && query.isLoading && <div className="mt-5 text-sm text-[#73879A]">Reading both chains…</div>}

      {r && !r.found && (
        <Card className="mt-5 rounded-xl border-[#F4B95E]/40 bg-[#FFFBF2]">
          <CardContent className="p-5 text-sm leading-relaxed text-[#7A5312]">
            {r.reason === "MALFORMED"
              ? "That is not a 32-byte hash."
              : <>No measurement with this hash in the scanned window (Sepolia from block {r.scannedFromBlock.sepolia.toLocaleString()}, Creditcoin from block {r.scannedFromBlock.creditcoin.toLocaleString()}). A measurement submitted in the last few seconds may not be on Sepolia yet; a hash from another deployment will never be here. This is "not found", not "invalid".</>}
          </CardContent>
        </Card>
      )}

      {r && r.found && m && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="rounded-xl border-[#DCE5EB] bg-white">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]">matched by {r.matchedBy}</div>
                  <h2 className="mt-2 font-display text-2xl font-bold">{m.status === "SETTLED" ? "Settled on Creditcoin" : "Awaiting Creditcoin attestation"}</h2>
                  <div className="mt-1 text-xs text-[#73879A]">Area <a href={`/area/${m.areaHash}`} className="font-semibold text-[#147A70]">{m.areaHash}</a> · contributor <a href={`/contributors/${m.contributor}`} className="font-mono text-[#147A70]">{short(m.contributor)}</a>{m.timestamp ? ` · ${new Date(m.timestamp * 1000).toLocaleString()}` : ""}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${m.status === "SETTLED" ? "bg-[#DDF7F1] text-[#147A70]" : "bg-[#FFF0D2] text-[#9A6517]"}`}>{m.status === "SETTLED" ? "SETTLED" : "AWAITING"}</span>
              </div>

              <div className="mt-6 space-y-4">
                <Step done title="Measurement root" detail="What the contributor signed. Latency, throughput, area, timestamp and a nonce hash to this value." hash={m.measurementRoot} />
                <Step done={Boolean(m.sourceTxHash)} title="Committed on Ethereum Sepolia" detail={m.sourceBlockNumber ? `Block ${m.sourceBlockNumber.toLocaleString()} · MeasurementSubmitted emitted by the registry, which recovered the contributor's signature on-chain.` : "Not on Sepolia yet."} hash={m.sourceTxHash} href={r.explorer.source} />
                <Step
                  done={m.status === "SETTLED" || Boolean(r.attestation?.attested)}
                  active={m.status !== "SETTLED"}
                  title="Attested by Creditcoin"
                  detail={m.status === "SETTLED"
                    ? "Creditcoin's attestation frontier passed this block; the proof below was built from it."
                    : r.attestation && !r.attestation.error
                      ? r.attestation.attested
                        ? "Attested · the proof can be fetched and settled now."
                        : `Attested height ${r.attestation.attestedHeight.toLocaleString()} of ${r.attestation.sourceBlockNumber.toLocaleString()} · ${r.attestation.blocksRemaining} block${r.attestation.blocksRemaining === 1 ? "" : "s"} to go (~${Math.max(1, Math.round((r.attestation.blocksRemaining * 12) / 60))} min)`
                      : "Attestation progress unavailable."}
                />
                <Step done={m.status === "SETTLED"} title="Settled on Creditcoin CC3" detail={m.status === "SETTLED" ? `MeasurementVerified · reward ${formatCtc(m.rewardAmount)} CTC accrued to the contributor after the precompile verified inclusion and the contract checked receipt status, emitter and signature.` : "execute() has not been called with a proof yet — anyone holding one may call it."} hash={m.creditcoinTxHash} href={r.explorer.settlement} />
              </div>

              {r.proof && <ProofPanel query={{ isLoading: false, data: r.proof }} settled={m.status === "SETTLED"} />}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-xl border-[#DCE5EB] bg-white">
              <CardContent className="p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]">Share</div>
                <div className="mt-2 break-all font-mono text-[10px] text-[#426176]">{typeof window !== "undefined" ? window.location.origin : ""}{r.verifyUrl}</div>
                <button onClick={() => void copyLink()} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#147A70]">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy link</button>
                <div className="mt-4 text-[11px] leading-relaxed text-[#8EA0AC]">The same answer as JSON: <a href={`/v1/verify/${m.measurementRoot}`} target="_blank" rel="noreferrer" className="font-mono text-[#147A70]">/v1/verify/{short(m.measurementRoot)}</a></div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-0 bg-[#102A43] text-white">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#62DCCB]"><ShieldCheck className="h-3.5 w-3.5" /> What "verified" means here</div>
                <p className="mt-3 text-xs leading-relaxed text-white/60">The Creditcoin contract never trusted this server. It accepted the measurement only after the BlockProver precompile proved the Sepolia transaction sits in an attested block, and after it checked the receipt succeeded, the log came from the bound registry, and the contributor's signature recovers to the payee. Every one of those is a transaction you can open above.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </PageFrame>
  );
}

function Step({ done, active = false, title, detail, hash, href }: { done: boolean; active?: boolean; title: string; detail: string; hash?: string | null; href?: string | null }) {
  return (
    <div className="flex gap-3">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${done ? "border-[#31B7A6] bg-[#DDF7F1] text-[#147A70]" : active ? "border-[#F4B95E] bg-[#FFF0D2] text-[#9A6517]" : "border-[#D7E0E7] bg-white text-[#A0AFBB]"}`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[#102A43]">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[#73879A]">{detail}</div>
        {hash && (
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[#426176]">
            <span className="break-all">{hash}</span>
            {href && <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans font-semibold text-[#147A70]">explorer <ExternalLink className="h-3 w-3" /></a>}
          </div>
        )}
      </div>
    </div>
  );
}
