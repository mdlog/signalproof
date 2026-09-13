/**
 * Frame for route pages: the shell plus the two queries every page needs to label itself
 * honestly (live vs prototype, protocol rail state). Pages render only their own content.
 */
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import AppShell, { CONSOLE_NAV, ROUTE_NAV } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";

type Props = { title: string; activeId: string; children: ReactNode };

export default function PageFrame({ title, activeId, children }: Props) {
  const [, navigate] = useLocation();
  const onchain = trpc.signalproof.onchain.useQuery(undefined, { refetchInterval: 15_000, refetchOnWindowFocus: true });
  const integration = trpc.signalproof.integrationStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const snap = onchain.data;
  const isLive = Boolean(snap?.configured && snap.totals.submitted > 0);
  return (
    <AppShell
      title={title}
      nav={[...CONSOLE_NAV, ...ROUTE_NAV]}
      activeId={activeId}
      onSelect={(id) => navigate(`/?mode=${id}`)}
      live={{ isLoading: onchain.isLoading && !snap, isLive, contributors: snap?.totals.contributors ?? 0, settled: snap?.totals.settled ?? 0 }}
      integration={integration.data}
    >
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-5 sm:py-7 lg:px-9 lg:py-9">{children}</div>
    </AppShell>
  );
}
