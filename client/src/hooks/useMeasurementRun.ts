/**
 * Run a real measurement and follow it through the chain.
 *
 * Extracted from the console page so the button and the auto-measure loop share one
 * implementation: the same sequence, the same fail-closed rules, the same tracking. Nothing in
 * here decides what is rendered; it exposes state and two actions.
 *
 * Deliberately sequential and fail-closed. Location comes first because it is the only step that
 * prompts, and because a measurement without an area has nothing to attach itself to — the
 * contract requires an areaHash and the coverage map groups on it, so a placeholder would draw a
 * cell that does not exist.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { WalletApi } from "@/contexts/WalletContext";
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

export type TestState = "idle" | "sampling" | "submitted" | "attesting" | "settled" | "rejected";

export type RunOutcome = {
  result: "submitted" | "skipped" | "rejected";
  area: string | null;
  reason: string | null;
  measurementRoot?: string;
};

/**
 * Gateway rejection codes, in the interface's own words. Anything unknown is shown as sent, cut to
 * a length that still fits the panel.
 */
function describeSubmitError(message: string): string {
  const copy: Record<string, string> = {
    RATE_LIMITED:
      "Rate limited: this address has already recorded 3 measurements in this cell in the last 10 minutes. Try again later, or from another area.",
    STALE_MEASUREMENT: "The measurement is older than 15 minutes. Run the test again.",
    TIMESTAMP_IN_FUTURE: "Your device clock is ahead of the gateway by more than a minute.",
    DUPLICATE_MEASUREMENT_ROOT: "This exact measurement was already submitted.",
    SIGNATURE_MISMATCH: "The signature does not match the connected wallet. Reconnect and sign again.",
    MEASUREMENT_ROOT_MISMATCH: "The payload changed after it was signed. Run the test again.",
  };
  return copy[message] ?? message.slice(0, 200);
}

/** Reject with NOT_SIGNED_IN_TIME when the wallet has not answered within the deadline. */
function withDeadline<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("NOT_SIGNED_IN_TIME")), ms);
    promise.then(
      (v) => { window.clearTimeout(timer); resolve(v); },
      (e) => { window.clearTimeout(timer); reject(e); },
    );
  });
}

export function useMeasurementRun({ wallet, onStart }: { wallet: WalletApi; onStart?: () => void }) {
  const [testState, setTestState] = useState<TestState>("idle");
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
  const runTest = async (options: { signDeadlineMs?: number } = {}): Promise<RunOutcome> => {
    if (!wallet.address) return { result: "skipped", area: null, reason: "no wallet connected" };

    onStart?.();
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
      const signed = await withDeadline(
        wallet.signMeasurement(measurementRoot, canonical.contributorAddress),
        options.signDeadlineMs,
      );
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
      return { result: "submitted", area: canonical.areaHash, reason: null, measurementRoot };
    } catch (error) {
      const notSigned = error instanceof Error && error.message === "NOT_SIGNED_IN_TIME";
      // A reading that was never signed is not a rejection — nothing was sent. Back to idle.
      setTestState(notSigned ? "idle" : "rejected");
      const message =
        error instanceof LocationError
          ? error.message
          : notSigned
            ? "The reading was discarded: it was not signed within 14 minutes, and the gateway refuses anything older than 15."
            : error instanceof Error
              ? describeSubmitError(error.message)
              : "The measurement could not be completed.";
      setMeasureError(message);
      return { result: notSigned ? "skipped" : "rejected", area: null, reason: notSigned ? "not signed" : message };
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
    onStart?.();
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

  return { reading, measureError, submittedRoot, testState, setTestState, tracked, attestation, runTest, runTamperedDemo };
}
