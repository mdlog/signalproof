/**
 * Coverage map — real tiles, real coordinates.
 *
 * Every marker is placed by decoding the measurement's `areaHash`, which is a geohash. Nothing here
 * invents a position: an area whose hash is not a geohash cannot be mapped, and is reported as
 * unmapped rather than dropped onto an arbitrary pixel. That distinction is the whole point — a
 * decorative map that looks precise would be worse than no map at all.
 *
 * The shaded rectangle is the geohash cell itself, so the map shows the actual resolution of the
 * data: a contributor is somewhere inside that box, never at the dot.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodeGeohash, decodeGeohashBounds, geohashCellSize, isGeohash } from "@shared/geohash";

export type CoverageZone = {
  name: string;
  code: string;
  quality: number;
  samples: number;
  status: string;
  color: string;
};

type Props = {
  zones: CoverageZone[];
  isLive: boolean;
  onZoneClick: (name: string) => void;
};

/** Zones split by whether their areaHash carries a decodable location. */
function partition(zones: CoverageZone[]) {
  const mapped: Array<CoverageZone & { lat: number; lon: number }> = [];
  const unmapped: CoverageZone[] = [];
  for (const z of zones) {
    const point = isGeohash(z.code) ? decodeGeohash(z.code) : null;
    if (point) mapped.push({ ...z, lat: point.lat, lon: point.lon });
    else unmapped.push(z);
  }
  return { mapped, unmapped };
}

export default function CoverageMap({ zones, isLive, onZoneClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const { mapped, unmapped } = useMemo(() => partition(zones), [zones]);

  // Create the map once. Leaflet owns this DOM node; React must not re-render into it.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // a dashboard panel should not hijack page scrolling
      worldCopyJump: true,
    }).setView([-6.2088, 106.8456], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw markers whenever the zone list changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    if (mapped.length === 0) return;

    const bounds = L.latLngBounds([]);

    for (const zone of mapped) {
      const cell = decodeGeohashBounds(zone.code);
      if (cell) {
        // The cell rectangle is the honest footprint of the data.
        L.rectangle(
          [
            [cell.minLat, cell.minLon],
            [cell.maxLat, cell.maxLon],
          ],
          { color: zone.color, weight: 1.5, fillColor: zone.color, fillOpacity: 0.14 },
        ).addTo(layer);
        bounds.extend([cell.minLat, cell.minLon]);
        bounds.extend([cell.maxLat, cell.maxLon]);
      }

      const size = geohashCellSize(zone.code);
      const marker = L.marker([zone.lat, zone.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;border:4px solid #fff;background:${zone.color};color:#fff;font:700 11px/1 'IBM Plex Mono',monospace;box-shadow:0 4px 14px rgba(16,42,67,.28)">${zone.quality}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        keyboard: true,
        title: zone.name,
      }).addTo(layer);

      marker.bindPopup(
        `<div style="font:600 13px/1.4 'Source Sans 3',sans-serif;color:#102A43">
           <div style="font-weight:700">${zone.name}</div>
           <div style="font:500 10px/1.6 'IBM Plex Mono',monospace;color:#6C8291;text-transform:uppercase;letter-spacing:.08em">geohash ${zone.code}</div>
           <div style="margin-top:6px">Quality <b>${zone.quality}</b> · ${zone.samples} sample${zone.samples === 1 ? "" : "s"}</div>
           ${size ? `<div style="color:#6C8291;font-size:11px">Cell ≈ ${size.widthM} m × ${size.heightM} m</div>` : ""}
         </div>`,
      );
      marker.on("click", () => onZoneClick(zone.name));
      bounds.extend([zone.lat, zone.lon]);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    }
  }, [mapped, onZoneClick]);

  return (
    <div className="relative isolate z-0 h-[380px] overflow-hidden rounded-[16px] border border-[#DCE5EB]">
      <div ref={containerRef} className="absolute inset-0 z-0" aria-label="Coverage map" />

      {/* Panel chrome sits above the tiles. z-[400] clears Leaflet's own pane stack. */}
      <div className="pointer-events-none absolute right-5 top-5 z-[400] flex items-center gap-2 rounded-md border border-white/80 bg-white/90 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#426176] shadow-sm backdrop-blur">
        {isLive ? "On-chain areas" : "Prototype areas"}
        <span className="text-[#A0AFBB]">/</span>
        {mapped.length} mapped
        {unmapped.length > 0 && <span className="text-[#B44A3C]">· {unmapped.length} unmapped</span>}
      </div>

      <div className="pointer-events-none absolute bottom-5 left-5 z-[400] flex flex-wrap gap-3 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] text-[#5F7585] shadow-sm backdrop-blur">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#31B7A6]" />Strong</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#F4B95E]" />Watch</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#F06A59]" />Attention</span>
        <span className="text-[#8EA0AC]">shaded box = geohash cell</span>
      </div>

      {mapped.length === 0 && (
        <div className="absolute inset-0 z-[400] flex items-center justify-center bg-white/85 backdrop-blur-sm">
          <div className="max-w-sm px-6 text-center">
            <div className="font-display text-sm font-bold text-[#102A43]">No mappable areas yet</div>
            <p className="mt-2 text-xs leading-relaxed text-[#73879A]">
              {unmapped.length > 0
                ? `${unmapped.length} area${unmapped.length === 1 ? " uses" : "s use"} a non-geohash identifier (${unmapped
                    .map((z) => z.code)
                    .slice(0, 3)
                    .join(", ")}), so it cannot be placed on a map. Newer measurements carry a geohash areaHash.`
                : "Submit a measurement with a geohash areaHash and its cell will appear here."}
            </p>
          </div>
        </div>
      )}

      {mapped.length > 0 && unmapped.length > 0 && (
        <div className="absolute bottom-5 right-5 z-[400] max-w-[240px] rounded-lg border border-[#F06A59]/25 bg-[#FFF8F6] px-3 py-2 text-[10px] leading-relaxed text-[#B44A3C] shadow-sm">
          <b>{unmapped.length} area{unmapped.length === 1 ? "" : "s"} not shown</b> — the areaHash is
          not a geohash, so there is no honest position for it.
        </div>
      )}
    </div>
  );
}
