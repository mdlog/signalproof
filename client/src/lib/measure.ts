/**
 * Real measurements taken on this device.
 *
 * Everything here is measured, never estimated from a browser hint. Two of the four values the
 * browser *does* offer are unusable for our purpose and we say so rather than passing them off:
 *
 *   - `navigator.connection.downlink` is capped at 10 Mbps in Chromium and carries a deliberate
 *     ±10% per-host randomisation, so it cannot support a throughput claim.
 *   - `navigator.connection.rtt` is rounded to 50 ms and randomised the same way.
 *
 * So latency and throughput are measured against our own origin. Only the coarse connection class
 * is taken from the browser, clearly labelled as the browser's own estimate.
 *
 * What no browser can provide, at all: the carrier name, and the radio generation. The
 * EffectiveConnectionType enum is exactly "slow-2g" | "2g" | "3g" | "4g" — there is no "5g", and
 * Chromium maps NR to unknown. Any UI that shows "5G · <carrier>" is fabricating both halves.
 */

import { AREA_PRECISION, encodeGeohash, geohashCellSize } from "@shared/geohash";

// ------------------------------------------------------------------ //
// Latency                                                            //
// ------------------------------------------------------------------ //

export type LatencyResult = {
  medianMs: number;
  minMs: number;
  samples: number;
  discarded: number;
};

const LATENCY_SAMPLES = 7;

/**
 * Round-trip time to our own origin.
 *
 * Timed with the Resource Timing entry (`responseStart - requestStart`) rather than wall clock
 * around `fetch()`, which would fold in scheduling and promise resolution. Same-origin is what
 * makes those fields readable without a Timing-Allow-Origin header.
 *
 * Median over 7 samples after one discarded warm-up: mobile radios idle down, so the first request
 * routinely costs a connection setup that has nothing to do with the link's steady state.
 */
export async function measureLatency(signal?: AbortSignal): Promise<LatencyResult> {
  const timings: number[] = [];
  let discarded = 0;

  for (let i = 0; i <= LATENCY_SAMPLES; i++) {
    if (signal?.aborted) break;
    const url = `/api/net/ping?t=${Date.now()}-${i}`;
    const started = performance.now();
    try {
      await fetch(url, { method: "HEAD", cache: "no-store", signal });
    } catch {
      discarded++;
      continue;
    }
    const wall = performance.now() - started;

    // Prefer the precise browser-reported timing when the entry is available.
    const entry = performance
      .getEntriesByType("resource")
      .reverse()
      .find((e) => e.name.includes(url)) as PerformanceResourceTiming | undefined;

    const precise =
      entry && entry.requestStart > 0 && entry.responseStart > 0
        ? entry.responseStart - entry.requestStart
        : wall;

    if (i === 0) {
      discarded++; // warm-up
      continue;
    }
    timings.push(precise);
  }

  if (timings.length === 0) throw new Error("Could not complete any latency sample");

  const sorted = [...timings].sort((a, b) => a - b);
  return {
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
    minMs: Math.round(sorted[0]),
    samples: timings.length,
    discarded,
  };
}

// ------------------------------------------------------------------ //
// Throughput                                                         //
// ------------------------------------------------------------------ //

export type ThroughputResult = {
  mbps: number;
  bytes: number;
  seconds: number;
  /** False when a proxy compressed the payload, which would inflate the figure. */
  uncompressed: boolean;
};

const PAYLOAD_BYTES = 3_000_000;
const THROUGHPUT_TIMEBOX_MS = 12_000;

/**
 * Download throughput, measured by streaming a fixed incompressible payload.
 *
 * Time-boxed so a slow link degrades to "as much as fitted in 12 s" instead of hanging. The first
 * 250 ms are excluded because TCP slow-start understates a fast link badly over that window.
 */
