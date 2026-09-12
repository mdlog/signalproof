/**
 * One contributor: what the address measured, earned, and already withdrew — every number from
 * chain state. When the connected wallet IS this address, the claim control appears; otherwise the
 * page is read-only, because claim() pays msg.sender and nobody can claim for someone else.
 */
import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { ExternalLink, Search, ShieldCheck } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import ClaimReward from "@/components/ClaimReward";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWalletContext } from "@/contexts/WalletContext";
import { trpc } from "@/lib/trpc";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CC3_TX = "https://creditcoin-testnet.blockscout.com/tx/";

function formatCtc(wei: string | null): string {
  if (!wei) return "0";
  const v = Number(BigInt(wei)) / 1e18;
  return v.toFixed(v >= 1 ? 3 : 4).replace(/\.?0+$/, "") || "0";
}

export default function ContributorPage() {
  const { address = "" } = useParams<{ address: string }>();
  const wallet = useWalletContext();
  const valid = ADDRESS.test(address);
  // The measurement list comes from the cached snapshot and paints at once; the claim history is
  // a separate, slower scan (RewardClaimed across both settlement routes) that fills in after.
  const onchain = trpc.signalproof.onchain.useQuery(undefined, { enabled: valid, refetchInterval: 15_000 });
  const stats = trpc.signalproof.contributorStats.useQuery({ address }, { enabled: valid, refetchInterval: 60_000 });
  const rewards = trpc.signalproof.rewardsFor.useQuery({ address }, { enabled: valid, refetchInterval: 30_000 });
  const mine = wallet.status === "connected" && wallet.address?.toLowerCase() === address.toLowerCase();
  const s = useMemo(() => {
    if (stats.data && !stats.data.error) return stats.data;
    const snap = onchain.data;
    if (!snap) return undefined;
    const lower = address.toLowerCase();
    const measurements = snap.measurements.filter((m) => m.contributor.toLowerCase() === lower);
    let earned = 0n;
    for (const m of measurements) if (m.rewardAmount) earned += BigInt(m.rewardAmount);
    const settled = measurements.filter((m) => m.status === "SETTLED").length;
    return {
      address,
      measurements,
      areas: [...new Set(measurements.map((m) => m.areaHash))],
      totals: { submitted: measurements.length, settled, awaiting: measurements.length - settled, earnedWei: earned.toString(), claimedWei: null, unclaimedWei: null },
      claims: null,
      error: stats.data?.error ?? null,
    };
  }, [stats.data, onchain.data, address]);

  return (
    <PageFrame title={mine ? "My profile" : "Contributor"} activeId="contributors">
      <div className="mb-7">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> {mine ? "Your address" : "Contributor"}</div>
        <h1 className="mt-3 break-all font-mono text-2xl font-bold tracking-tight sm:text-3xl">{address}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6C8291]">{valid ? "Everything this address has done, derived from chain state: measurements committed on Sepolia, settlements on Creditcoin, rewards accrued and RewardClaimed events already withdrawn." : "That is not an address."}</p>
      </div>

      {valid && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Submitted", s ? String(s.totals.submitted) : "—", "MeasurementSubmitted on Sepolia"],
              ["Settled", s ? String(s.totals.settled) : "—", s ? `${s.totals.awaiting} awaiting attestation` : ""],
              ["Earned", s ? `${formatCtc(s.totals.earnedWei)} CTC` : "—", "sum of MeasurementVerified rewards"],
              ["Unclaimed", s?.totals.unclaimedWei != null ? `${formatCtc(s.totals.unclaimedWei)} CTC` : "…", s?.totals.claimedWei != null ? `${formatCtc(s.totals.claimedWei)} CTC already claimed` : "reading claim history…"],
            ].map(([label, value, sub]) => (
              <Card key={label} className="rounded-xl border-[#DCE5EB] bg-white"><CardContent className="p-5"><div className="text-xs font-semibold text-[#6C8291]">{label}</div><div className="mt-3 font-display text-3xl font-bold">{value}</div><div className="mt-1 text-[11px] text-[#8EA0AC]">{sub}</div></CardContent></Card>
            ))}
          </div>

          {s?.error && <div className="mb-5 rounded-xl border border-[#F4B95E]/40 bg-[#FFFBF2] px-4 py-3 text-xs text-[#7A5312]">{s.error}</div>}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="rounded-xl border-[#DCE5EB] bg-white">
              <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="font-display text-xl">Measurements</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">{s ? `${s.measurements.length} on chain across ${s.areas.length} cell${s.areas.length === 1 ? "" : "s"}` : "Reading both chains…"}</p></CardHeader>
              <CardContent className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-b border-[#EDF2F5] text-[10px] uppercase tracking-[0.13em] text-[#A0AFBB]"><th className="py-3 font-medium">When</th><th className="py-3 font-medium">Area</th><th className="py-3 font-medium">Latency</th><th className="py-3 font-medium">Download</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Reward</th><th className="py-3 text-right font-medium">Proof</th></tr></thead>
                  <tbody>
                    {(s?.measurements ?? []).map((m) => (
                      <tr key={m.measurementRoot} className="border-b border-[#F0F3F5] last:border-0">
                        <td className="py-3 text-xs text-[#5F7585]">{m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : "—"}</td>
                        <td className="py-3"><Link href={`/area/${m.areaHash}`} className="font-mono text-xs text-[#147A70]">{m.areaHash}</Link></td>
                        <td className="py-3 text-xs">{m.latencyMs == null ? "—" : `${m.latencyMs} ms`}</td>
                        <td className="py-3 text-xs">{m.downloadMbps == null ? "—" : `${m.downloadMbps} Mbps`}</td>
                        <td className="py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${m.status === "SETTLED" ? "bg-[#DDF7F1] text-[#147A70]" : "bg-[#FFF0D2] text-[#9A6517]"}`}>{m.status === "SETTLED" ? "Settled" : "Awaiting"}</span></td>
                        <td className="py-3 text-xs">{m.rewardAmount ? `${formatCtc(m.rewardAmount)} CTC` : "—"}</td>
                        <td className="py-3 text-right"><Link href={`/verify/${m.measurementRoot}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#147A70]"><Search className="h-3.5 w-3.5" /> Verify</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s && s.measurements.length === 0 && <div className="py-4 text-sm text-[#73879A]">No measurement on chain for this address.</div>}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {mine ? (
                <ClaimReward wallet={wallet} />
              ) : (
                <Card className="rounded-xl border-[#DCE5EB] bg-white">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A0AFBB]"><ShieldCheck className="h-3.5 w-3.5" /> Claimable</div>
                    <div className="mt-3 font-display text-3xl font-bold">{rewards.data ? `${formatCtc(rewards.data.wei)} CTC` : "—"}</div>
                    <p className="mt-2 text-xs leading-relaxed text-[#73879A]">Only this address can withdraw it: <code className="font-mono">claim()</code> pays <code className="font-mono">msg.sender</code>. Connect this wallet to see the claim button here.</p>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-xl border-[#DCE5EB] bg-white">
                <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="font-display text-lg">Claims</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">RewardClaimed events, newest first</p></CardHeader>
                <CardContent className="px-5 pb-5">
                  {s && s.claims == null && <div className="text-xs text-[#73879A]">Reading RewardClaimed history on Creditcoin…</div>}
                  {s && s.claims?.length === 0 && <div className="text-xs text-[#73879A]">Nothing withdrawn yet.</div>}
                  <ul className="space-y-2">
                    {(s?.claims ?? []).map((c) => (
                      <li key={c.txHash} className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-[#102A43]">{formatCtc(c.amountWei)} CTC</span><a href={CC3_TX + c.txHash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] text-[#147A70]">block {c.blockNumber.toLocaleString()} <ExternalLink className="h-3 w-3" /></a></li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </PageFrame>
  );
}
