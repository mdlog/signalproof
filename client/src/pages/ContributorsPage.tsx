/**
 * Contributors: the network as a table. One row per reward address, from the same on-chain join
 * the console renders. A single team's addresses look like a single team here — the page does
 * not pretend otherwise.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Users } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { paginate } from "@shared/queue";
import { trpc } from "@/lib/trpc";
import { useWalletContext } from "@/contexts/WalletContext";

function formatCtc(wei: string): string {
  const v = Number(BigInt(wei)) / 1e18;
  return v.toFixed(v >= 1 ? 3 : 4).replace(/\.?0+$/, "") || "0";
}

function relative(epoch: number | null): string {
  if (!epoch) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export default function ContributorsPage() {
  const query = trpc.signalproof.contributors.useQuery(undefined, { refetchInterval: 30_000 });
  const rows = query.data ?? [];
  // The connected wallet's own row reads "You": the leaderboard is the one place a contributor
  // looks for themselves, and a 42-character address is not how anyone recognises their own.
  const wallet = useWalletContext();
  const me = wallet.status === "connected" && wallet.address ? wallet.address.toLowerCase() : null;

  /** Ten addresses per page; the page resets when the list changes size. */
  const LEADERBOARD_PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [rows.length]);
  const pageData = useMemo(() => paginate(rows, page, LEADERBOARD_PAGE_SIZE), [rows, page]);
  const totalSettled = rows.reduce((n, r) => n + r.settled, 0);
  const cells = new Set(rows.flatMap((r) => r.areas)).size;

  return (
    <PageFrame title="Contributors" activeId="contributors">
      <div className="mb-7 max-w-3xl">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> The network</div>
        <h1 className="mt-3 font-display text-4xl font-bold leading-[1.04] tracking-[-0.04em]">{rows.length} contributor{rows.length === 1 ? "" : "s"}, <span className="text-[#147A70]">{totalSettled} settled measurement{totalSettled === 1 ? "" : "s"}</span> across {cells} cell{cells === 1 ? "" : "s"}.</h1>
        <p className="mt-4 text-sm leading-relaxed text-[#6C8291]">Every address that has a MeasurementSubmitted on Sepolia, ranked by how many of those were proven and settled on Creditcoin. Rewards are what the settlement contracts accrued to the address — claimable from the address's own wallet, never pushed.</p>
      </div>

      <Card className="rounded-xl border-[#DCE5EB] bg-white">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5"><CardTitle className="font-display text-xl">Leaderboard</CardTitle><span className="text-xs text-[#8EA0AC]">{query.isLoading ? "Reading both chains…" : `${rows.length} address${rows.length === 1 ? "" : "es"}`}</span></CardHeader>
        <CardContent className="overflow-x-auto px-5 pb-5">
          {rows.length === 0 && !query.isLoading ? (
            <div className="flex items-center gap-3 rounded-xl bg-[#F5F8FA] p-5 text-sm text-[#73879A]"><Users className="h-4 w-4" /> No contributor on chain yet.</div>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-[#EDF2F5] text-[10px] uppercase tracking-[0.13em] text-[#A0AFBB]"><th className="py-3 font-medium">#</th><th className="py-3 font-medium">Address</th><th className="py-3 font-medium">Settled</th><th className="py-3 font-medium">Awaiting</th><th className="py-3 font-medium">Cells</th><th className="py-3 font-medium">Accrued</th><th className="py-3 text-right font-medium">Last seen</th></tr></thead>
              <tbody>
                {pageData.items.map((r) => {
                  const mine = me !== null && r.address.toLowerCase() === me;
                  return (
                  <tr key={r.address} className={`border-b border-[#F0F3F5] last:border-0 ${mine ? "bg-[#F0FAF8]" : ""}`}>
                    <td className="py-3 pr-2 font-mono text-xs text-[#8EA0AC]">{r.rank}</td>
                    <td className="py-3">{mine ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/contributors/${r.address}`} className="rounded-full bg-[#147A70] px-2.5 py-0.5 text-xs font-semibold text-white">You</Link>
                        <span className="font-mono text-[10px] text-[#8EA0AC]">{r.address.slice(0, 6)}…{r.address.slice(-4)}</span>
                      </span>
                    ) : (
                      <Link href={`/contributors/${r.address}`} className="font-mono text-xs text-[#147A70]">{r.address}</Link>
                    )}</td>
                    <td className="py-3 font-semibold">{r.settled}</td>
                    <td className="py-3 text-[#9A6517]">{r.awaiting || "—"}</td>
                    <td className="py-3"><div className="flex flex-wrap gap-1">{r.areas.map((a) => <Link key={a} href={`/area/${a}`} className="rounded-md bg-[#F5F8FA] px-2 py-0.5 font-mono text-[10px] text-[#426176] hover:bg-[#DDF7F1] hover:text-[#147A70]">{a}</Link>)}</div></td>
                    <td className="py-3 text-xs">{formatCtc(r.rewardAccruedWei)} CTC</td>
                    <td className="py-3 text-right text-xs text-[#8EA0AC]">{relative(r.lastSeen)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {pageData.pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-[#EDF2F5] pt-3 text-xs text-[#73879A]">
              <span>Addresses {pageData.from}–{pageData.to} of {pageData.total} · page {pageData.page + 1} of {pageData.pageCount}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pageData.page === 0} className="h-8 rounded-lg border-[#DCE5EB]">Previous</Button>
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(pageData.pageCount - 1, p + 1))} disabled={pageData.page >= pageData.pageCount - 1} className="h-8 rounded-lg border-[#DCE5EB]">Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageFrame>
  );
}