export async function measureThroughput(
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<ThroughputResult> {
  const url = `/api/net/payload?bytes=${PAYLOAD_BYTES}&t=${Date.now()}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  const timer = window.setTimeout(abort, THROUGHPUT_TIMEBOX_MS);

  const started = performance.now();
  let steadyStart = 0;
  let steadyBytes = 0;
  let total = 0;

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`payload responded ${response.status}`);

    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      onProgress?.(total);

      const elapsed = performance.now() - started;
      if (steadyStart === 0 && elapsed >= 250) {
        steadyStart = performance.now();
        steadyBytes = total;
      }
    }
  } catch (error) {
    if (total === 0) throw error instanceof Error ? error : new Error("throughput probe failed");
    // A timebox abort with bytes already read is a valid, if partial, measurement.
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

  const end = performance.now();
  const useSteady = steadyStart > 0 && end - steadyStart > 200;
  const seconds = (useSteady ? end - steadyStart : end - started) / 1000;
  const bytes = useSteady ? total - steadyBytes : total;

  if (seconds <= 0 || bytes <= 0) throw new Error("throughput probe produced no usable window");

  // A proxy that gzipped the response would make this a fiction; the entry tells us if it did.
  const entry = performance
    .getEntriesByType("resource")
    .reverse()
    .find((e) => e.name.includes("/api/net/payload")) as PerformanceResourceTiming | undefined;
  const uncompressed =
    !entry || entry.encodedBodySize === 0 || entry.encodedBodySize === entry.decodedBodySize;

  return {
    mbps: Math.round(((bytes * 8) / seconds / 1_000_000) * 10) / 10,
    bytes: total,
    seconds: Math.round(seconds * 10) / 10,
    uncompressed,
  };
}

// ------------------------------------------------------------------ //
// Network class                                                      //
// ------------------------------------------------------------------ //

export type NetworkClass = {
  /** "4g" | "3g" | "2g" | "slow-2g", or null when the browser does not expose one. */
  effectiveType: string | null;
  /** "cellular" | "wifi" | "ethernet" | …, or null. Chromium desktop usually omits this. */
  connectionType: string | null;
  available: boolean;
};

/**
 * What the browser will admit about the connection.
 *
 * Returns nulls rather than guesses on Firefox and Safari, which do not implement the Network
 * Information API at all. The UI must render that absence, not fill it.
 */
export function readNetworkClass(): NetworkClass {
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; type?: string } })
    .connection;
  if (!conn) return { effectiveType: null, connectionType: null, available: false };
  return {
    effectiveType: conn.effectiveType ?? null,
    connectionType: conn.type ?? null,
    available: true,
  };
}

// ------------------------------------------------------------------ //
// Coarse location                                                    //
// ------------------------------------------------------------------ //

export type LocationResult = {
  geohash: string;
  accuracyM: number;
  cell: { widthM: number; heightM: number };
};

export type LocationFailure =
  | "insecure-context"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "timeout"
  | "too-coarse";

export class LocationError extends Error {
  constructor(
    readonly reason: LocationFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Coarser than one cell — placing it on the map would be a fabrication. */
const MAX_USABLE_ACCURACY_M = 2_000;

/**
 * A coarse area, as a geohash.
 *
 * `enableHighAccuracy: false` on purpose: a precision-6 cell is ~1.2 km across, so GPS would burn
 * battery and widen the permission ask for resolution we immediately discard. The raw coordinate
 * never leaves this function — only the geohash is returned.
 */
export async function measureLocation(): Promise<LocationResult> {
  // Geolocation is gated on a secure context, and `'geolocation' in navigator` is true even where
  // it will always fail — so check the context, not the presence of the API.
  if (!window.isSecureContext) {
    throw new LocationError(
      "insecure-context",
      "Location needs a secure context. Open this over HTTPS, or on localhost.",
    );
  }
  if (!("geolocation" in navigator)) {
    throw new LocationError("unsupported", "This browser does not provide location.");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  }).catch((err: GeolocationPositionError) => {
    // Never surface err.message — the spec marks it debug-only and engines word it differently.
    if (err.code === 1) {
      throw new LocationError("denied", "You declined location. Nothing was sent.");
    }
    if (err.code === 2) {
      throw new LocationError(
        "unavailable",
        "Your device could not determine a position. This is not a permission problem.",
      );
    }
    throw new LocationError("timeout", "Timed out waiting for a position.");
  });

  const accuracyM = Math.round(position.coords.accuracy);
  if (accuracyM > MAX_USABLE_ACCURACY_M) {
    throw new LocationError(
      "too-coarse",
      `Your browser reported ±${accuracyM} m, which is coarser than one area cell (about 1.2 km). Desktops without Wi-Fi location fall back to IP geolocation; use a phone, enable location services, or in Chrome DevTools → Sensors set a position.`,
    );
  }

  const geohash = encodeGeohash(
    position.coords.latitude,
    position.coords.longitude,
    AREA_PRECISION,
  );
  return { geohash, accuracyM, cell: geohashCellSize(geohash)! };
}

/** Whether the browser has already been told 'no', so the UI can explain instead of re-prompting. */
export async function locationPermissionState(): Promise<PermissionState | "unknown"> {
  if (!("permissions" in navigator)) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}
