/**
 * One area: the cell on the map, its aggregate, the quality trend, every sample with its proof,
 * and the deliverables a buyer takes away — CSV, JSON, the brief, an embeddable badge.
 *
 * The page reads the chain through tRPC and is free; the download buttons call the metered /v1
 * endpoints with the key stored by "Buy API access", and show the API's own 401 when there is
 * none. Nothing here is a fixture: an area nobody measured says so.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Copy, Download, ExternalLink, FileText, Search, ShieldCheck } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import CoverageMap from "@/components/CoverageMap";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { accessHeaders, describeAccessRefusal, getStoredAccess } from "@/lib/access";

function toneFor(quality: number) {
  if (quality >= 80) return { status: "strong", color: "#31B7A6" };
  if (quality >= 60) return { status: "watch", color: "#F4B95E" };
  return { status: "attention", color: "#F06A59" };
}

function short(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "—";
}

export default function AreaPage() {
  const { geohash = "" } = useParams<{ geohash: string }>();
  const area = geohash.toLowerCase();
  const query = trpc.signalproof.area.useQuery({ areaHash: area }, { enabled: /^[a-z0-9-]{1,32}$/.test(area), refetchInterval: 15_000 });
  const view = query.data;
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ text: string; loading: boolean; error: string | null } | null>(null);
  const hasKey = Boolean(getStoredAccess());

  const zones = useMemo(() => (view ? [{ name: view.areaHash, code: view.areaHash, quality: view.quality, samples: view.sampleCount, ...toneFor(view.quality) }] : []), [view]);
  const trend = useMemo(
    () => (view?.trend ?? []).map((p) => ({ ...p, time: new Date(p.t).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })),
    [view],
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const badgeUrl = `${origin}/v1/areas/${area}/badge.svg`;
  const embed = `<a href="${origin}/area/${area}"><img alt="SignalProof coverage quality for ${area}" src="${badgeUrl}"></a>`;

  const copy = async (label: string, text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1700);
  };

  /** Download a metered export; a 401 is shown in the API's words, never swallowed. */
  const download = async (kind: "csv" | "json") => {
    setNotice(null);
    const res = await fetch(`/v1/areas/${area}/export.${kind}`, { cache: "no-store", headers: accessHeaders() });
    if (res.status === 401) {
      setNotice(await describeAccessRefusal(res));
      return;
    }
    if (!res.ok) {
      setNotice(`The buyer API answered ${res.status}.`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signalproof-${area}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openBrief = async () => {
    setBrief({ text: "", loading: true, error: null });
    try {
      const res = await fetch(`/v1/areas/${area}/brief`, { cache: "no-store", headers: accessHeaders() });
      if (res.status === 401) throw new Error(await describeAccessRefusal(res));
      if (!res.ok) throw new Error(`The buyer API answered ${res.status}.`);
      setBrief({ text: await res.text(), loading: false, error: null });
    } catch (error) {
      setBrief({ text: "", loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <PageFrame title={`Area ${area}`} activeId="api">
      <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> Area report</div>
          <h1 className="mt-3 font-display text-4xl font-bold leading-[1.04] tracking-[-0.04em]">{area} <span className="text-[#147A70]">{view ? `· quality ${view.quality}` : ""}</span></h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6C8291]">{view?.cell ? `A geohash cell of about ${view.cell.widthM.toLocaleString()} × ${view.cell.heightM.toLocaleString()} m centred on ${view.cell.center.lat.toFixed(4)}, ${view.cell.center.lon.toFixed(4)}. Contributors are somewhere inside it — no coordinate was ever transmitted.` : view ? "An area whose label is not a geohash, so it cannot be placed on a map." : query.isLoading ? "Reading both chains…" : "No measurement on chain for this area."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void download("csv")} disabled={!view} variant="outline" className="gap-2 rounded-xl border-[#DCE5EB] bg-white"><Download className="h-4 w-4" /> CSV</Button>
          <Button onClick={() => void download("json")} disabled={!view} variant="outline" className="gap-2 rounded-xl border-[#DCE5EB] bg-white"><Download className="h-4 w-4" /> JSON</Button>
          <Button onClick={() => void openBrief()} disabled={!view} className="gap-2 rounded-xl bg-[#102A43] text-white hover:bg-[#173956]"><FileText className="h-4 w-4" /> Brief</Button>
        </div>
      </div>

      {notice && (
        <div className="mb-5 rounded-xl border border-[#F4B95E]/40 bg-[#FFFBF2] px-4 py-3 text-xs leading-relaxed text-[#7A5312]">
          {notice} <Link href="/" className="font-semibold underline">Buy access on Data products</Link>{hasKey ? "" : " — the dashboard itself stays free."}
        </div>
      )}

      {view && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Quality", String(view.quality), "/ 100 — 50 % latency, 50 % throughput"],
              ["Samples", String(view.sampleCount), `${view.settledCount} settled · ${view.awaitingCount} awaiting`],
              ["Avg latency", view.avgLatencyMs == null ? "—" : `${view.avgLatencyMs} ms`, "median of 7 round trips per sample"],
              ["Avg download", view.avgDownloadMbps == null ? "—" : `${view.avgDownloadMbps} Mbps`, "3 MB incompressible payload per sample"],
            ].map(([label, value, sub]) => (
              <Card key={label} className="rounded-xl border-[#DCE5EB] bg-white"><CardContent className="p-5"><div className="text-xs font-semibold text-[#6C8291]">{label}</div><div className="mt-3 font-display text-3xl font-bold">{value}</div><div className="mt-1 text-[11px] text-[#8EA0AC]">{sub}</div></CardContent></Card>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
            <Card className="rounded-xl border-[#DCE5EB] bg-white">
              <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="font-display text-xl">The cell</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">The shaded rectangle is the real resolution of every claim below.</p></CardHeader>
              <CardContent className="px-5 pb-5"><div className="overflow-hidden rounded-xl"><CoverageMap zones={zones} isLive onZoneClick={() => {}} /></div></CardContent>
            </Card>
            <Card className="rounded-xl border-[#DCE5EB] bg-white">
              <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="font-display text-xl">Quality over time</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">{trend.length} timestamped sample{trend.length === 1 ? "" : "s"}, oldest first</p></CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="h-[300px] w-full">
                  {trend.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke="#E7EEF2" vertical={false} />
                        <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "#8EA0AC", fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "#8EA0AC", fontSize: 10 }} />
                        <Tooltip contentStyle={{ border: "1px solid #DCE5EB", borderRadius: 12, background: "#FFFFFF", fontSize: 12 }} formatter={(value, name) => [String(value), name === "quality" ? "Quality" : name === "latencyMs" ? "Latency (ms)" : "Download (Mbps)"]} />
                        <Line type="monotone" dataKey="quality" stroke="#31B7A6" strokeWidth={3} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="latencyMs" stroke="#F4B95E" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-xs text-[#8EA0AC]">No timestamped samples yet.</div>}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-5 rounded-xl border-[#DCE5EB] bg-white">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5"><div><CardTitle className="font-display text-xl">Every sample</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">Each row is a Sepolia commitment joined to its Creditcoin settlement. Open any of them in the verifier.</p></div></CardHeader>
            <CardContent className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead><tr className="border-b border-[#EDF2F5] text-[10px] uppercase tracking-[0.13em] text-[#A0AFBB]"><th className="py-3 font-medium">When</th><th className="py-3 font-medium">Contributor</th><th className="py-3 font-medium">Latency</th><th className="py-3 font-medium">Download</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Sepolia</th><th className="py-3 font-medium">Creditcoin</th><th className="py-3 text-right font-medium">Proof</th></tr></thead>
                <tbody>
                  {view.samples.map((s) => (
                    <tr key={s.measurementRoot} className="border-b border-[#F0F3F5] last:border-0">
                      <td className="py-3 text-xs text-[#5F7585]">{s.timestamp ? new Date(s.timestamp * 1000).toLocaleString() : "—"}</td>
                      <td className="py-3"><Link href={`/contributors/${s.contributor}`} className="font-mono text-xs text-[#147A70]">{short(s.contributor)}</Link></td>
                      <td className="py-3 text-xs">{s.latencyMs == null ? "—" : `${s.latencyMs} ms`}</td>
                      <td className="py-3 text-xs">{s.downloadMbps == null ? "—" : `${s.downloadMbps} Mbps`}</td>
                      <td className="py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${s.status === "SETTLED" ? "bg-[#DDF7F1] text-[#147A70]" : "bg-[#FFF0D2] text-[#9A6517]"}`}>{s.status === "SETTLED" ? "Settled" : "Awaiting"}</span></td>
                      <td className="py-3 font-mono text-[10px]">{s.explorer.source ? <a href={s.explorer.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#147A70]">{short(s.sourceTxHash)} <ExternalLink className="h-3 w-3" /></a> : "—"}</td>
                      <td className="py-3 font-mono text-[10px]">{s.explorer.settlement ? <a href={s.explorer.settlement} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#147A70]">{short(s.creditcoinTxHash)} <ExternalLink className="h-3 w-3" /></a> : "—"}</td>
                      <td className="py-3 text-right"><Link href={s.verifyUrl} className="inline-flex items-center gap-1 text-xs font-semibold text-[#147A70]"><Search className="h-3.5 w-3.5" /> Verify</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="mt-5 rounded-xl border-[#DCE5EB] bg-[#F0F8F8]">
            <CardContent className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#147A70]"><ShieldCheck className="h-3.5 w-3.5" /> Embed the badge</div>
                  <p className="mt-2 text-xs leading-relaxed text-[#4F766F]">A venue, an operator or a public programme can show this cell's verified quality on its own site. The badge is free, refreshes every minute from chain state, and links back to this page.</p>
                  <img src={badgeUrl} alt={`SignalProof badge for ${area}`} className="mt-3 h-5" />
                </div>
                <div className="w-full max-w-lg">
                  <pre className="overflow-x-auto rounded-xl bg-white p-3 font-mono text-[10px] leading-relaxed text-[#426176]">{embed}</pre>
                  <button onClick={() => void copy("embed", embed)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#147A70]">{copied === "embed" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy embed code</button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!view && !query.isLoading && (
        <Card className="mt-5 rounded-xl border-[#DCE5EB] bg-white"><CardContent className="p-6 text-sm text-[#73879A]">Nothing on chain for <span className="font-mono">{area}</span>. Areas appear here the moment a measurement is committed to Sepolia. <Link href="/" className="font-semibold text-[#147A70]">Back to the console</Link></CardContent></Card>
      )}

      <Dialog open={brief !== null} onOpenChange={(open) => { if (!open) setBrief(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden rounded-xl p-0">
          <DialogHeader className="border-b border-[#DCE5EB] px-6 pb-4 pt-6">
            <DialogTitle className="font-display text-xl">Area brief — {area}</DialogTitle>
            <DialogDescription className="text-xs text-[#73879A]">Generated from on-chain state by <code className="font-mono">/v1/areas/{area}/brief</code>.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto px-6 py-4">
            {brief?.loading && <div className="text-sm text-[#73879A]">Reading both chains…</div>}
            {brief?.error && <div className="rounded-lg border border-[#F06A59]/30 bg-[#FFF8F6] px-3 py-2 text-sm text-[#B44A3C]">{brief.error}</div>}
            {brief && !brief.loading && !brief.error && <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.7] text-[#426176]">{brief.text}</pre>}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-[#DCE5EB] px-6 py-4">
            <Button onClick={() => { if (brief?.text) void copy("brief", brief.text); }} disabled={!brief?.text} className="gap-2 rounded-xl bg-[#F06A59] text-white hover:bg-[#dc5b4b]">{copied === "brief" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy markdown</Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
