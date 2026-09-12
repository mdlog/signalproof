/**
 * Buyer API v1 — the HTTP surface over `areas.ts`.
 *
 *   GET  /v1/areas                 every measured cell, most samples first          free
 *   GET  /v1/access                price, term, and how to buy a key                free
 *   POST /v1/access/redeem         { txHash, address, signature } -> key            free
 *   GET  /v1/areas/:area           one cell with every sample and its provenance    key
 *   GET  /v1/areas/:area/brief     the same, as a markdown brief a buyer can forward key
 *
 * Plain JSON on plain paths so an operator's analyst can curl it. The metered endpoints are the
 * service — aggregation, the provenance join, the brief — not the data, which is public on two
 * chains and free on the dashboard. With no `BUYER_ACCESS_SECRET`/`JWT_SECRET` the gate is open.
 */

import type { Express, Request, Response } from "express";
import { JsonRpcProvider } from "ethers";
import { z } from "zod";
import { ENV } from "../_core/env";
import { accessConfig, issueKey, requireAccess, verifyPurchase } from "./access";
import { areaView, buildAreaBrief, listAreas } from "./areas";
import { getOnchainSnapshot } from "./chainRead";

const redeemInput = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

function accessSecret(): string {
  return ENV.buyerAccessSecret || ENV.cookieSecret;
}

function registerAccessRoutes(app: Express): void {
  app.get("/v1/access", (_req, res) => {
    const cfg = accessConfig();
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      enabled: cfg.enabled,
      price: `${cfg.priceCtc} CTC`,
      priceWei: cfg.priceWei.toString(),
      days: cfg.days,
      payTo: cfg.settlement,
      chainId: 102031,
      whatItFunds: "The payment lands in SignalProofSettlement's reward pool — the balance contributors claim() from.",
      signMessage: "SignalProof API access\nTransaction: <txHash>\nAddress: <address>",
      redeem: "POST /v1/access/redeem { txHash, address, signature }",
      gated: ["/v1/areas/:area", "/v1/areas/:area/brief", "/v1/areas/:area/export.csv", "/v1/areas/:area/export.json"],
      free: ["/v1/areas", "/v1/verify/:hash", "/v1/areas/:area/badge.svg"],
    });
  });

  app.post("/v1/access/redeem", async (req, res) => {
    const cfg = accessConfig();
    if (!cfg.enabled) {
      res.status(409).json({ error: "ACCESS_NOT_CONFIGURED", detail: "This deployment does not meter the API; every endpoint is open." });
      return;
    }
    const parsed = redeemInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_INPUT", detail: "expected { txHash, address, signature }" });
      return;
    }
    if (!ENV.creditcoinRpcUrl) {
      res.status(503).json({ error: "CHAIN_NOT_CONFIGURED" });
      return;
    }
    try {
      const provider = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
      const verdict = await verifyPurchase(provider, {
        ...parsed.data,
        settlement: cfg.settlement,
        priceWei: cfg.priceWei,
        days: cfg.days,
      });
      if (!verdict.ok) {
        res.status(402).json({ error: verdict.code, price: `${cfg.priceCtc} CTC`, payTo: cfg.settlement });
        return;
      }
      const key = issueKey(parsed.data.txHash, verdict.expiryUnix, accessSecret());
      const host = `${req.protocol}://${req.get("host")}`;
      res.set("Cache-Control", "no-store");
      res.json({
        key,
        expiresAt: new Date(verdict.expiryUnix * 1000).toISOString(),
        txHash: parsed.data.txHash.toLowerCase(),
        paidWei: verdict.valueWei.toString(),
        curl: `curl -H 'Authorization: Bearer ${key}' ${host}/v1/areas/<geohash>`,
      });
    } catch (error) {
      res.status(502).json({ error: "RPC_ERROR", detail: (error instanceof Error ? error.message : String(error)).slice(0, 160) });
    }
  });
}

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
  registerAccessRoutes(app);

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

  app.get("/v1/areas/:area", requireAccess(), async (req, res) => {
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

  app.get("/v1/areas/:area/brief", requireAccess(), async (req, res) => {
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
