/**
 * Operations: what it takes to keep the rail running, read live every 15 s.
 *
 * Four questions an operator asks: can the relayers still pay gas, how many settlements can the
 * pool still fund, is the worker alive, are the RPCs telling the truth. A row's error is shown on
 * the row, in amber, never hidden — a panel that is all green because it stopped asking would be
 * the wrong kind of quiet.
 */
import { Activity, CircleAlert, Database, Radio, Wallet } from "lucide-react";
import PageFrame from "@/components/PageFrame";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const SEPOLIA_ADDR = "https://sepolia.etherscan.io/address/";
const CC3_ADDR = "https://creditcoin-testnet.blockscout.com/address/";

function eth(wei: string | null, unit: string): string {
  if (wei == null) return "—";
  const v = Number(BigInt(wei)) / 1e18;
  return `${v.toFixed(v >= 1 ? 3 : 5).replace(/\.?0+$/, "") || "0"} ${unit}`;
}

function ago(ms: number | null): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

function Row({ label, value, error }: { label: string; value: React.ReactNode; error?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#EDF2F5] py-2.5 last:border-0">
      <div className="text-xs text-[#6C8291]">{label}</div>
      <div className="text-right">
        <div className="text-sm font-semibold text-[#102A43]">{value}</div>
        {error && <div className="mt-0.5 inline-flex max-w-[280px] items-start gap-1 text-right text-[10px] leading-snug text-[#9A6517]"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {error}</div>}
      </div>
    </div>
  );
}

