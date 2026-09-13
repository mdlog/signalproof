/**
 * Application shell: sidebar, header, wallet control and the wrong-chain banner.
 *
 * Moved verbatim out of the console page so every route — the console, the verifier, an area, a
 * contributor, operations — shares one chrome. On `/` the workspace items switch the console's
 * mode; elsewhere they are links back to it. The live/prototype wording and the protocol-rail
 * light are driven by the same chain snapshot the pages render, never by a constant.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Activity, BookOpen, ExternalLink, Grid2X2, Layers3, Menu, Network, Search, ShieldCheck, Smartphone, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import WalletControl, { WrongChainBanner } from "@/components/WalletControl";
import { useWalletContext } from "@/contexts/WalletContext";
import type { RouterOutputs } from "@/lib/trpc";

export const sourceDocs = "https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk";

export type ShellNavItem = { id: string; label: string; icon: LucideIcon; href?: string; count?: number };

/** The console's four modes, as links, for every page that is not the console. */
export const CONSOLE_NAV: ShellNavItem[] = [
  { id: "overview", label: "Coverage overview", icon: Grid2X2, href: "/?mode=overview" },
  { id: "measure", label: "Run a test", icon: Smartphone, href: "/?mode=measure" },
  { id: "proofs", label: "Proof queue", icon: ShieldCheck, href: "/?mode=proofs" },
  { id: "api", label: "Data products", icon: Layers3, href: "/?mode=api" },
];

/** Route pages, appended to the console items everywhere. */
export const ROUTE_NAV: ShellNavItem[] = [
  { id: "verify", label: "Verify a proof", icon: Search, href: "/verify" },
  { id: "contributors", label: "Contributors", icon: Users, href: "/contributors" },
  { id: "ops", label: "Operations", icon: Activity, href: "/ops" },
  { id: "docs", label: "Docs", icon: BookOpen, href: "/docs" },
];

export type ShellLive = { isLoading: boolean; isLive: boolean; contributors: number; settled: number };

type Props = {
  title: string;
  nav: ShellNavItem[];
  activeId: string;
  onSelect?: (id: string) => void;
  live: ShellLive | null;
  integration: RouterOutputs["signalproof"]["integrationStatus"] | undefined;
  children: ReactNode;
};

