/**
 * Auto-measure: the same measurement the button runs, every ten minutes, while the app is open.
 *
 * Each cycle still asks the wallet to sign. That is not a gap to engineer around — the registry
 * recovers the contributor's signature on-chain, and the signature is what makes the measurement
 * theirs. A reading the wallet does not sign within 14 minutes is discarded and logged as
 * skipped, because the gateway refuses anything older than 15. Browsers throttle background tabs,
 * so the honest instruction is: install the app and keep it in front.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, Clock3, Radio } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { useMeasurementRun } from "@/hooks/useMeasurementRun";
import { AUTO_MEASURE_INTERVAL_MS, SIGN_DEADLINE_MS, appendLog, msUntilNextRun, type CycleLog } from "@shared/autoMeasure";

const ENABLED_KEY = "signalproof.autoMeasure.enabled";
const LOG_KEY = "signalproof.autoMeasure.log";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

type Props = { run: ReturnType<typeof useMeasurementRun>; walletConnected: boolean };

export default function AutoMeasure({ run, walletConnected }: Props) {
  const [enabled, setEnabled] = useState<boolean>(() => readJson(ENABLED_KEY, false));
  const [log, setLog] = useState<CycleLog[]>(() => readJson<CycleLog[]>(LOG_KEY, []));
  const [lastRunAt, setLastRunAt] = useState<number | null>(() => readJson<CycleLog[]>(LOG_KEY, [])[0]?.at ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [notifications, setNotifications] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const busy = useRef(false);
  const notified = useRef<string | null>(null);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);

  // One-second clock for the countdown and the schedule check.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Run a cycle when due. `busy` guards against a cycle starting while one is still sampling.
  useEffect(() => {
    if (!enabled || !walletConnected || busy.current) return;
    if (msUntilNextRun(lastRunAt, now) > 0) return;
    if (run.testState === "sampling" || run.testState === "submitted") return;
    busy.current = true;
    const startedAt = Date.now();
    setLastRunAt(startedAt);
    void run
      .runTest({ signDeadlineMs: SIGN_DEADLINE_MS })
      .then((outcome) => {
        setLog((prev) => {
          const next = appendLog(prev, { at: startedAt, area: outcome.area, result: outcome.result, reason: outcome.reason });
          writeJson(LOG_KEY, next);
          return next;
        });
      })
      .finally(() => {
        busy.current = false;
      });
  }, [enabled, walletConnected, lastRunAt, now, run]);

  // Keep the screen awake while enabled, where the browser allows it. Best effort, never required.
  useEffect(() => {
    if (!enabled) {
      void wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
      return;
    }
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then((lock) => { wakeLock.current = lock; }).catch(() => {});
    return () => {
      void wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [enabled]);

  // Tell the contributor when a tracked measurement settles — once per root.
  useEffect(() => {
    const root = run.submittedRoot;
    if (!enabled || !root || run.testState !== "settled" || notified.current === root) return;
    notified.current = root;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Measurement settled on Creditcoin", { body: `${run.reading.location?.geohash ?? "your area"} · reward accrued. Open SignalProof to claim.`, icon: "/icon-192.png" });
      } catch {
        /* some platforms only allow notifications from a service worker */
      }
    }
  }, [enabled, run.submittedRoot, run.testState, run.reading.location?.geohash]);

  const toggle = async (on: boolean) => {
    setEnabled(on);
    writeJson(ENABLED_KEY, on);
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      setNotifications(p);
    }
  };

  const remaining = msUntilNextRun(lastRunAt, now);
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1_000);

  return (
    <Card className="rounded-xl border-[#DCE5EB] bg-white shadow-[0_1px_0_rgba(16,42,67,.08)]">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#A0AFBB]"><Radio className="h-3.5 w-3.5" /> Auto-measure</div>
            <div className="mt-2 font-display text-lg font-bold">Every {AUTO_MEASURE_INTERVAL_MS / 60_000} minutes while this app is open</div>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => void toggle(v)} disabled={!walletConnected} aria-label="Toggle auto-measure" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#73879A]">
          {walletConnected
            ? "Each cycle asks your wallet to sign — that signature is what makes the measurement yours on-chain, so there is no silent mode. A reading you do not sign within 14 minutes is discarded. Browsers slow background tabs: install SignalProof and keep it in front."
            : "Connect a wallet first. Each cycle is signed by it, because the registry recovers the contributor's signature on-chain."}
        </p>
        {enabled && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-[#F5F8FA] px-4 py-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#102A43]"><Clock3 className="h-3.5 w-3.5 text-[#147A70]" /> {busy.current || run.testState === "sampling" ? "measuring now…" : remaining === 0 ? "due now" : `next in ${mins}:${String(secs).padStart(2, "0")}`}</span>
            <span className="inline-flex items-center gap-1.5 text-[#73879A]"><Bell className="h-3.5 w-3.5" /> {notifications === "granted" ? "notifies you when a measurement settles" : notifications === "denied" ? "notifications blocked in the browser" : notifications === "unsupported" ? "no notifications on this browser" : "notifications not decided"}</span>
          </div>
        )}
        {log.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#A0AFBB]">Cycle log · this browser</div>
            <ul className="max-h-40 space-y-1 overflow-auto text-[11px]">
              {log.slice(0, 12).map((e) => (
                <li key={e.at} className="flex items-center justify-between gap-3 rounded-lg border border-[#EDF2F5] px-3 py-1.5">
                  <span className="text-[#5F7585]">{new Date(e.at).toLocaleTimeString()}{e.area ? ` · ${e.area}` : ""}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.result === "submitted" ? "bg-[#DDF7F1] text-[#147A70]" : e.result === "skipped" ? "bg-[#FFF0D2] text-[#9A6517]" : "bg-[#FDE4DF] text-[#B44A3C]"}`} title={e.reason ?? undefined}>{e.result}{e.reason && e.result !== "submitted" ? ` · ${e.reason.slice(0, 40)}` : ""}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => { setLog([]); writeJson(LOG_KEY, []); }} className="mt-2 text-[10px] text-[#8EA0AC]">Clear log</button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
