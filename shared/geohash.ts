/**
 * Geohash encode/decode — the coarse-area convention for SignalProof.
 *
 * `areaHash` is a geohash, not an arbitrary label. That choice is what makes the coverage map
 * real: a geohash is decodable to a bounding box, so the dashboard can place an area on an actual
 * map without anyone ever transmitting or storing a precise coordinate.
 *
 * The precision is the privacy control. At the default of 6 a cell is roughly 1.2 km x 0.6 km —
 * coarse enough to satisfy the architecture's "coarse area bucket, never a precise coordinate"
 * requirement, specific enough that a coverage map means something.
 *
 *   precision 4  ~ 39 km   x 20 km
 *   precision 5  ~ 4.9 km  x 4.9 km
 *   precision 6  ~ 1.2 km  x 0.6 km   <- default
 *   precision 7  ~ 153 m   x 153 m    (too precise to be called coarse)
 *
 * Implemented here rather than pulled from npm because it is 60 lines, has to run identically on
 * the client, the server, and the mobile client, and a dependency for this would be silly.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** The one precision the gateway accepts. Anything finer leaks location. */
export const AREA_PRECISION = 6;

export type GeoBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };
export type GeoPoint = { lat: number; lon: number };

/** Encode a coordinate to a geohash of `precision` characters. */
export function encodeGeohash(lat: number, lon: number, precision = AREA_PRECISION): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = "";
  let bits = 0;
  let bit = 0;
  let evenBit = true; // longitude first

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bit = (bit << 1) + 1;
        lonMin = mid;
      } else {
        bit = bit << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    if (++bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

/** True when `value` is a syntactically valid geohash. */
export function isGeohash(value: string): boolean {
  if (!value || value.length < 1 || value.length > 12) return false;
  for (const ch of value.toLowerCase()) {
    if (!BASE32.includes(ch)) return false;
  }
  return true;
}

/** Decode a geohash to its bounding box, or null when the input is not a geohash. */
export function decodeGeohashBounds(hash: string): GeoBounds | null {
  if (!isGeohash(hash)) return null;

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let evenBit = true;

  for (const ch of hash.toLowerCase()) {
    const index = BASE32.indexOf(ch);
    if (index === -1) return null;

    for (let n = 4; n >= 0; n--) {
      const bitN = (index >> n) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bitN === 1) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN === 1) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { minLat: latMin, maxLat: latMax, minLon: lonMin, maxLon: lonMax };
}

/** Decode a geohash to the centre of its cell, or null when the input is not a geohash. */
export function decodeGeohash(hash: string): GeoPoint | null {
  const b = decodeGeohashBounds(hash);
  if (!b) return null;
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
}

/** Approximate cell size in metres, for describing the privacy guarantee in the UI. */
export function geohashCellSize(hash: string): { widthM: number; heightM: number } | null {
  const b = decodeGeohashBounds(hash);
  if (!b) return null;
  const midLat = ((b.minLat + b.maxLat) / 2 * Math.PI) / 180;
  return {
    widthM: Math.round((b.maxLon - b.minLon) * 111_320 * Math.cos(midLat)),
    heightM: Math.round((b.maxLat - b.minLat) * 110_540),
  };
}