export default function AppShell({ title, nav, activeId, onSelect = () => {}, live, integration, children }: Props) {
  const wallet = useWalletContext();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // A drawer over the page must own the scroll while it is open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen]);

  /** Bottom tab bar on phones: the console's four modes plus a Menu tab that opens the drawer. */
  const tabs = nav.slice(0, 4);

  return (
    <main className="min-h-screen bg-[#F5F8FA] text-[#102A43]">
      <div className="flex min-h-screen">
        {mobileNavOpen && <div aria-hidden="true" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-[45] bg-[#102A43]/55 backdrop-blur-[2px] lg:hidden" />}
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-[#DCE5EB] bg-[#102A43] px-5 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0 lg:overflow-y-auto ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between"><div className="flex items-center gap-3"><img src="/logo.png" alt="SignalProof" className="h-10 w-10 shrink-0" /><div><div className="font-display text-sm font-bold tracking-[0.12em]">SIGNALPROOF</div><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">connectivity intelligence</div></div></div><button onClick={() => setMobileNavOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl leading-none text-white/70 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close navigation">×</button></div>
          <div className="mt-9 rounded-xl border border-white/10 bg-white/[.07] p-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#31B7A6]/20 text-[#62DCCB]"><Network className="h-4 w-4" /></span><div><div className="text-xs font-semibold">Operator workspace</div><div className="mt-0.5 text-[10px] text-white/45">{live?.isLoading ? "connecting…" : live?.isLive ? `CC3 Testnet · ${live.contributors} contributor${live.contributors === 1 ? "" : "s"}` : "Chain not configured"}</div></div></div></div>
          <div className="mt-9 font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">Workspace</div>
          <nav className="mt-3 space-y-1">{nav.map((item) => { const Icon = item.icon; const cls = `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${activeId === item.id ? "bg-white text-[#102A43] shadow-lg" : "text-white/65 hover:bg-white/[.08] hover:text-white"}`; const inner = <><Icon className="h-4 w-4" /><span>{item.label}</span>{item.count ? <span className="ml-auto rounded-full bg-[#F06A59] px-1.5 py-0.5 text-[9px] font-bold text-white">{item.count}</span> : null}</>; return item.href ? <Link key={item.id} href={item.href} onClick={() => setMobileNavOpen(false)} className={cls}>{inner}</Link> : <button key={item.id} onClick={() => { onSelect(item.id); setMobileNavOpen(false); }} className={cls}>{inner}</button>; })}</nav>
          <div className="mt-auto space-y-4"><div className="rounded-xl border border-white/10 bg-[#173956] p-4"><div className="flex items-start justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#62DCCB]">Protocol rail</div><div className="mt-2 text-sm font-semibold">{integration ? (integration.proofWorkerReady ? "Attestcoin ready" : integration.relayerReady ? "Relayer only — proof worker off" : integration.readOnly ? "Read-only — no relayer key" : "Chain not configured") : "Checking…"}</div></div><span className={`h-2 w-2 rounded-full ${integration?.proofWorkerReady ? "bg-[#62DCCB] shadow-[0_0_14px_#62DCCB]" : "bg-[#F4B95E]"}`} /></div><div className="mt-3 text-[11px] leading-relaxed text-white/55">{integration?.readOnly ? "Reading live settlements from both chains. Add relayer keys to .env to submit new measurements." : "CC3 Testnet verifies source-chain measurement proofs before reward settlement."}</div><a href={sourceDocs} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[#62DCCB]">Read SDK docs <ExternalLink className="h-3 w-3" /></a></div><div className="flex items-center gap-2 px-2 text-[10px] text-white/35"><span className="h-2 w-2 rounded-full bg-[#62DCCB]" /> {live?.isLive ? `Live · ${live.settled} settled on CC3` : "Prototype mode · fixture data"}</div></div>
        </aside>

        <section className="min-w-0 flex-1 overflow-x-clip pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[#DCE5EB] bg-[#F5F8FA]/90 px-4 backdrop-blur-xl sm:px-5 lg:h-[72px] lg:px-9"><div className="flex min-w-0 items-center gap-3"><button onClick={() => setMobileNavOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#DCE5EB] bg-white lg:hidden" aria-label="Open navigation"><Menu className="h-4 w-4" /></button><div className="min-w-0"><div className="hidden font-mono text-[9px] uppercase tracking-[0.2em] text-[#7B8F9D] sm:block">SignalProof / Operator console</div><div className="truncate font-display text-base font-semibold sm:mt-1 lg:text-lg">{title}</div></div></div><div className="flex shrink-0 items-center gap-2 sm:gap-3"><Badge className="hidden rounded-full border border-[#F4B95E]/40 bg-[#FFF0D2] text-[#9A6517] sm:flex"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#F4B95E]" /> {live?.isLive ? `CC3 TESTNET · LIVE` : "CC3 TESTNET"}</Badge><WalletControl wallet={wallet} /></div></header>

          <WrongChainBanner wallet={wallet} />
          {children}
        </section>
      </div>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#DCE5EB] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="grid h-16 grid-cols-5">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = activeId === item.id;
            const cls = `flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${active ? "text-[#147A70]" : "text-[#7B8F9D]"}`;
            const inner = <><span className={`relative flex h-7 w-11 items-center justify-center rounded-full ${active ? "bg-[#DDF7F1]" : ""}`}><Icon className="h-[18px] w-[18px]" />{item.count ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[#F06A59] px-1 text-[8px] font-bold leading-[14px] text-white">{item.count}</span> : null}</span><span className="max-w-[72px] truncate">{item.label.replace("Coverage overview", "Overview").replace("Run a test", "Measure").replace("Proof queue", "Proofs").replace("Data products", "Data")}</span></>;
            return item.href ? <Link key={item.id} href={item.href} className={cls}>{inner}</Link> : <button key={item.id} onClick={() => onSelect(item.id)} className={cls}>{inner}</button>;
          })}
          <button onClick={() => setMobileNavOpen(true)} className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${mobileNavOpen ? "text-[#147A70]" : "text-[#7B8F9D]"}`} aria-label="Open navigation"><span className="flex h-7 w-11 items-center justify-center rounded-full"><Menu className="h-[18px] w-[18px]" /></span>Menu</button>
        </div>
      </nav>
    </main>
  );
}
