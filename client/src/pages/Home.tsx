/**
 * SignalProof product console.
 * Design language: civic infrastructure operations software — signal navy, verified aqua,
 * attention coral, pale mist surfaces. Every number on screen comes from the two deployed
 * contracts; there is no fixture fallback, so a blank panel means the chain has nothing to show
 * rather than that the demo is between states.
 */
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  Gauge,
  Grid2X2,
  Layers3,
  MapPin,
  Menu,
  Network,
  Radio,
  Route,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WalletCards,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import CoverageMap from "@/components/CoverageMap";
import { useWallet } from "@/hooks/useWallet";
import WalletControl, { WrongChainBanner } from "@/components/WalletControl";
import ClaimReward from "@/components/ClaimReward";
import { TrustBoundary } from "@/components/TrustBoundary";
import {
  LocationError,
  measureLatency,
  measureLocation,
  measureThroughput,
  readNetworkClass,
  type LatencyResult,
  type LocationResult,
  type NetworkClass,
  type ThroughputResult,
} from "@/lib/measure";
import { deriveMeasurementRoot, deriveSessionHash, makeNonce } from "@shared/measurement";

const sourceDocs = "https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk";

type Mode = "overview" | "measure" | "proofs" | "api";
type TestState = "idle" | "sampling" | "submitted" | "attesting" | "settled" | "rejected";



/**
 * Collapse latency and throughput into a single 0-100 quality score.
 *
 * Deliberately simple and stated openly rather than tuned to flatter the data: latency contributes
 * a linear penalty up to 200 ms, throughput a linear credit up to 100 Mbps, weighted evenly.
 */
function qualityScore(latencyMs: number | null, downloadMbps: number | null): number {
  const lat = latencyMs == null ? 50 : Math.max(0, 100 - latencyMs / 2);
  const dl = downloadMbps == null ? 50 : Math.min(100, downloadMbps);
  return Math.round(Math.max(0, Math.min(100, lat * 0.5 + dl * 0.5)));
}

