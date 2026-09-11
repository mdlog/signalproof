import { describe, expect, it } from "vitest";
import {
  AREA_PRECISION,
  decodeGeohash,
  decodeGeohashBounds,
  encodeGeohash,
  geohashCellSize,
  isGeohash,
} from "./geohash";

describe("encodeGeohash", () => {
  it("matches known reference values", () => {
    // Canonical examples used across geohash implementations.
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(encodeGeohash(-25.382708, -49.265506, 8)).toBe("6gkzwgjz");
    expect(encodeGeohash(0, 0, 6)).toBe("s00000");
  });

  it("produces the requested precision", () => {
    for (const p of [1, 4, 5, 6, 9, 12]) {
      expect(encodeGeohash(-6.2088, 106.8456, p)).toHaveLength(p);
    }
  });

  it("is a prefix code — a coarser hash prefixes a finer one for the same point", () => {
    const fine = encodeGeohash(-6.2088, 106.8456, 9);
    expect(fine.startsWith(encodeGeohash(-6.2088, 106.8456, 6))).toBe(true);
    expect(fine.startsWith(encodeGeohash(-6.2088, 106.8456, 4))).toBe(true);
  });
});

describe("decodeGeohash", () => {
  it("round-trips within the cell it came from", () => {
    for (const [lat, lon] of [
      [-6.2088, 106.8456], // Jakarta
      [51.5074, -0.1278], // London
      [-33.8688, 151.2093], // Sydney
      [40.7128, -74.006], // New York
      [0, 0],
    ] as const) {
      const hash = encodeGeohash(lat, lon, AREA_PRECISION);
      const bounds = decodeGeohashBounds(hash)!;
      expect(lat).toBeGreaterThanOrEqual(bounds.minLat);
      expect(lat).toBeLessThanOrEqual(bounds.maxLat);
      expect(lon).toBeGreaterThanOrEqual(bounds.minLon);
      expect(lon).toBeLessThanOrEqual(bounds.maxLon);
    }
  });

  it("returns the cell centre, close to the original point", () => {
    const centre = decodeGeohash(encodeGeohash(-6.2088, 106.8456, AREA_PRECISION))!;
    expect(centre.lat).toBeCloseTo(-6.2088, 2);
    expect(centre.lon).toBeCloseTo(106.8456, 2);
  });

  it("rejects anything that is not a geohash rather than guessing a location", () => {
    // This matters: the legacy label from the first deployment must NOT be placed on the map.
    expect(decodeGeohash("a9c-46")).toBeNull();
    expect(decodeGeohash("")).toBeNull();
    expect(decodeGeohash("0xdeadbeef")).toBeNull();
    expect(decodeGeohash("South Campus")).toBeNull();
    // a, i, l and o are excluded from the geohash alphabet.
    expect(decodeGeohash("aaaaaa")).toBeNull();
    expect(decodeGeohash("iiiiii")).toBeNull();
  });
});

describe("isGeohash", () => {
  it("accepts real geohashes and rejects impostors", () => {
    expect(isGeohash("qqguv")).toBe(true);
    expect(isGeohash("u4pruydqqvj")).toBe(true);
    expect(isGeohash("a9c-46")).toBe(false);
    expect(isGeohash("zone-7")).toBe(false);
    expect(isGeohash("x".repeat(13))).toBe(false);
  });
});

describe("privacy guarantee", () => {
  it("keeps the default cell coarse enough to be honest about location", () => {
    const size = geohashCellSize(encodeGeohash(-6.2088, 106.8456, AREA_PRECISION))!;
    // A cell a person could be anywhere inside. Roughly 1.2 km x 0.6 km at the equator.
    expect(size.widthM).toBeGreaterThan(500);
    expect(size.heightM).toBeGreaterThan(300);
    expect(size.widthM).toBeLessThan(2_000);
  });

  it("gets coarser, never finer, as precision drops", () => {
    const p6 = geohashCellSize(encodeGeohash(-6.2088, 106.8456, 6))!;
    const p5 = geohashCellSize(encodeGeohash(-6.2088, 106.8456, 5))!;
    expect(p5.widthM).toBeGreaterThan(p6.widthM);
    expect(p5.heightM).toBeGreaterThan(p6.heightM);
  });
});
