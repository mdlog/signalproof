/**
 * Buyer API v1 — the read-only HTTP surface over `areas.ts`.
 *
 *   GET /v1/areas                 every measured cell, most samples first
 *   GET /v1/areas/:area           one cell with every sample and its provenance
 *   GET /v1/areas/:area/brief     the same, as a markdown brief a buyer can forward
 *
 * Plain JSON on plain paths so an operator's analyst can curl it. No authentication and no
 * retention policy yet; the README lists both as not built.
 */

import type { Express, Request, Response } from "express";
import { areaView, buildAreaBrief, listAreas } from "./areas";
import { getOnchainSnapshot } from "./chainRead";

/** Area labels are geohashes, or the short legacy labels from the first registry. */
const AREA_LABEL = /^[a-z0-9-]{1,32}$/;

function areaParam(req: Request, res: Response): string | null {
  const area = String(req.params.area ?? "").toLowerCase();
  if (!AREA_LABEL.test(area)) {
    res.status(400).json({ error: "INVALID_AREA", detail: "expected a geohash such as qqguw6" });
    return null;
  }
  return area;
}

export function registerBuyerApi(app: Express): void {
  app.get("/v1/areas", async (_req, res) => {
    const snapshot = await getOnchainSnapshot();
    res.set("Cache-Control", "public, max-age=15");
    res.json({
      generatedAt: new Date().toISOString(),
      configured: snapshot.configured,
      error: snapshot.error,
      provenance: {
        registry: snapshot.registryAddress,
        settlement: snapshot.settlementAddress,
        batchSettlement: snapshot.batchSettlementAddress,
        sepoliaChainId: snapshot.sepoliaChainId,
        creditcoinChainId: snapshot.creditcoinChainId,
      },
      areas: listAreas(snapshot),
    });
  });

  app.get("/v1/areas/:area", async (req, res) => {
    const area = areaParam(req, res);
    if (!area) return;
    const view = areaView(await getOnchainSnapshot(), area);
    if (!view) {
      res.status(404).json({ error: "AREA_NOT_FOUND", area });
      return;
    }
    res.set("Cache-Control", "public, max-age=15");
    res.json({ generatedAt: new Date().toISOString(), ...view });
  });

  app.get("/v1/areas/:area/brief", async (req, res) => {
    const area = areaParam(req, res);
    if (!area) return;
    const view = areaView(await getOnchainSnapshot(), area);
    if (!view) {
      res.status(404).json({ error: "AREA_NOT_FOUND", area });
      return;
    }
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=15" });
    res.send(buildAreaBrief(view, new Date()));
  });
}