function toneFor(quality: number) {
  if (quality >= 80) return { status: "strong", color: "#31B7A6" };
  if (quality >= 60) return { status: "watch", color: "#F4B95E" };
  return { status: "attention", color: "#F06A59" };
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Format a wei string as CTC with up to 4 decimals, without pulling in a bignum formatter. */
function formatCtc(wei: string | null): string {
  if (!wei) return "0";
  const v = Number(BigInt(wei)) / 1e18;
  return v.toFixed(v >= 1 ? 2 : 4).replace(/\.?0+$/, "") || "0";
}

function relativeTime(epochSeconds: number | null): string {
  if (!epochSeconds) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusClass(status: string) {
  if (status === "settled" || status === "verified" || status === "Settled") return "bg-[#DDF7F1] text-[#147A70]";
  if (status === "awaiting" || status === "Awaiting attestation") return "bg-[#FFF0D2] text-[#9A6517]";
  return "bg-[#FDE4DF] text-[#B44A3C]";
}

function qualityLabel(value: number) {
  if (value >= 80) return "Strong";
  if (value >= 60) return "Watch";
  return "Attention";
}

function FlowStep({ index, title, detail, state }: { index: string; title: string; detail: string; state: "done" | "active" | "idle" }) {
  return (
    <div className="flex gap-3">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${state === "done" ? "border-[#31B7A6] bg-[#DDF7F1] text-[#147A70]" : state === "active" ? "border-[#F06A59] bg-[#FDE4DF] text-[#B44A3C]" : "border-[#D7E0E7] bg-white text-[#73879A]"}`}>{state === "done" ? <Check className="h-3.5 w-3.5" /> : index}</div>
      <div><div className="text-sm font-semibold text-[#102A43]">{title}</div><div className="mt-0.5 text-xs leading-relaxed text-[#73879A]">{detail}</div></div>
    </div>
  );
}

type Zone = { name: string; code: string; quality: number; samples: number; status: string; color: string; lastUpdatedMs: number | null };


export default function Home() {
  const [mode, setMode] = useState<Mode>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState("Kota Tua");
  const [testState, setTestState] = useState<TestState>("idle");
  const [copied, setCopied] = useState(false);

  /**
   * Live read model, straight from the deployed contracts.
   *
   * Polls every 15 s — the same cadence as the server-side proof worker. When the chain is not
   * configured, or has no measurements yet, every derived list below is empty and the UI says so.
   * It used to fall back to plausible sample rows; those render identically to real ones for the
   * second before the query lands, which makes a screenshot of the console unverifiable.
   */
  const onchain = trpc.signalproof.onchain.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const snap = onchain.data;
  const isLive = Boolean(snap?.configured && snap.totals.submitted > 0);
  /**
   * Which protocol steps have actually run, from chain state.
   *
   * These four were hardcoded to done/active/idle/idle, so the panel claimed BlockProver and
   * settlement had never executed while four measurements sat settled on-chain.
   */
  const pathwayState = useMemo(() => {
    const done = (v: boolean) => (v ? "done" : "idle") as "done" | "active" | "idle";
    if (!snap || snap.totals.submitted === 0) {
      return { source: "idle", proof: "idle", verify: "idle", settle: "idle" } as const;
    }
    const anySettled = snap.totals.settled > 0;
    const anyAwaiting = snap.totals.awaiting > 0;
    return {
      source: "done" as const,
      proof: anyAwaiting ? ("active" as const) : done(anySettled),
      verify: done(anySettled),
      settle: done(anySettled),
    };
  }, [snap]);

  /** Real readiness, from the server. The status light was previously a constant. */
  const integration = trpc.signalproof.integrationStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  /** True until the first chain read resolves. Nothing numeric may be asserted before then. */
  const isLoading = onchain.isLoading && !snap;

  // Nothing invented is ever rendered. Before the chain answers, and when it has nothing to say,
  // these are empty and the UI says so — a plausible-looking number with no chain behind it is
  // worse than a blank, because a reader cannot tell the two apart.
  const zones = useMemo<Zone[]>(() => {
    if (!isLive || !snap) return [];
    return snap.coverage.map((c, i) => {
      const quality = qualityScore(c.avgLatencyMs, c.avgDownloadMbps);
      return {
        name: c.areaHash,
        code: c.areaHash,
        quality,
        samples: c.sampleCount,
        lastUpdatedMs: c.lastUpdatedMs,
        ...toneFor(quality),
      };
    });
  }, [isLive, snap]);

  const measurements = useMemo(() => {
    if (!isLive || !snap) return [];
    return snap.measurements.slice(0, 6).map((m) => ({
      id: m.measurementRoot.slice(0, 8),
      device: shortAddress(m.contributor),
      area: m.areaHash,
      network: `chain ${snap.sepoliaChainId}`,
      latency: m.latencyMs == null ? "—" : `${m.latencyMs} ms`,
      speed: m.downloadMbps == null ? "—" : `${m.downloadMbps} Mbps`,
      status: m.status === "SETTLED" ? "settled" : "awaiting",
      time: relativeTime(m.timestamp),
    }));
  }, [isLive, snap]);

  const proofQueue = useMemo(() => {
    if (!isLive || !snap) return [];
    return snap.measurements.slice(0, 6).map((m) => ({
      id: m.measurementRoot.slice(0, 8),
      device: shortAddress(m.contributor),
      tx: shortHash(m.creditcoinTxHash ?? m.sourceTxHash),
      block: (m.sourceBlockNumber ?? 0).toLocaleString(),
      status: m.status === "SETTLED" ? "Settled" : "Awaiting attestation",
      tone: m.status === "SETTLED" ? "teal" : "amber",
      detail:
        m.status === "SETTLED"
          ? `Proof verified on Creditcoin. Reward ${formatCtc(m.rewardAmount)} CTC released.`
          : "Source block is mined; waiting for Creditcoin attestation.",
      // Settled rows point at the Creditcoin settlement; pending ones at the source-chain
      // commitment, which is the only transaction that exists yet.
      href: m.creditcoinTxHash
        ? `https://creditcoin-testnet.blockscout.com/tx/${m.creditcoinTxHash}`
        : m.sourceTxHash
          ? `https://sepolia.etherscan.io/tx/${m.sourceTxHash}`
          : null,
    }));
  }, [isLive, snap]);

  const trendData = useMemo(() => {
    if (!isLive || !snap || snap.measurements.length === 0) return [];
    return [...snap.measurements]
      .filter((m) => m.timestamp)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .slice(-12)
      .map((m) => ({
        time: new Date((m.timestamp ?? 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        quality: qualityScore(m.latencyMs, m.downloadMbps),
        latency: m.latencyMs ?? 0,
      }));
  }, [isLive, snap]);

  /** Lowest-scoring area, which is what the operator cue should actually talk about. */
  const weakest = useMemo(
    () => [...zones].sort((a, b) => a.quality - b.quality)[0] ?? null,
    [zones],
  );

  // Keep the selection valid: a zone that has dropped out of the coverage set cannot stay selected.
  useEffect(() => {
    if (zones.length > 0 && !zones.some((z) => z.name === selectedZone)) {
      setSelectedZone(zones[0].name);
    }
  }, [zones, selectedZone]);

  /** When the chain snapshot was last actually fetched — not a decorative constant. */
  const lastSync = useMemo(() => {
    const at = onchain.dataUpdatedAt;
    if (!at) return "—";
    const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)} min ago`;
  }, [onchain.dataUpdatedAt, snap]);

  /** Headline numbers. Every one is a count of something the two chains agree on. */
  const kpi = useMemo(() => {
    if (!isLive || !snap) {
      // No invented numbers. Before the chain answers, and when it has nothing to report, the
      // dashboard says so with an em-dash rather than showing a plausible figure.
      return { coverage: "—", measurements: "—", latency: "—", rewards: "—", contributors: 0, unit: "CTC" };
    }
    const lat = snap.measurements.map((m) => m.latencyMs).filter((v): v is number => v != null).sort((a, b) => a - b);
    const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
    const pct = snap.totals.submitted ? (snap.totals.settled / snap.totals.submitted) * 100 : 0;
    return {
      coverage: pct.toFixed(1),
      measurements: snap.totals.submitted.toLocaleString(),
      latency: String(median),
      rewards: formatCtc(snap.totals.rewardsPaidWei),
      contributors: snap.totals.contributors,
      unit: "CTC",
    };
  }, [isLive, snap]);

  // ---------------------------------------------------------------- //
  // Real measurement                                                  //
  // ---------------------------------------------------------------- //

  const wallet = useWallet();

  const [reading, setReading] = useState<{
    latency?: LatencyResult;
    throughput?: ThroughputResult;
    location?: LocationResult;
    network?: NetworkClass;
    bytes?: number;
  }>({});
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [submittedRoot, setSubmittedRoot] = useState<string | null>(null);

  const submitMeasurement = trpc.signalproof.submitMeasurement.useMutation();

  /** One session id per tab. Only its hash is ever sent. */
  const sessionId = useMemo(() => makeNonce(), []);

  /**
   * Run a real measurement.
   *
   * Deliberately sequential and fail-closed. Location comes first because it is the only step that
   * prompts, and because a measurement without an area has nothing to attach itself to — the
   * contract requires an areaHash and the coverage map groups on it, so a placeholder would draw a
   * cell that does not exist.
   */
  const runTest = async () => {
    if (!wallet.address) return;

    setMode("measure");
    setMeasureError(null);
    setSubmittedRoot(null);
    setReading({});
    setTestState("sampling");

    try {
      const location = await measureLocation();
      setReading((r) => ({ ...r, location }));

      const network = readNetworkClass();
      setReading((r) => ({ ...r, network }));

      const latency = await measureLatency();
      setReading((r) => ({ ...r, latency }));

      const throughput = await measureThroughput((bytes) =>
        setReading((r) => ({ ...r, bytes })),
      );
      setReading((r) => ({ ...r, throughput }));

      const timestampMs = String(Date.now());
      const nonce = makeNonce();
      const sessionHash = deriveSessionHash(sessionId);

      const canonical = {
        areaHash: location.geohash,
        networkType: network.effectiveType,
        latencyMs: latency.medianMs,
        downloadMbps: Math.round(throughput.mbps),
        uploadMbps: 0,
        packetLossBps: 0,
        timestampMs,
        nonce,
        sessionHash,
        contributorAddress: wallet.address,
      };
      const measurementRoot = deriveMeasurementRoot(canonical);

      // Free, gasless, off-chain. The server recovers the signer and refuses anything that does not
      // match the named contributor, so this is what makes the reward attribution the
      // contributor's own claim.
      const signed = await wallet.signMeasurement(measurementRoot, canonical.contributorAddress);
      if (!signed.ok || !signed.signature) {
        throw new Error(signed.error ?? "You declined to sign the measurement.");
      }

      setTestState("submitted");
      await submitMeasurement.mutateAsync({
        deviceAlias: navigator.platform || "browser",
        areaHash: canonical.areaHash,
        // The gateway requires a network type; the browser may not have one to give.
        networkType: network.effectiveType ?? "unreported",
        latencyMs: canonical.latencyMs,
        downloadMbps: canonical.downloadMbps,
        uploadMbps: canonical.uploadMbps,
        packetLossBps: canonical.packetLossBps,
        timestampMs,
        nonce,
        measurementRoot,
        sessionHash,
        signature: signed.signature,
        contributorAddress: wallet.address,
      });

      setSubmittedRoot(measurementRoot);
      setTestState("attesting");
    } catch (error) {
      setTestState("rejected");
      setMeasureError(
        error instanceof LocationError
          ? error.message
          : error instanceof Error
            ? error.message.slice(0, 200)
            : "The measurement could not be completed.",
      );
    }
  };

  /**
   * Follow the submitted measurement through the chain.
   *
   * Polls the gateway rather than guessing: the real wait is ~8.5 minutes, dominated by attestation,
   * and no client-side timer can know where it is.
   */
  const tracked = trpc.signalproof.getMeasurement.useQuery(
    { measurementRoot: submittedRoot ?? "" },
    { enabled: Boolean(submittedRoot), refetchInterval: 15_000 },
  );

  /**
   * Live attestation countdown.
   *
   * The ~8 minute wait is not dead time, it is the protocol working — Creditcoin's attestation
   * frontier advancing toward the Sepolia block this measurement landed in. Every number here can
   * be checked against a block explorer, which is why it beats any progress bar.
   */
  const attestation = trpc.signalproof.attestationProgress.useQuery(
    { sourceBlockNumber: Number(tracked.data?.sourceBlockNumber ?? 0) },
    {
      enabled: Boolean(tracked.data?.sourceBlockNumber) && testState === "attesting",
      refetchInterval: 20_000,
    },
  );

  useEffect(() => {
    const status = tracked.data?.status;
    if (!status) return;
    if (status === "SETTLED") setTestState("settled");
    else if (status === "REJECTED") setTestState("rejected");
    else if (status === "AWAITING_ATTESTATION" || status === "PROOF_VERIFIED") {
      setTestState("attesting");
    }
  }, [tracked.data?.status]);

  /**
   * The payload as it actually stands right now.
   *
   * Before a measurement runs there is nothing to show, so it says so. The previous static block
   * was not merely stale — every field in it would be rejected by the gateway's own validation.
   */
  const payloadPreview = useMemo(() => {
    if (!reading.location || !reading.latency) {
      return (
        <span className="text-[#8EA0AC]">
          Nothing yet. Run a measurement and the exact payload appears here before it is sent.
        </span>
      );
    }
    const shown = {
      areaHash: reading.location.geohash,
      networkType: reading.network?.effectiveType ?? "unreported",
      latencyMs: reading.latency.medianMs,
      downloadMbps: reading.throughput ? Math.round(reading.throughput.mbps) : null,
      contributorAddress: wallet.address,
      measurementRoot: submittedRoot,
    };
    return <>{JSON.stringify(shown, null, 2)}</>;
  }, [reading, wallet.address, submittedRoot]);

  /**
   * What the pipeline is actually doing, in words.
   *
   * Never a percentage: there is no denominator for "how attested is a block", and the previous
   * 30/54/78/100 ladder implied one. The bar is a coarse position indicator, the label is the truth.
   */
  const stageLabel = useMemo(() => {
    switch (testState) {
      case "sampling": return "measuring on this device";
      case "submitted": return "sent to gateway";
      case "attesting": return "awaiting Creditcoin attestation · ~8 min";
      case "settled": return "settled on Creditcoin";
      case "rejected": return "stopped";
      default: return "idle";
    }
  }, [testState]);

  const stageWidth = useMemo(() => {
    switch (testState) {
      case "sampling": return "25%";
      case "submitted": return "45%";
      case "attesting": return "70%";
      case "settled": return "100%";
      default: return "0%";
    }
  }, [testState]);

  /**
   * The stage line, replaced by a real block countdown once one exists.
   *
   * "35 blocks to go" is monotonically decreasing, updates on the real 20 s poll, and can be
   * verified against a Sepolia explorer. A percentage could do none of those things.
   */
  const attestationLabel = useMemo(() => {
    const a = attestation.data;
    if (testState === "attesting" && a && !a.error) {
      if (a.attested) return "attested \u00b7 fetching proof";
      const mins = Math.max(1, Math.round((a.blocksRemaining * 12) / 60));
      return `${a.blocksRemaining} block${a.blocksRemaining === 1 ? "" : "s"} to attestation \u00b7 ~${mins} min`;
    }
    return stageLabel;
  }, [attestation.data, testState, stageLabel]);

  /**
   * Simulated rejection, for demonstrating what a tampered payload looks like.
   *
   * Explicitly NOT a measurement: nothing is measured, submitted, or put on any chain. Kept
   * separate from runTest so a viewer can never mistake which button produced the state on screen.
   */
  /**
   * Submit a genuinely tampered payload and show the server's real answer.
   *
   * This used to be pure setState — it asserted a rejection that never happened. Now it signs an
   * honest root, then inflates the throughput before sending, so the values no longer hash to the
   * signed commitment. The rejection on screen is the gateway's, not ours.
   */
  const runTamperedDemo = async () => {
    if (!wallet.address) return;
    setMode("measure");
    setMeasureError(null);
    setSubmittedRoot(null);
    setTestState("sampling");

    try {
      const location = await measureLocation();
      const network = readNetworkClass();
      const latency = await measureLatency();
      setReading({ location, network, latency });

      const timestampMs = String(Date.now());
      const nonce = makeNonce();
      const sessionHash = deriveSessionHash(sessionId);
      const honest = {
        areaHash: location.geohash,
        networkType: network.effectiveType,
        latencyMs: latency.medianMs,
        downloadMbps: 25,
        uploadMbps: 0,
        packetLossBps: 0,
        timestampMs,
        nonce,
        sessionHash,
        contributorAddress: wallet.address,
      };
      const measurementRoot = deriveMeasurementRoot(honest);
      const signed = await wallet.signMeasurement(measurementRoot, honest.contributorAddress);
      if (!signed.ok || !signed.signature) {
        throw new Error(signed.error ?? "You declined to sign.");
      }

      setTestState("submitted");
      await submitMeasurement.mutateAsync({
        deviceAlias: "tamper-demo",
        areaHash: honest.areaHash,
        networkType: network.effectiveType ?? "unreported",
        latencyMs: honest.latencyMs,
        // The tamper: 25 Mbps was signed, 999 is sent.
        downloadMbps: 999,
        uploadMbps: 0,
        packetLossBps: 0,
        timestampMs,
        nonce,
        measurementRoot,
        sessionHash,
        signature: signed.signature,
        contributorAddress: wallet.address,
      });

      // Reaching here would mean the gateway accepted a forged payload.
      setTestState("rejected");
      setMeasureError("The gateway ACCEPTED a tampered payload. That is a bug — please report it.");
    } catch (error) {
      setTestState("rejected");
      const message = error instanceof Error ? error.message : String(error);
      setMeasureError(
        message.includes("MEASUREMENT_ROOT_MISMATCH")
          ? "Rejected by the gateway: MEASUREMENT_ROOT_MISMATCH. The throughput was changed to 999 Mbps after signing, so the values no longer hash to the signed commitment. Nothing reached any chain."
          : message.slice(0, 220),
      );
    }
  };

  const copyProof = async () => {
    await navigator.clipboard?.writeText(submittedRoot ?? tracked.data?.sourceTxHash ?? "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1700);
  };

  const navItems: { id: Mode; label: string; icon: typeof Grid2X2 }[] = [
    { id: "overview", label: "Coverage overview", icon: Grid2X2 },
    { id: "measure", label: "Run a test", icon: Smartphone },
    { id: "proofs", label: "Proof queue", icon: ShieldCheck },
    { id: "api", label: "Data products", icon: Layers3 },
  ];

  return (
    <main className="min-h-screen bg-[#F5F8FA] text-[#102A43]">
      <div className="flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-[#DCE5EB] bg-[#102A43] px-5 py-5 text-white transition-transform lg:sticky lg:top-0 lg:translate-x-0 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between"><div className="flex items-center gap-3"><svg viewBox="0 0 36 36" className="h-9 w-9 rounded-lg bg-white p-1" role="img" aria-label="SignalProof mark"><rect x="5" y="14" width="4" height="14" rx="1.5" fill="#102A43" /><rect x="13" y="9" width="4" height="19" rx="1.5" fill="#102A43" /><rect x="21" y="4" width="4" height="24" rx="1.5" fill="#31B7A6" /><circle cx="29.5" cy="7" r="2.5" fill="#F06A59" /></svg><div><div className="font-display text-sm font-bold tracking-[0.12em]">SIGNALPROOF</div><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">connectivity intelligence</div></div></div><button onClick={() => setMobileNavOpen(false)} className="lg:hidden" aria-label="Close navigation">×</button></div>
          <div className="mt-9 rounded-xl border border-white/10 bg-white/[.07] p-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#31B7A6]/20 text-[#62DCCB]"><Network className="h-4 w-4" /></span><div><div className="text-xs font-semibold">Operator workspace</div><div className="mt-0.5 text-[10px] text-white/45">{isLoading ? "connecting…" : isLive ? `CC3 Testnet · ${snap?.totals.contributors ?? 0} contributor${snap?.totals.contributors === 1 ? "" : "s"}` : "Chain not configured"}</div></div></div></div>
          <div className="mt-9 font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">Workspace</div>
          <nav className="mt-3 space-y-1">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { setMode(item.id); setMobileNavOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${mode === item.id ? "bg-white text-[#102A43] shadow-lg" : "text-white/65 hover:bg-white/[.08] hover:text-white"}`}><Icon className="h-4 w-4" /><span>{item.label}</span>{item.id === "proofs" && proofQueue.length > 0 && <span className="ml-auto rounded-full bg-[#F06A59] px-1.5 py-0.5 text-[9px] font-bold text-white">{proofQueue.length}</span>}</button>; })}</nav>
          <div className="mt-auto space-y-4"><div className="rounded-xl border border-white/10 bg-[#173956] p-4"><div className="flex items-start justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#62DCCB]">Protocol rail</div><div className="mt-2 text-sm font-semibold">{integration.data ? (integration.data.proofWorkerReady ? "Attestcoin ready" : integration.data.relayerReady ? "Relayer only — proof worker off" : "Chain not configured") : "Checking…"}</div></div><span className={`h-2 w-2 rounded-full ${integration.data?.proofWorkerReady ? "bg-[#62DCCB] shadow-[0_0_14px_#62DCCB]" : "bg-[#F4B95E]"}`} /></div><div className="mt-3 text-[11px] leading-relaxed text-white/55">CC3 Testnet verifies source-chain measurement proofs before reward settlement.</div><a href={sourceDocs} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[#62DCCB]">Read SDK docs <ExternalLink className="h-3 w-3" /></a></div><div className="flex items-center gap-2 px-2 text-[10px] text-white/35"><span className="h-2 w-2 rounded-full bg-[#62DCCB]" /> {isLive ? `Live · ${snap?.totals.settled ?? 0} settled on CC3` : "Prototype mode · fixture data"}</div></div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between border-b border-[#DCE5EB] bg-[#F5F8FA]/90 px-5 backdrop-blur-xl lg:px-9"><div className="flex items-center gap-3"><button onClick={() => setMobileNavOpen(true)} className="rounded-lg border border-[#DCE5EB] p-2 lg:hidden" aria-label="Open navigation"><Menu className="h-4 w-4" /></button><div><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#7B8F9D]">SignalProof / Operator console</div><div className="mt-1 font-display text-lg font-semibold">{mode === "overview" ? "Coverage overview" : mode === "measure" ? "Run a measurement" : mode === "proofs" ? "Proof queue" : "Data products"}</div></div></div><div className="flex items-center gap-2 sm:gap-3"><Badge className="hidden rounded-full border border-[#F4B95E]/40 bg-[#FFF0D2] text-[#9A6517] sm:flex"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#F4B95E]" /> {isLive ? `CC3 TESTNET · LIVE` : "CC3 TESTNET"}</Badge><WalletControl wallet={wallet} /></div></header>

          <WrongChainBanner wallet={wallet} />
            <div className="mx-auto max-w-[1480px] px-5 py-7 lg:px-9 lg:py-9">
            <div className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.19em] text-[#F06A59]"><span className="h-px w-7 bg-[#F06A59]" /> Live decision surface</div><h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-[1.04] tracking-[-0.04em] sm:text-5xl">Know where the signal<br /><span className="text-[#147A70]">breaks before users do.</span></h1><p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#6C8291]">Smartphone measurements become area-level connectivity evidence for operators, venues, and public infrastructure teams.</p></div><div className="flex items-center gap-3"><div className="rounded-xl border border-[#DCE5EB] bg-white px-3 py-2 text-right"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8EA0AC]">Last sync</div><div className="mt-1 text-xs font-semibold text-[#426176]">{isLive ? (onchain.isFetching ? "syncing…" : lastSync) : "—"}</div></div><Button onClick={() => setMode("measure")} className="gap-2 rounded-xl bg-[#F06A59] text-white shadow-[0_8px_20px_rgba(240,106,89,.2)] hover:bg-[#dc5b4b]"><Smartphone className="h-4 w-4" /> Run a test</Button></div></div>

            {mode === "overview" && <>
              <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#6C8291]">Verified coverage</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DDF7F1] text-[#147A70]"><ShieldCheck className="h-4 w-4" /></span></div><div className="mt-4 font-display text-3xl font-bold">{kpi.coverage}<span className="text-base text-[#8EA0AC]">%</span></div><div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#147A70]"><ArrowUpRight className="h-3.5 w-3.5" /> {isLive ? `${snap?.totals.settled ?? 0} settled` : "—"} <span className="font-normal text-[#8EA0AC]">{isLive ? "of all submissions" : "waiting for chain data"}</span></div></CardContent></Card><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#6C8291]">Measurements</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E7EEF8] text-[#4C75B2]"><Activity className="h-4 w-4" /></span></div><div className="mt-4 font-display text-3xl font-bold">{kpi.measurements}</div><div className="mt-2 text-xs text-[#8EA0AC]">{isLive ? `${snap?.totals.awaiting ?? 0} awaiting attestation` : "waiting for chain data"}</div></CardContent></Card><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#6C8291]">Median latency</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF0D2] text-[#9A6517]"><Gauge className="h-4 w-4" /></span></div><div className="mt-4 font-display text-3xl font-bold">{kpi.latency}<span className="text-base text-[#8EA0AC]">ms</span></div><div className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#147A70]"><ArrowUpRight className="h-3.5 w-3.5 rotate-[-45deg]" /> {isLive ? "median" : "—"} <span className="font-normal text-[#8EA0AC]">{isLive ? "across all submitted measurements" : "no data"}</span></div></CardContent></Card><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#6C8291]">Rewards settled</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FDE4DF] text-[#B44A3C]"><Zap className="h-4 w-4" /></span></div><div className="mt-4 font-display text-3xl font-bold">{kpi.rewards}<span className="ml-1 text-base text-[#8EA0AC]">{kpi.unit}</span></div><div className="mt-2 text-xs text-[#8EA0AC]">Across {kpi.contributors} contributor{kpi.contributors === 1 ? "" : "s"}</div></CardContent></Card></div>

              <div className="mb-7 overflow-hidden rounded-lg border border-[#173956] bg-[#102A43] text-white shadow-[0_1px_0_rgba(16,42,67,.16)]"><div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0"><div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#31B7A6] text-[#102A43]"><Smartphone className="h-4 w-4" /></span><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#62DCCB]">01 / measurement</div><div className="mt-1 text-xs font-semibold">Phone captures signal</div></div></div><div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-white"><Network className="h-4 w-4" /></span><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">02 / source event</div><div className="mt-1 text-xs font-semibold">Hash committed to Sepolia</div></div></div><div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#31B7A6]/20 text-[#62DCCB]"><ShieldCheck className="h-4 w-4" /></span><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#62DCCB]">03 / Attestcoin</div><div className="mt-1 text-xs font-semibold">Inclusion proof verified</div></div></div><div className="flex min-w-0 flex-1 items-center gap-3 bg-white/[.04] px-4 py-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#F06A59] text-white"><WalletCards className="h-4 w-4" /></span><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#F9A59B]">04 / Creditcoin</div><div className="mt-1 text-xs font-semibold">Reward settles only if valid</div></div></div></div><div className="flex items-center justify-between border-t border-white/10 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.13em] text-white/40"><span>Operational proof spine</span><span>{isLive ? `${snap?.totals.awaiting ?? 0} waiting · ${snap?.totals.settled ?? 0} settled` : isLoading ? "reading the chain…" : "nothing on chain yet"}</span></div></div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]"><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardHeader className="flex-row items-start justify-between space-y-0 px-5 pb-2 pt-5 sm:px-6"><div><CardTitle className="font-display text-xl">Coverage signal map</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">Quality score by coarse area · {isLive ? "aggregated from on-chain submissions" : isLoading ? "reading the chain…" : "no on-chain submissions yet"}</p></div><div className="flex items-center gap-2"><button className="rounded-lg border border-[#DCE5EB] p-2 text-[#6C8291] hover:bg-[#F5F8FA]" aria-label="Search areas"><Search className="h-4 w-4" /></button><button className="rounded-lg border border-[#DCE5EB] p-2 text-[#6C8291] hover:bg-[#F5F8FA]" aria-label="Filter coverage"><Route className="h-4 w-4" /></button></div></CardHeader><CardContent className="px-5 pb-5 sm:px-6"><CoverageMap zones={zones} isLive={isLive} onZoneClick={setSelectedZone} /><div className="mt-4 flex items-center justify-between text-xs"><div className="flex items-center gap-2 text-[#6C8291]"><span className="font-semibold text-[#102A43]">Selected:</span> {selectedZone}</div><button onClick={() => setMode("api")} className="inline-flex items-center gap-1 font-semibold text-[#147A70] hover:text-[#0B5D56]">Open area data <ChevronRight className="h-3.5 w-3.5" /></button></div></CardContent></Card><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardHeader className="px-5 pb-2 pt-5 sm:px-6"><div className="flex items-center justify-between"><div><CardTitle className="font-display text-xl">Weakest zones</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">Where an operator should look first</p></div><CircleAlert className="h-5 w-5 text-[#F06A59]" /></div></CardHeader><CardContent className="space-y-1 px-5 pb-5 sm:px-6">{zones.filter(z => z.status !== "strong").map(zone => <button key={zone.code} onClick={() => setSelectedZone(zone.name)} className="flex w-full items-center justify-between border-b border-[#EDF2F5] py-4 text-left last:border-0 hover:bg-[#FBFCFD]"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${zone.color}18`, color: zone.color }}><Wifi className="h-4 w-4" /></span><div><div className="text-sm font-semibold">{zone.name}</div><div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#A0AFBB]">zone/{zone.code} · {zone.samples} samples</div></div></div><div className="text-right"><div className="font-display text-lg font-bold" style={{ color: zone.color }}>{zone.quality}</div><div className="text-[10px] text-[#8EA0AC]">{qualityLabel(zone.quality)}</div></div></button>)}<div className="mt-3 rounded-xl bg-[#FFF8F6] p-3 text-xs leading-relaxed text-[#8F5A51]"><span className="font-semibold text-[#B44A3C]">Operator cue:</span> {weakest ? `${weakest.name} has ${weakest.samples} sample${weakest.samples === 1 ? "" : "s"} at a quality score of ${weakest.quality}. ${weakest.quality < 60 ? "Check the backhaul before adding more contributors." : "Coverage here is holding."}` : "No areas reporting yet."}</div></CardContent></Card></div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.72fr)]"><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardHeader className="px-5 pb-2 pt-5 sm:px-6"><div className="flex items-start justify-between"><div><CardTitle className="font-display text-xl">Quality trend</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">{isLive ? "Quality score per measurement · most recent 12, all areas" : isLoading ? "Reading the chain…" : "No measurements on chain yet"}</p></div><Badge className="rounded-full bg-[#DDF7F1] text-[#147A70]">{isLive ? `${trendData.length} measurement${trendData.length === 1 ? "" : "s"}` : "—"}</Badge></div></CardHeader><CardContent className="px-5 pb-5 sm:px-6"><div className="h-[210px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 10, right: 4, left: -25, bottom: 0 }}><defs><linearGradient id="signalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#31B7A6" stopOpacity={0.28} /><stop offset="100%" stopColor="#31B7A6" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#E7EEF2" vertical={false} /><XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "#8EA0AC", fontSize: 10 }} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "#8EA0AC", fontSize: 10 }} /><Tooltip contentStyle={{ border: "1px solid #DCE5EB", borderRadius: 12, background: "#FFFFFF", fontSize: 12 }} formatter={(value) => [`${value}`, "Quality"]} /><Area type="monotone" dataKey="quality" stroke="#31B7A6" strokeWidth={3} fill="url(#signalFill)" /></AreaChart></ResponsiveContainer></div></CardContent></Card><Card className="relative overflow-hidden rounded-xl border-0 bg-[#102A43] text-white shadow-[0_8px_24px_rgba(16,42,67,.12)]"><div aria-hidden="true" className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:28px_28px]" /><CardContent className="relative flex h-full flex-col justify-between p-6"><div><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#62DCCB]"><ShieldCheck className="h-3.5 w-3.5" /> Evidence rail</div><h3 className="mt-4 max-w-xs font-display text-2xl font-semibold leading-tight">A measurement is useful when its proof is visible.</h3><p className="mt-3 max-w-sm text-xs leading-relaxed text-white/55">Each accepted session moves from source-chain event to Attestcoin proof to Creditcoin settlement.</p></div><button onClick={() => setMode("proofs")} className="mt-7 flex items-center justify-between rounded-xl border border-white/15 bg-white/[.08] p-3 text-left text-xs transition-colors hover:bg-white/[.14]"><span><span className="block font-semibold text-white">{snap ? `${snap.totals.awaiting} proof${snap.totals.awaiting === 1 ? "" : "s"} awaiting attestation` : "—"}</span><span className="mt-0.5 block text-white/45">Open verification queue</span></span><ChevronRight className="h-4 w-4 text-[#62DCCB]" /></button></CardContent></Card></div>

              <Card className="mt-5 rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardHeader className="flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5 sm:px-6"><div><CardTitle className="font-display text-xl">Recent measurements</CardTitle><p className="mt-1 text-xs text-[#8EA0AC]">Latest device sessions across your pilot grid</p></div><button onClick={() => setMode("proofs")} className="text-xs font-semibold text-[#147A70]">View all <ChevronRight className="ml-1 inline h-3.5 w-3.5" /></button></CardHeader><CardContent className="overflow-x-auto px-5 pb-5 sm:px-6"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="border-b border-[#EDF2F5] text-[10px] uppercase tracking-[0.13em] text-[#A0AFBB]"><th className="py-3 font-medium">Device</th><th className="py-3 font-medium">Area</th><th className="py-3 font-medium">Network</th><th className="py-3 font-medium">Signal</th><th className="py-3 font-medium">Status</th><th className="py-3 text-right font-medium">Time</th></tr></thead><tbody>{measurements.map(row => <tr key={row.id} className="border-b border-[#F0F3F5] last:border-0"><td className="py-4"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E7EEF8] text-[#4C75B2]"><Smartphone className="h-3.5 w-3.5" /></span><div><div className="font-semibold">{row.device}</div><div className="font-mono text-[9px] text-[#A0AFBB]">{row.id}</div></div></div></td><td className="py-4 text-[#5F7585]">{row.area}</td><td className="py-4"><span className="rounded-md bg-[#F5F8FA] px-2 py-1 text-xs font-semibold text-[#426176]">{row.network}</span></td><td className="py-4"><div className="font-semibold text-[#102A43]">{row.speed}</div><div className="text-[10px] text-[#8EA0AC]">{row.latency} latency</div></td><td className="py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusClass(row.status)}`}>{row.status === "settled" ? "Settled" : row.status === "verified" ? "Verified" : row.status === "awaiting" ? "Awaiting proof" : "Rejected"}</span></td><td className="py-4 text-right text-xs text-[#8EA0AC]">{row.time}</td></tr>)}</tbody></table></CardContent></Card>
            </>}

            {mode === "measure" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"><Card className="overflow-hidden rounded-xl border-[#DCE5EB] bg-white"><div className="relative border-b border-[#DCE5EB] bg-[#102A43] px-6 py-7 text-white"><div aria-hidden="true" className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:28px_28px]" /><div className="relative"><Badge className="rounded-full bg-[#31B7A6]/20 text-[#62DCCB]">{wallet.status === "connected" ? "LIVE MEASUREMENT · TESTNET SETTLEMENT" : "WALLET REQUIRED"}</Badge><h2 className="mt-4 font-display text-3xl font-bold">Capture a signal snapshot.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">Run a short, consent-based test. SignalProof records only the evidence needed for an area-level connectivity view.</p></div></div><CardContent className="p-6 sm:p-8"><div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]"><div className="flex flex-col items-center justify-center rounded-xl bg-[#F5F8FA] p-8 text-center"><div className={`relative flex h-32 w-32 items-center justify-center rounded-full border-[7px] ${testState === "settled" ? "border-[#31B7A6] bg-[#DDF7F1]" : testState === "rejected" ? "border-[#F06A59] bg-[#FDE4DF]" : "border-[#DCE5EB] bg-white"}`}><div className="absolute inset-2 rounded-full border border-dashed border-[#BFD1D9]" />{testState === "settled" ? <CheckCircle2 className="h-11 w-11 text-[#147A70]" /> : testState === "rejected" ? <XCircle className="h-11 w-11 text-[#B44A3C]" /> : <Radio className={`h-11 w-11 text-[#4C75B2] ${testState === "sampling" ? "animate-pulse" : ""}`} />}</div><div className="mt-5 font-display text-xl font-bold">{testState === "idle" ? "Ready to measure" : testState === "sampling" ? "Sampling network…" : testState === "submitted" ? "Measurement submitted" : testState === "attesting" ? "Awaiting attestation…" : testState === "settled" ? "Proof verified" : "Payload rejected"}</div><p className="mt-2 max-w-xs text-xs leading-relaxed text-[#73879A]">{testState === "idle" ? (wallet.status === "connected" ? "One measurement takes about 8\u20139 minutes end to end. Most of that is waiting for Creditcoin\u2019s attestation to reach your Sepolia block." : "Connect a wallet to run a real measurement. The connected address is what accrues the reward on Creditcoin.") : testState === "settled" ? "The source event was proven and the contributor reward was settled." : testState === "rejected" ? "The signed payload hash does not match the submitted value." : (submittedRoot ? "You can close this tab \u2014 the relayer and proof worker run on the server." : "Nothing is sent until the measurement completes.")}</p>{testState === "idle" && <Button onClick={() => runTest()} disabled={wallet.status !== "connected"} title={wallet.status === "connected" ? undefined : "Connect a wallet first — it is the address that will accrue the reward."} className="mt-6 w-full rounded-xl bg-[#F06A59] text-white hover:bg-[#dc5b4b]"><Zap className="mr-2 h-4 w-4" /> Run valid test</Button>}{testState === "settled" && <Button onClick={() => setTestState("idle")} variant="outline" className="mt-6 w-full rounded-xl border-[#DCE5EB]">Run another test</Button>}{testState === "rejected" && <Button onClick={() => setTestState("idle")} variant="outline" className="mt-6 w-full rounded-xl border-[#DCE5EB]">Reset scenario</Button>}</div><div className="space-y-6"><div><div className="mb-3 flex items-center justify-between"><div className="text-xs font-semibold text-[#426176]">Evidence pipeline</div><div className="font-mono text-[10px] text-[#8EA0AC]">{attestationLabel}</div></div><div className="h-2 overflow-hidden rounded-full bg-[#EDF2F5]"><div className="h-full rounded-full bg-[#31B7A6] transition-all duration-500" style={{ width: stageWidth }} /></div></div>{testState === "attesting" && attestation.data && !attestation.data.error && <div className="mt-3 rounded-lg border border-[#DCE5EB] bg-[#F8FBFC] px-3 py-2 font-mono text-[10px] leading-relaxed text-[#5F7585]"><div className="flex justify-between"><span>attested height</span><span className="text-[#102A43]">{attestation.data.attestedHeight.toLocaleString()}</span></div><div className="flex justify-between"><span>your block</span><span className="text-[#102A43]">{attestation.data.sourceBlockNumber.toLocaleString()}</span></div><div className="mt-1 border-t border-[#DCE5EB] pt-1 text-[#8EA0AC]">Creditcoin attests Sepolia in batches of ~10 blocks, about every 2 minutes. Verifiable on any Sepolia explorer.</div></div>}<div className="space-y-5"><FlowStep index="01" title="Capture session" detail="Network type, latency, throughput, coarse area, and a fresh nonce." state={testState !== "idle" && testState !== "rejected" ? "done" : "active"} /><FlowStep index="02" title="Source-chain event" detail="Measurement root is committed to the source chain and returns a txHash." state={testState === "submitted" || testState === "attesting" || testState === "settled" ? "done" : testState === "sampling" ? "active" : "idle"} /><FlowStep index="03" title="Attestcoin proof" detail="ProofBuilder waits for attestation, then returns Merkle and continuity proof data." state={testState === "attesting" ? "active" : testState === "settled" ? "done" : "idle"} /><FlowStep index="04" title="Creditcoin settlement" detail="Verified proof unlocks the reward policy; duplicate or tampered payloads do not settle." state={testState === "settled" ? "done" : "idle"} /></div><Separator /><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-[#DCE5EB] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A0AFBB]">Network class</div><div className="mt-2 font-semibold">{reading.network ? (reading.network.effectiveType ? `class ${reading.network.effectiveType}` : "Not reported") : "—"}</div><div className="mt-1 text-[10px] leading-snug text-[#8EA0AC]">{reading.network ? (reading.network.available ? "Browser\u2019s own estimate. No web API exposes the carrier or the radio generation." : "This browser does not expose a network type.") : ""}</div></div><div className="rounded-xl border border-[#DCE5EB] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A0AFBB]">Coarse area</div>{measureError && <div className="mb-3 rounded-lg border border-[#F06A59]/30 bg-[#FFF8F6] px-3 py-2 text-[11px] leading-relaxed text-[#B44A3C]">{measureError}</div>}<div className="mt-2 font-semibold">{reading.location?.geohash ?? "—"}</div><div className="mt-1 text-[10px] leading-snug text-[#8EA0AC]">{reading.location ? `\u00b1${reading.location.accuracyM} m \u2192 cell ${reading.location.cell.widthM}\u00d7${reading.location.cell.heightM} m \u00b7 coordinate discarded` : ""}</div></div><div className="rounded-xl border border-[#DCE5EB] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A0AFBB]">Latency</div><div className="mt-2 font-semibold">{reading.latency ? `${reading.latency.medianMs} ms` : "—"}</div><div className="mt-1 text-[10px] leading-snug text-[#8EA0AC]">{reading.latency ? `median of ${reading.latency.samples} round trips \u00b7 min ${reading.latency.minMs} ms` : ""}</div></div><div className="rounded-xl border border-[#DCE5EB] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#A0AFBB]">Throughput</div><div className="mt-2 font-semibold">{reading.throughput ? `${reading.throughput.mbps} Mbps` : reading.bytes ? `${(reading.bytes / 1e6).toFixed(1)} MB\u2026` : "—"}</div><div className="mt-1 text-[10px] leading-snug text-[#8EA0AC]">{reading.throughput ? `${(reading.throughput.bytes / 1e6).toFixed(2)} MB over ${reading.throughput.seconds}s${reading.throughput.uncompressed ? "" : " \u00b7 compressed, unreliable"}` : ""}</div></div></div>{testState === "idle" && <button onClick={() => { void runTamperedDemo(); }} disabled={wallet.status !== "connected"} className="text-left text-xs font-semibold text-[#B44A3C] underline decoration-[#F06A59] underline-offset-4">Demo: submit a tampered payload (gateway rejects it)</button>}</div></div></CardContent></Card><Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]"><CardHeader className="px-6 pb-2 pt-6"><CardTitle className="font-display text-xl">What the app sends</CardTitle><p className="mt-1 text-xs leading-relaxed text-[#8EA0AC]">Only the minimum evidence needed for an area-level signal.</p></CardHeader><CardContent className="space-y-3 px-6 pb-6"><div className="rounded-xl bg-[#F5F8FA] p-4 font-mono text-[10px] leading-[1.9] text-[#426176]">{payloadPreview}</div><div className="flex gap-3 rounded-xl border border-[#DDF7F1] bg-[#F5FFFC] p-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#147A70]" /><p className="text-xs leading-relaxed text-[#4F766F]">The browser prototype mirrors the production state machine. Wallet keys, relayer secrets, and proof-builder credentials stay outside the frontend.</p></div><Button variant="outline" asChild className="w-full rounded-xl border-[#DCE5EB]"><a href={sourceDocs} target="_blank" rel="noreferrer">Open Attestcoin SDK docs <ExternalLink className="ml-2 h-4 w-4" /></a></Button></CardContent></Card></div>}

            {mode === "proofs" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><Card className="rounded-xl border-[#DCE5EB] bg-white"><CardHeader className="flex-row items-start justify-between space-y-0 px-6 pb-3 pt-6"><div><CardTitle className="font-display text-2xl">Proof queue</CardTitle><p className="mt-1 text-xs leading-relaxed text-[#8EA0AC]">The asynchronous rail from source-chain event to Creditcoin settlement.</p></div><Badge className="rounded-full bg-[#FFF0D2] text-[#9A6517]">{snap && snap.totals.submitted > proofQueue.length ? `${proofQueue.length} most recent of ${snap.totals.submitted}` : `${proofQueue.length} item${proofQueue.length === 1 ? "" : "s"}`}</Badge></CardHeader><CardContent className="space-y-3 px-6 pb-6">{proofQueue.map((proof) => <a key={proof.id} href={proof.href ?? undefined} target={proof.href ? "_blank" : undefined} rel={proof.href ? "noreferrer" : undefined} aria-disabled={proof.href ? undefined : true} className={`block w-full rounded-xl border border-[#DCE5EB] p-4 text-left transition-all ${proof.href ? "hover:-translate-y-0.5 hover:border-[#BFD1D9] hover:shadow-[0_8px_20px_rgba(16,42,67,.06)]" : "cursor-default opacity-90"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${proof.tone === "teal" ? "bg-[#DDF7F1] text-[#147A70]" : proof.tone === "amber" ? "bg-[#FFF0D2] text-[#9A6517]" : "bg-[#FDE4DF] text-[#B44A3C]"}`}>{proof.tone === "teal" ? <CheckCircle2 className="h-5 w-5" /> : proof.tone === "amber" ? <Clock3 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span><div><div className="font-semibold">{proof.device} <span className="ml-1 font-mono text-[10px] font-normal text-[#A0AFBB]">{proof.id}</span></div><div className="mt-1 text-xs text-[#73879A]">{proof.detail}</div></div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusClass(proof.status)}`}>{proof.status}</span></div><div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#EDF2F5] pt-3 font-mono text-[10px] text-[#8EA0AC]"><span>tx {proof.tx}</span><span>block {proof.block}</span><span className="ml-auto inline-flex items-center gap-1 text-[#147A70]">{proof.href ? "Open on explorer" : "Fixture · no transaction"} <ChevronRight className="h-3 w-3" /></span></div></a>)}</CardContent></Card><ClaimReward wallet={wallet} /><Card className="rounded-xl border-[#DCE5EB] bg-white"><CardHeader className="px-6 pb-2 pt-6"><CardTitle className="font-display text-xl">Verified pathway</CardTitle><p className="mt-1 text-xs leading-relaxed text-[#8EA0AC]">The protocol steps a judge should be able to follow.</p></CardHeader><CardContent className="space-y-5 px-6 pb-6"><FlowStep index="01" title="Ethereum Sepolia" detail="MeasurementSubmitted event returns txHash." state={pathwayState.source} /><FlowStep index="02" title="ProofBuilder" detail="Wait for source block attestation and fetch proof data." state={pathwayState.proof} /><FlowStep index="03" title="CC3 BlockProver" detail="Verify Merkle and continuity proofs on-chain." state={pathwayState.verify} /><FlowStep index="04" title="SignalProof settlement" detail="Release reward only after application checks pass." state={pathwayState.settle} /><Separator /><div className="rounded-xl bg-[#102A43] p-4 text-white"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#62DCCB]">Integration note</div><p className="mt-2 text-xs leading-relaxed text-white/60">The UI deliberately shows the waiting state. Cross-chain proof availability is asynchronous; it is not a synchronous button animation in production.</p></div></CardContent></Card><TrustBoundary snap={snap} /></div>}

            {mode === "api" && <div className="space-y-5"><Card className="rounded-xl border-[#DCE5EB] bg-white"><CardContent className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-center"><div><Badge className="rounded-full bg-[#DDF7F1] text-[#147A70]">BUYER VIEW</Badge><h2 className="mt-3 font-display text-2xl font-bold">Area data products</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#73879A]">Package verified measurements into coverage snapshots that an ISP, venue, or public program can query without receiving personal movement trails.</p></div><Button className="gap-2 rounded-xl bg-[#102A43] text-white hover:bg-[#173956]" disabled title="Not implemented — there is no brief generator yet."><Sparkles className="h-4 w-4" /> Create area brief (not built)</Button></CardContent></Card><div className="grid gap-5 lg:grid-cols-3">{zones.map(zone => <Card key={zone.code} className="rounded-xl border-[#DCE5EB] bg-white"><CardContent className="p-5"><div className="flex items-start justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#A0AFBB]">zone/{zone.code}</div><h3 className="mt-2 font-display text-xl font-bold">{zone.name}</h3></div><div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${zone.color}18`, color: zone.color }}><Wifi className="h-5 w-5" /></div></div><div className="mt-6 flex items-end justify-between"><div><div className="font-display text-4xl font-bold" style={{ color: zone.color }}>{zone.quality}</div><div className="text-xs text-[#8EA0AC]">quality score</div></div><div className="text-right text-xs text-[#73879A]"><div>{zone.samples} sample{zone.samples === 1 ? "" : "s"}</div><div className="mt-1">{zone.lastUpdatedMs ? `updated ${relativeTime(Math.floor(zone.lastUpdatedMs / 1000))}` : "no timestamp"}</div></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#EDF2F5]"><div className="h-full rounded-full" style={{ width: `${zone.quality}%`, backgroundColor: zone.color }} /></div><button onClick={copyProof} className="mt-5 flex w-full items-center justify-between rounded-xl border border-[#DCE5EB] px-3 py-2 text-xs font-semibold text-[#426176] hover:bg-[#F5F8FA]"><span>Copy area API link</span>{copied ? <Check className="h-3.5 w-3.5 text-[#147A70]" /> : <Copy className="h-3.5 w-3.5" />}</button></CardContent></Card>)}</div><Card className="rounded-xl border-[#DCE5EB] bg-[#F0F8F8]"><CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#147A70]"><Activity className="h-4 w-4" /></div><div><div className="font-semibold text-[#102A43]">{isLive ? "Area cards are live; the buyer API is not built" : "Data API is prototype-only"}</div><p className="mt-1 text-xs leading-relaxed text-[#5E7E7C]">{isLive ? `The ${zones.length} area card${zones.length === 1 ? "" : "s"} above are read live from ${snap?.totals.submitted ?? 0} on-chain measurement${snap?.totals.submitted === 1 ? "" : "s"}. There is no buyer endpoint yet — retention policy and buyer authentication are unbuilt.` : "Sample responses illustrate the buyer surface. No chain is configured."}</p></div></div><a href={sourceDocs} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#147A70]">Read protocol docs <ExternalLink className="h-3.5 w-3.5" /></a></CardContent></Card></div>}
          </div>
        </section>
      </div>
    </main>
  );
}
