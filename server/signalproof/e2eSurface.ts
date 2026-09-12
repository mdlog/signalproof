/**
 * End-to-end check of the product surface against a running server and the live chains.
 *
 *   pnpm e2e:surface                       # pays for a key from the CC3 relayer wallet (0.05 CTC)
 *   E2E_ACCESS_TX=0x… pnpm e2e:surface     # redeems an existing payment instead of paying again
 *   E2E_BASE=https://host pnpm e2e:surface # against a deployment (default http://localhost:3011)
 *
 * What it proves, in order: the terms endpoint; the gate refuses a bare call and a forged key;
 * a real payment into the reward pool redeems a key and the same payment redeems the same key;
 * the key opens every metered endpoint (area, brief, CSV, JSON) and the free ones stay free
 * (catalog, verifier, badge); the verifier resolves all three hashes of a settled measurement
 * and reports malformed and unknown inputs distinctly; the leaderboard, a profile, an area with
 * its trend, and the ops status all answer. Every line prints PASS or FAIL; the process exits
 * non-zero on any FAIL so it can gate a deploy.
 */

import "dotenv/config";
import { JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { ENV } from "../_core/env";
import { buildAccessSigningMessage } from "./access";

const BASE = process.env.E2E_BASE ?? "http://localhost:3011";
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function trpc<T>(procedure: string, input?: unknown): Promise<T> {
  const url = `${BASE}/api/trpc/${procedure}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`;
  const res = await fetch(url);
  expect(res.ok, `${procedure} answered ${res.status}`);
  const body = (await res.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

async function main(): Promise<void> {
  console.log(`SignalProof product-surface E2E against ${BASE}\n`);

  // ---- 1. Terms and the gate --------------------------------------------------------------
  console.log("[1] Access terms and the gate");
  const terms = (await (await fetch(`${BASE}/v1/access`)).json()) as { enabled: boolean; priceWei: string; payTo: string; days: number; price: string };
  await check("GET /v1/access states price, term and recipient", async () => {
    expect(terms.priceWei && terms.payTo && terms.days > 0, "terms incomplete");
    return `${terms.price} · ${terms.days} days · pay to ${terms.payTo} · enabled=${terms.enabled}`;
  });
  if (!terms.enabled) {
    console.log("\nAccess is not enabled on this server (no BUYER_ACCESS_SECRET / JWT_SECRET). The gate is open by design; the metered checks below cannot run.");
  }

  await check("GET /v1/areas (catalog) is free", async () => {
    const res = await fetch(`${BASE}/v1/areas`);
    expect(res.status === 200, `status ${res.status}`);
    const body = (await res.json()) as { areas: Array<{ areaHash: string; sampleCount: number }> };
    expect(Array.isArray(body.areas), "no areas array");
    return `${body.areas.length} area(s), top ${body.areas[0]?.areaHash ?? "—"} with ${body.areas[0]?.sampleCount ?? 0} samples`;
  });

  const catalog = (await (await fetch(`${BASE}/v1/areas`)).json()) as { areas: Array<{ areaHash: string }> };
  const area = catalog.areas[0]?.areaHash;
  expect(area, "the catalog is empty — nothing to test the metered endpoints against");

  if (terms.enabled) {
    await check("GET /v1/areas/:area without a key → 401 with the terms", async () => {
      const res = await fetch(`${BASE}/v1/areas/${area}`);
      expect(res.status === 401, `status ${res.status}`);
      const body = (await res.json()) as { error: string; howTo: string; price: string };
      expect(body.error === "ACCESS_REQUIRED" && body.howTo.includes("/v1/access/redeem"), "401 body lacks the terms");
      return `${body.error} · ${body.price}`;
    });
    await check("GET /v1/areas/:area with a forged key → 401", async () => {
      const res = await fetch(`${BASE}/v1/areas/${area}`, { headers: { Authorization: `Bearer sp1_1900000000_0x${"ab".repeat(32)}_${"00".repeat(16)}` } });
      expect(res.status === 401, `status ${res.status}`);
      return `refused: ${((await res.json()) as { detail: string }).detail}`;
    });
  }

  // ---- 2. A real payment into the pool ----------------------------------------------------
  console.log("\n[2] Payment into the reward pool and redemption");
  expect(ENV.creditcoinRpcUrl, "CREDITCOIN_RPC_URL is required");
  const provider = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
  const buyerKey = process.env.BUYER_PRIVATE_KEY ?? ENV.creditcoinRelayerPrivateKey;
  expect(buyerKey, "BUYER_PRIVATE_KEY or CREDITCOIN_RELAYER_PRIVATE_KEY is required to pay");
  const buyer = new Wallet(buyerKey, provider);
  let key = "";

  if (terms.enabled) {
    let txHash = process.env.E2E_ACCESS_TX ?? "";
    if (!txHash) {
      await check("Send the price to SignalProofSettlement.receive()", async () => {
        const before = await provider.getBalance(terms.payTo);
        const tx = await buyer.sendTransaction({ to: terms.payTo, value: BigInt(terms.priceWei) });
        const receipt = await tx.wait();
        expect(receipt?.status === 1, "payment reverted");
        const after = await provider.getBalance(terms.payTo);
        expect(after - before === BigInt(terms.priceWei), `pool moved by ${formatEther(after - before)} CTC, expected ${formatEther(BigInt(terms.priceWei))}`);
        txHash = tx.hash;
        return `${tx.hash} · block ${receipt?.blockNumber} · pool ${formatEther(before)} → ${formatEther(after)} CTC`;
      });
    }
    expect(txHash, "no payment transaction to redeem");

    const redeem = async (address: string, signature: string) =>
      fetch(`${BASE}/v1/access/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash, address, signature }) });

    await check("Redeem with the payer's signature → key", async () => {
      const signature = await buyer.signMessage(buildAccessSigningMessage(txHash, buyer.address));
      const res = await redeem(buyer.address, signature);
      if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { key: string; expiresAt: string };
      expect(body.key.startsWith("sp1_"), "no key");
      key = body.key;
      return `expires ${body.expiresAt}`;
    });
    await check("Redeeming the same payment again yields the same key (deterministic, no replay)", async () => {
      const signature = await buyer.signMessage(buildAccessSigningMessage(txHash, buyer.address));
      const body = (await (await redeem(buyer.address, signature)).json()) as { key: string };
      expect(body.key === key, "keys differ");
    });
    await check("A stranger cannot redeem someone else's payment → 402 SIGNER_MISMATCH", async () => {
      const stranger = Wallet.createRandom();
      const signature = await stranger.signMessage(buildAccessSigningMessage(txHash, stranger.address));
      const res = await redeem(stranger.address, signature);
      expect(res.status === 402, `status ${res.status}`);
      const body = (await res.json()) as { error: string };
      expect(body.error === "SIGNER_MISMATCH", body.error);
    });
    await check("An unknown transaction → 402 TX_NOT_FOUND", async () => {
      const fake = "0x" + "ee".repeat(32);
      const signature = await buyer.signMessage(buildAccessSigningMessage(fake, buyer.address));
      const res = await fetch(`${BASE}/v1/access/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash: fake, address: buyer.address, signature }) });
      expect(res.status === 402, `status ${res.status}`);
      expect(((await res.json()) as { error: string }).error === "TX_NOT_FOUND", "wrong code");
    });
    await check("Malformed redeem body → 400", async () => {
      const res = await fetch(`${BASE}/v1/access/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash: "nope" }) });
      expect(res.status === 400, `status ${res.status}`);
    });
  }

  // ---- 3. Metered endpoints with the key, free ones without ---------------------------------
  console.log("\n[3] Metered and free endpoints");
  const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  let sample: { measurementRoot: string; sourceTxHash: string | null; creditcoinTxHash: string | null; verifyUrl: string } | undefined;

  await check("GET /v1/areas/:area with the key → 200, samples carry verifyUrl", async () => {
    const res = await fetch(`${BASE}/v1/areas/${area}`, { headers: auth });
    expect(res.status === 200, `status ${res.status}`);
    const body = (await res.json()) as { samples: typeof sample[]; quality: number };
    expect(body.samples.length > 0, "no samples");
    sample = body.samples.find((s) => s?.creditcoinTxHash) ?? body.samples[0];
    expect(sample?.verifyUrl?.startsWith("/verify/0x"), "verifyUrl missing");
    expect(!JSON.stringify(body).match(/"(signature|nonce|sessionHash)"/), "session-binding field leaked");
    return `quality ${body.quality} · ${body.samples.length} samples · ${res.headers.get("x-signalproof-access-expires") ? "expiry header present" : "no expiry header"}`;
  });
  await check("GET /v1/areas/:area/brief with the key → markdown", async () => {
    const res = await fetch(`${BASE}/v1/areas/${area}/brief`, { headers: auth });
    expect(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    expect(text.startsWith(`# Area brief — ${area}`), "not the brief");
    return `${text.length} chars`;
  });
  await check("GET /v1/areas/:area/export.csv with the key → CSV with the documented header", async () => {
    const res = await fetch(`${BASE}/v1/areas/${area}/export.csv`, { headers: auth });
    expect(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    const [header, ...rows] = text.split("\r\n").filter(Boolean);
    expect(header === "measurementRoot,status,contributor,timestamp,latencyMs,downloadMbps,quality,sourceTxHash,creditcoinTxHash,rewardWei", `header: ${header}`);
    expect(res.headers.get("content-disposition")?.includes(`signalproof-${area}.csv`), "no attachment filename");
    return `${rows.length} rows`;
  });
  await check("GET /v1/areas/:area/export.json with the key → JSON", async () => {
    const res = await fetch(`${BASE}/v1/areas/${area}/export.json`, { headers: auth });
    expect(res.status === 200, `status ${res.status}`);
    const body = (await res.json()) as { area: string; samples: unknown[]; generatedAt: string };
    expect(body.area === area && Array.isArray(body.samples), "shape");
    return `${body.samples.length} samples · generated ${body.generatedAt}`;
  });
  if (terms.enabled) {
    await check("export.csv without a key → 401", async () => {
      const res = await fetch(`${BASE}/v1/areas/${area}/export.csv`);
      expect(res.status === 401, `status ${res.status}`);
    });
  }
  await check("GET /v1/areas/:area/badge.svg is free and names the area", async () => {
    const res = await fetch(`${BASE}/v1/areas/${area}/badge.svg`);
    expect(res.status === 200, `status ${res.status}`);
    expect(res.headers.get("content-type")?.includes("image/svg+xml"), "not svg");
    const svg = await res.text();
    expect(svg.includes(area) && svg.includes("verified on Creditcoin"), "badge text");
    return svg.match(/quality \d+ · \d+ samples/)?.[0] ?? "no data";
  });
  await check("badge.svg for an unmeasured area → grey no-data badge, 200", async () => {
    const res = await fetch(`${BASE}/v1/areas/zzzzzz/badge.svg`);
    expect(res.status === 200 && (await res.text()).includes("no data"), "not the no-data badge");
  });

  // ---- 4. Verifier ---------------------------------------------------------------------------
  console.log("\n[4] Verifier");
  expect(sample, "no sample to verify");
  for (const [label, hash, by] of [
    ["measurement root", sample.measurementRoot, "measurementRoot"],
    ["Sepolia tx", sample.sourceTxHash, "sourceTxHash"],
    ["Creditcoin tx", sample.creditcoinTxHash, "creditcoinTxHash"],
  ] as const) {
    if (!hash) continue;
    await check(`GET /v1/verify/<${label}> resolves, matchedBy ${by}`, async () => {
      const res = await fetch(`${BASE}/v1/verify/${hash}`);
      expect(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as { found: boolean; matchedBy: string; measurement: { status: string }; proof?: { ok: boolean } };
      expect(body.found && body.matchedBy === by, `matchedBy ${body.matchedBy}`);
      return `${body.measurement.status}${body.proof ? ` · proof ${body.proof.ok ? "fetched" : "not yet"}` : ""}`;
    });
  }
  await check("Verifier is case-insensitive and accepts a missing 0x", async () => {
    const res = await fetch(`${BASE}/v1/verify/${sample!.measurementRoot.slice(2).toUpperCase()}`);
    expect(res.status === 200 && ((await res.json()) as { found: boolean }).found, "not found");
  });
  await check("Unknown hash → 404 NOT_IN_SCANNED_WINDOW", async () => {
    const res = await fetch(`${BASE}/v1/verify/0x${"cd".repeat(32)}`);
    expect(res.status === 404, `status ${res.status}`);
    expect(((await res.json()) as { reason: string }).reason === "NOT_IN_SCANNED_WINDOW", "wrong reason");
  });
  await check("Malformed hash → 400 MALFORMED", async () => {
    const res = await fetch(`${BASE}/v1/verify/hello`);
    expect(res.status === 400, `status ${res.status}`);
  });
  await check("tRPC signalproof.verify returns attestation/proof alongside", async () => {
    const body = await trpc<{ found: boolean; proof?: { ok: boolean } }>("signalproof.verify", { hash: sample!.measurementRoot });
    expect(body.found, "not found via tRPC");
    return body.proof ? `proof ${body.proof.ok ? "ok" : "pending"}` : "no source tx";
  });

  // ---- 5. Contributors, area, ops -----------------------------------------------------------
  console.log("\n[5] Contributors, area page data, ops");
  let topAddress = "";
  await check("tRPC signalproof.contributors ranks addresses", async () => {
    const rows = await trpc<Array<{ rank: number; address: string; settled: number; areas: string[]; rewardAccruedWei: string }>>("signalproof.contributors");
    expect(rows.length > 0 && rows[0].rank === 1, "no rows");
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].settled >= rows[i].settled, "not sorted by settled");
    topAddress = rows[0].address;
    return `${rows.length} contributor(s) · #1 ${rows[0].address} with ${rows[0].settled} settled, ${formatEther(BigInt(rows[0].rewardAccruedWei))} CTC accrued`;
  });
  await check("tRPC signalproof.contributorStats for the top address", async () => {
    const s = await trpc<{ totals: { submitted: number; settled: number; earnedWei: string; claimedWei: string; unclaimedWei: string }; claims: unknown[]; error: string | null }>("signalproof.contributorStats", { address: topAddress });
    expect(!s.error, s.error ?? "");
    expect(BigInt(s.totals.earnedWei) >= BigInt(s.totals.claimedWei) + BigInt(s.totals.unclaimedWei) - 1n, "earned < claimed + unclaimed");
    return `submitted ${s.totals.submitted} · settled ${s.totals.settled} · earned ${formatEther(BigInt(s.totals.earnedWei))} · claimed ${formatEther(BigInt(s.totals.claimedWei))} · ${s.claims.length} claim(s)`;
  });
  await check("tRPC signalproof.rewardsFor for the top address", async () => {
    const r = await trpc<{ wei: string; claimable: boolean; routes: Array<{ label: string; wei: string }> }>("signalproof.rewardsFor", { address: topAddress });
    return `${formatEther(BigInt(r.wei))} CTC across ${r.routes.length} route(s) · claimable=${r.claimable}`;
  });
  await check("tRPC signalproof.area returns the view with a time-ordered trend", async () => {
    const v = await trpc<{ trend: Array<{ t: number; quality: number }>; samples: unknown[]; cell: unknown } | null>("signalproof.area", { areaHash: area });
    expect(v, "null view");
    for (let i = 1; i < v.trend.length; i++) expect(v.trend[i - 1].t <= v.trend[i].t, "trend not ascending");
    return `${v.samples.length} samples · ${v.trend.length} trend points · cell ${v.cell ? "mapped" : "unmapped"}`;
  });
  await check("tRPC signalproof.ops answers with balances, runway, worker and RPC health", async () => {
    const o = await trpc<{ relayer: { sepolia: { balanceWei: string | null; error: string | null }; creditcoin: { balanceWei: string | null; error: string | null } }; pool: { runway: number | null; balanceWei: string }; worker: { running: boolean; lastTickAt: number | null }; snapshot: { lastSuccessAt: number | null; emptyResultsRejected: number }; attestation: { lag: number; error: string | null } }>("signalproof.ops");
    expect(o.pool.runway == null || o.pool.runway >= 0, "runway");
    return `sepolia ${o.relayer.sepolia.balanceWei ? formatEther(BigInt(o.relayer.sepolia.balanceWei)).slice(0, 6) + " ETH" : o.relayer.sepolia.error} · cc3 ${o.relayer.creditcoin.balanceWei ? formatEther(BigInt(o.relayer.creditcoin.balanceWei)).slice(0, 6) + " CTC" : o.relayer.creditcoin.error} · pool ${formatEther(BigInt(o.pool.balanceWei))} CTC = ${o.pool.runway} settlements · worker ${o.worker.running ? "running" : "stopped"}${o.worker.lastTickAt ? ` (tick ${Math.round((Date.now() - o.worker.lastTickAt) / 1000)}s ago)` : ""} · refused reads ${o.snapshot.emptyResultsRejected} · attestation lag ${o.attestation.error ?? o.attestation.lag}`;
  });

  // ---- Summary -------------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error("\nE2E aborted:", error instanceof Error ? error.message : error);
  process.exit(1);
});