export default function OpsPage() {
  const query = trpc.signalproof.ops.useQuery(undefined, { refetchInterval: 15_000 });
  const o = query.data;
  const low = (wei: string | null, floor: number) => wei != null && Number(BigInt(wei)) / 1e18 < floor;

  return (
    <PageFrame title="Operations" activeId="ops">
      <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> Operations</div>
          <h1 className="mt-3 font-display text-[28px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-4xl sm:tracking-[-0.04em]">Is the rail <span className="text-[#147A70]">still paying?</span></h1>
          <p className="mt-4 text-sm leading-relaxed text-[#6C8291]">Relayer gas on both chains, the reward pool and how many settlements it still funds, the proof worker's last tick, and whether the RPCs are answering honestly. Refreshed every 15 seconds; nothing here is a secret.</p>
        </div>
        <div className="rounded-xl border border-[#DCE5EB] bg-white px-3 py-2 text-right"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8EA0AC]">Generated</div><div className="mt-1 text-xs font-semibold text-[#426176]">{o ? new Date(o.generatedAt).toLocaleTimeString() : query.isLoading ? "reading…" : "—"}</div></div>
      </div>

      {o && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="rounded-xl border-[#DCE5EB] bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]"><Wallet className="h-3.5 w-3.5" /> Relayer gas</div>
              <Row label="Sepolia relayer" value={o.relayer.sepolia.address ? <a href={SEPOLIA_ADDR + o.relayer.sepolia.address} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#147A70]">{o.relayer.sepolia.address.slice(0, 8)}…{o.relayer.sepolia.address.slice(-4)}</a> : "—"} error={o.relayer.sepolia.error} />
              <Row label="Sepolia ETH" value={<span className={low(o.relayer.sepolia.balanceWei, 0.02) ? "text-[#B44A3C]" : ""}>{eth(o.relayer.sepolia.balanceWei, "ETH")}</span>} error={low(o.relayer.sepolia.balanceWei, 0.02) ? "below 0.02 ETH — each commitment costs ~86k gas" : null} />
              <Row label="Creditcoin relayer" value={o.relayer.creditcoin.address ? <a href={CC3_ADDR + o.relayer.creditcoin.address} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#147A70]">{o.relayer.creditcoin.address.slice(0, 8)}…{o.relayer.creditcoin.address.slice(-4)}</a> : "—"} error={o.relayer.creditcoin.error} />
              <Row label="Creditcoin CTC" value={<span className={low(o.relayer.creditcoin.balanceWei, 1) ? "text-[#B44A3C]" : ""}>{eth(o.relayer.creditcoin.balanceWei, "CTC")}</span>} error={low(o.relayer.creditcoin.balanceWei, 1) ? "below 1 CTC — a settlement costs ~150k gas" : null} />
            </CardContent>
          </Card>

          <Card className="rounded-xl border-[#DCE5EB] bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]"><Database className="h-3.5 w-3.5" /> Reward pool</div>
              <Row label="Pool balance" value={eth(o.pool.balanceWei, "CTC")} />
              <Row label="Reward per measurement" value={eth(o.pool.rewardWei, "CTC")} />
              <Row label="Runway" value={o.pool.runway == null ? "—" : `${o.pool.runway.toLocaleString()} settlement${o.pool.runway === 1 ? "" : "s"}`} error={o.pool.runway == null ? "reward is zero" : o.pool.runway < 100 ? "fund the pool: send CTC to the settlement contract, or sell API access" : null} />
              <Row label="Settlement contract" value={<a href={CC3_ADDR + o.pool.settlementAddress} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#147A70]">{o.pool.settlementAddress.slice(0, 8)}…{o.pool.settlementAddress.slice(-4)}</a>} />
            </CardContent>
          </Card>

          <Card className="rounded-xl border-[#DCE5EB] bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]"><Activity className="h-3.5 w-3.5" /> Proof worker</div>
              <Row label="State" value={<span className={o.worker.running ? "text-[#147A70]" : "text-[#B44A3C]"}>{o.worker.running ? `running · ${o.worker.mode}` : "not running"}</span>} error={o.worker.running ? null : "missing relayer keys or chain config — measurements stay SUBMITTED"} />
              <Row label="Last tick" value={ago(o.worker.lastTickAt)} error={o.worker.running && o.worker.lastTickAt && Date.now() - o.worker.lastTickAt > 60_000 ? "no tick in the last minute" : null} />
              <Row label="Last result" value={o.worker.lastResult ? `relayed ${o.worker.lastResult.relayed} · settled ${o.worker.lastResult.settled} · recovered ${o.worker.lastResult.recovered}` : "—"} />
              <Row label="Failures in a row" value={<span className={o.worker.consecutiveFailures > 0 ? "text-[#B44A3C]" : ""}>{o.worker.consecutiveFailures}</span>} error={o.worker.lastError} />
            </CardContent>
          </Card>

          <Card className="rounded-xl border-[#DCE5EB] bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]"><Radio className="h-3.5 w-3.5" /> Chain reads</div>
              <Row label="Last good snapshot" value={ago(o.snapshot.lastSuccessAt)} error={o.snapshot.error ?? o.snapshot.lastError} />
              <Row label="Measurements in view" value={o.snapshot.configured ? o.snapshot.measurements.toLocaleString() : "chain not configured"} />
              <Row label="Shrunken reads refused" value={o.snapshot.emptyResultsRejected} error={o.snapshot.emptyResultsRejected > 0 ? "an RPC answered with fewer logs than the chain holds; the previous snapshot was kept" : null} />
              <Row label="Attestation lag" value={o.attestation.error ? "—" : `${o.attestation.lag.toLocaleString()} blocks`} error={o.attestation.error ?? (o.attestation.lag > 200 ? "attestation is more than ~40 min behind Sepolia" : null)} />
              <Row label="Attested / Sepolia head" value={o.attestation.error ? "—" : `${o.attestation.attestedHeight.toLocaleString()} / ${o.attestation.sepoliaHead.toLocaleString()}`} />
            </CardContent>
          </Card>
        </div>
      )}

      {query.error && <div className="rounded-xl border border-[#F06A59]/30 bg-[#FFF8F6] px-4 py-3 text-xs text-[#B44A3C]">{query.error.message}</div>}
    </PageFrame>
  );
}
