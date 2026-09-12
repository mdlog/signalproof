# Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six product-surface items in the spec — paid buyer access that funds the reward pool, a public verifier, an area page with export and badge, a contributors leaderboard, an ops panel, and auto-measure — without touching the contracts or the measurement code.

**Architecture:** Every server addition is a pure, unit-tested module under `server/signalproof/` that reads the existing `getOnchainSnapshot()`; Express routes (`/v1/*`) and tRPC procedures wire them in. The client gains a shared `AppShell` (sidebar/header/wallet) and one page component per route via `wouter`; `Home.tsx` keeps its four modes and only loses the chrome it no longer owns. Buyer keys are stateless HMAC tokens derived from the CC3 payment transaction.

**Tech Stack:** TypeScript, ethers v6, tRPC 11, Express 4, zod 4, React 19 + Vite, `wouter` 3, `recharts` 2, vitest 2, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-12-product-surface-design.md`

## Global Constraints

- Commits: plain messages, no AI attribution trailers (user rule). Author email `17427126+mdlog@users.noreply.github.com` (repo-local config, already set).
- Every production change lands with a failing test first. `pnpm check && pnpm test && pnpm build` green before each commit; `forge test` is untouched (no contract changes).
- Contracts, `server/signalproof/proofWorker.ts` relay/settle logic, `client/src/lib/measure.ts`, and `shared/measurement.ts` are not modified except: `proofWorker.ts` gains a `workerHealth` record (Task 6), nothing else.
- Public API never returns `signature`, `nonce`, `sessionHash`.
- Nothing rendered that the chain does not say; a keyless clone still works (gate open, purchase card hidden).
- Key format: `sp1_<expiryUnix>_<txHash>_<hmac16hex>`; HMAC-SHA256 over `${txHash}|${expiryUnix}` with `BUYER_ACCESS_SECRET` (fallback `JWT_SECRET`).
- Env: `BUYER_ACCESS_PRICE_CTC=0.05`, `BUYER_ACCESS_DAYS=30`, `BUYER_ACCESS_SECRET`.
- Gated: `GET /v1/areas/:area`, `/brief`, `/export.csv`, `/export.json`. Free: `/v1/areas`, `/v1/access`, `POST /v1/access/redeem`, `/v1/verify/:hash`, `/v1/areas/:area/badge.svg`.
- Code freeze 2026-09-13 15:59 UTC.

---

### Task 0: Shared shell and real routes

**Files:**
- Create: `client/src/contexts/WalletContext.tsx`
- Create: `client/src/components/AppShell.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/Home.tsx` (sidebar `<aside>` lines 714–722 and `<header>` line 725 move into the shell; `useWallet()` call at line 367 becomes `useWalletContext()`)
- Modify: `client/src/components/WalletControl.tsx`, `client/src/components/ClaimReward.tsx` (prop type only — `WalletApi`)

**Interfaces:**
- Produces: `WalletProvider` + `useWalletContext(): WalletApi` where `type WalletApi = ReturnType<typeof useWallet>`.
- Produces: `AppShell` (props in Step 2). Home's four modes stay internal to Home: the shell receives `nav`/`activeId`/`onSelect`, so on `/` the four items are buttons that switch mode exactly as today, while route pages pass `href` items and the shell renders `wouter` links.

- [ ] **Step 1: Wallet context**

```tsx
// client/src/contexts/WalletContext.tsx
import { createContext, useContext, type ReactNode } from "react";
import { useWallet } from "@/hooks/useWallet";

export type WalletApi = ReturnType<typeof useWallet>;
const Ctx = createContext<WalletApi | null>(null);

/** One wallet connection for the whole app: the shell, Home and every route page share it. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  return <Ctx.Provider value={wallet}>{children}</Ctx.Provider>;
}

export function useWalletContext(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWalletContext must be used inside <WalletProvider>");
  return v;
}
```

- [ ] **Step 2: AppShell** — move the `<aside>` and `<header>` JSX out of `Home.tsx` verbatim. Props:

```tsx
export type ShellNavItem = { id: string; label: string; icon: LucideIcon; href?: string; count?: number };
type Props = {
  title: string;                      // header line, e.g. "Coverage overview"
  nav: ShellNavItem[];                // workspace items
  activeId: string;
  onSelect: (id: string) => void;     // Home switches mode; route pages navigate
  live: { isLoading: boolean; isLive: boolean; contributors: number; settled: number } | null;
  integration: RouterOutputs["signalproof"]["integrationStatus"] | undefined;
  children: ReactNode;
};
```
Inside: `const wallet = useWalletContext();` for `<WalletControl>` and `<WrongChainBanner>`. Items with `href` render `<Link href>` from `wouter`; others render the existing button. Add the three route items after Home's four: `{ id: "verify", label: "Verify a proof", icon: Search, href: "/verify" }`, `{ id: "contributors", label: "Contributors", icon: Users, href: "/contributors" }`, `{ id: "ops", label: "Operations", icon: Activity, href: "/ops" }`. Route pages pass the same `nav` (exported `SHELL_NAV` constant from `AppShell.tsx` with Home's four items carrying `href: "/"`), so the sidebar is identical everywhere.

- [ ] **Step 3: Routes** in `App.tsx`:

```tsx
<WalletProvider>
  <Switch>
    <Route path="/" component={Home} />
    <Route path="/verify" component={VerifyPage} />
    <Route path="/verify/:hash" component={VerifyPage} />
    <Route path="/area/:geohash" component={AreaPage} />
    <Route path="/contributors" component={ContributorsPage} />
    <Route path="/contributors/:address" component={ContributorPage} />
    <Route path="/ops" component={OpsPage} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>
</WalletProvider>
```
Pages are created as stubs in this task (`export default function VerifyPage() { return <AppShell …><div>…</div></AppShell>; }`) and filled in by their tasks.

- [ ] **Step 4: Verify** — `pnpm check && pnpm build`; open `/` in the dev server and confirm the four modes, wallet control, proof inspector and brief dialog behave as before. Commit: `Shared app shell, wallet context and route skeleton`.

---

### Task 1: Buyer access — stateless keys funded into the pool

**Files:**
- Create: `server/signalproof/access.ts`, `server/signalproof/access.test.ts`
- Modify: `server/_core/env.ts` (three keys), `server/signalproof/buyerApi.ts` (gate + routes), `.env.example`
- Create: `client/src/components/BuyAccess.tsx`; Modify: `client/src/pages/Home.tsx` (api mode card + `openBrief` sends the key)

**Interfaces:**
- Produces (`access.ts`):
  - `accessConfig(): { enabled: boolean; priceWei: bigint; priceCtc: string; days: number; settlement: string }`
  - `issueKey(txHash: string, expiryUnix: number, secret: string): string`
  - `verifyKey(key: string, secret: string, nowUnix: number): { ok: true; txHash: string; expiryUnix: number } | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" }`
  - `buildAccessSigningMessage(txHash: string, address: string): string`
  - `verifyPurchase(provider: PurchaseProvider, args: { txHash; address; signature; settlement; priceWei; days }): Promise<{ ok: true; expiryUnix: number; from: string; valueWei: bigint } | { ok: false; code: "TX_NOT_FOUND" | "WRONG_RECIPIENT" | "UNDERPAID" | "TX_FAILED" | "SIGNER_MISMATCH" }>` where `type PurchaseProvider = { getTransaction(h): Promise<{ to: string|null; from: string; value: bigint; blockNumber: number|null } | null>; getTransactionReceipt(h): Promise<{ status: number|null } | null>; getBlock(n): Promise<{ timestamp: number } | null> }` — `ethers.JsonRpcProvider` satisfies it structurally.
  - `requireAccess(): express.RequestHandler` — reads `Authorization: Bearer`, 401 body `{ error: "ACCESS_REQUIRED", price: "0.05 CTC", days: 30, howTo: "POST /v1/access/redeem …", terms: "/v1/access" }`; open (calls `next()`) when `accessConfig().enabled === false`.

- [ ] **Step 1: Failing tests** (`access.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { buildAccessSigningMessage, issueKey, verifyKey, verifyPurchase } from "./access";

const SECRET = "test-secret";
const TX = "0x" + "ab".repeat(32);

describe("access keys", () => {
  it("round-trips a key", () => {
    const key = issueKey(TX, 1_800_000_000, SECRET);
    expect(key.startsWith("sp1_1800000000_" + TX + "_")).toBe(true);
    expect(verifyKey(key, SECRET, 1_799_999_999)).toEqual({ ok: true, txHash: TX, expiryUnix: 1_800_000_000 });
  });
  it("refuses a tampered expiry, a tampered hmac, an expired key and garbage", () => {
    const key = issueKey(TX, 1_800_000_000, SECRET);
    expect(verifyKey(key.replace("1800000000", "1900000000"), SECRET, 1)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyKey(key.slice(0, -1) + (key.endsWith("0") ? "1" : "0"), SECRET, 1)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyKey(key, SECRET, 1_800_000_001)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(verifyKey("sp1_x", SECRET, 1)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyKey(issueKey(TX, 1_800_000_000, "other"), SECRET, 1)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });
});

describe("verifyPurchase", () => {
  const buyer = Wallet.createRandom();
  const settlement = "0x8F14B2cC1b807203d332DE6E3DA6274176FDb584";
  const provider = (over: Partial<{ to: string | null; from: string; value: bigint; status: number | null }>) => ({
    getTransaction: async () => ({ to: settlement, from: buyer.address, value: 50_000_000_000_000_000n, blockNumber: 10, ...over }),
    getTransactionReceipt: async () => ({ status: over.status === undefined ? 1 : over.status }),
    getBlock: async () => ({ timestamp: 1_800_000_000 }),
  });
  const args = async (over = {}) => ({
    txHash: TX, address: buyer.address, settlement, priceWei: 50_000_000_000_000_000n, days: 30,
    signature: await buyer.signMessage(buildAccessSigningMessage(TX, buyer.address)), ...over,
  });
  it("accepts a paid, successful transfer signed by its sender", async () => {
    const r = await verifyPurchase(provider({}), await args());
    expect(r).toEqual({ ok: true, expiryUnix: 1_800_000_000 + 30 * 86_400, from: buyer.address, valueWei: 50_000_000_000_000_000n });
  });
  it("refuses wrong recipient, underpayment, failed tx, foreign signer, missing tx", async () => {
    expect((await verifyPurchase(provider({ to: buyer.address }), await args())).ok).toBe(false);
    expect(await verifyPurchase(provider({ value: 1n }), await args())).toEqual({ ok: false, code: "UNDERPAID" });
    expect(await verifyPurchase(provider({ status: 0 }), await args())).toEqual({ ok: false, code: "TX_FAILED" });
    const other = Wallet.createRandom();
    expect(await verifyPurchase(provider({}), await args({ address: other.address, signature: await other.signMessage(buildAccessSigningMessage(TX, other.address)) }))).toEqual({ ok: false, code: "SIGNER_MISMATCH" });
    expect(await verifyPurchase({ ...provider({}), getTransaction: async () => null }, await args())).toEqual({ ok: false, code: "TX_NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run server/signalproof/access.test.ts` → fails (module missing).

- [ ] **Step 3: Implement `access.ts`** — `createHmac("sha256")` from `node:crypto`, `timingSafeEqual` for the hmac compare, `verifyMessage` from ethers for signer recovery, `parseEther` for the price. `accessConfig()` reads `ENV.buyerAccessPriceCtc` (default `"0.05"`), `ENV.buyerAccessDays` (default `30`), secret = `ENV.buyerAccessSecret || ENV.cookieSecret`; `enabled = Boolean(secret && ENV.settlementContractAddress)`.

- [ ] **Step 4: Wire routes** in `buyerApi.ts`: `GET /v1/access` → `{ enabled, price: priceCtc + " CTC", priceWei, days, payTo: settlement, chainId: 102031, signMessage: "SignalProof API access\\nTransaction: <txHash>\\nAddress: <address>", redeem: "POST /v1/access/redeem { txHash, address, signature }" }`; `POST /v1/access/redeem` (express.json already global) → `verifyPurchase(new JsonRpcProvider(ENV.creditcoinRpcUrl,…), …)` → 200 `{ key, expiresAt: ISO, txHash, curl: "curl -H 'Authorization: Bearer <key>' https://<host>/v1/areas/<area>" }` or 402 `{ error: code }`; 400 on malformed input (zod: txHash `^0x[0-9a-f]{64}$`, address `^0x[0-9a-fA-F]{40}$`, signature `^0x[0-9a-f]{130}$`). Apply `requireAccess()` to the two existing gated routes.

- [ ] **Step 5: Client** — `BuyAccess.tsx`: reads `/v1/access` via `fetch`; if `enabled`, shows price/days and *Buy API access*; flow: `switchToCreditcoin` if needed → `provider.request eth_sendTransaction {from, to: payTo, value: hex(priceWei)}` (add `wallet.sendValue(to, valueWei)` to `useWallet.ts`, same shape as `sendSettlement`) → poll `/v1/access/redeem` every 5 s until not `TX_NOT_FOUND` (receipt lag) → on 200 store `localStorage.signalproof.accessKey` and show the key + curl. `Home.tsx` `openBrief` adds the header when a key exists and on 401 shows the body's `howTo`. Export `getStoredAccessKey()` from `client/src/lib/access.ts` for Task 5.

- [ ] **Step 6: Verify** `pnpm check && pnpm test && pnpm build`; `curl -s localhost:3010/v1/areas/qqguw6` → 401 JSON; with a key → 200. Commit: `Buyer access: CTC payment into the pool redeems a stateless API key`.

---

### Task 2: Public verifier

**Files:**
- Create: `server/signalproof/verify.ts`, `server/signalproof/verify.test.ts`
- Modify: `server/routers.ts` (procedure `verify`), `server/signalproof/buyerApi.ts` (`GET /v1/verify/:hash`), `server/signalproof/areas.ts` (`verifyUrl` on `AreaSample`)
- Create: `client/src/pages/VerifyPage.tsx`; Modify: `client/src/pages/Home.tsx` (proof-queue rows link to `/verify/<root>`)

**Interfaces:**
- Produces: `resolveVerification(snapshot: OnchainSnapshot, hash: string): VerificationResult` where
```ts
export type VerificationResult =
  | { found: true; matchedBy: "measurementRoot" | "sourceTxHash" | "creditcoinTxHash"; measurement: OnchainMeasurement;
      explorer: { source: string | null; settlement: string | null }; verifyUrl: string }
  | { found: false; reason: "MALFORMED" | "NOT_IN_SCANNED_WINDOW"; scannedFromBlock: OnchainSnapshot["scannedFromBlock"] };
```
- Produces: tRPC `signalproof.verify({ hash })` → `VerificationResult & { attestation?: AttestationProgress; proof?: ProofLookup }` (attestation only when awaiting; proof only when `sourceTxHash` exists).
- `verifyUrl` = `/verify/${measurementRoot}`.

- [ ] **Step 1: Tests** (`verify.test.ts`, reuse the `measurement()`/`snapshot()` builders copied from `areas.test.ts`):
```ts
it("matches by root, source tx and settlement tx, case-insensitively", () => {
  const m = measurement({});
  for (const [hash, by] of [[m.measurementRoot, "measurementRoot"], [m.sourceTxHash!.toUpperCase(), "sourceTxHash"], [m.creditcoinTxHash!, "creditcoinTxHash"]] as const) {
    const r = resolveVerification(snapshot([m]), hash);
    expect(r.found && r.matchedBy).toBe(by);
  }
});
it("reports not-in-window and malformed distinctly", () => {
  expect(resolveVerification(snapshot([]), "0x" + "cc".repeat(32))).toMatchObject({ found: false, reason: "NOT_IN_SCANNED_WINDOW" });
  expect(resolveVerification(snapshot([]), "hello")).toMatchObject({ found: false, reason: "MALFORMED" });
});
```
- [ ] **Step 2–3:** run (fails) → implement (`/^0x[0-9a-f]{64}$/i` guard; explorer URLs as in `areas.ts`).
- [ ] **Step 4:** router procedure: `verify: publicProcedure.input(z.object({ hash: z.string().min(1).max(128) })).query(async ({ input }) => { const r = resolveVerification(await getOnchainSnapshot(), input.hash); if (!r.found) return r; const m = r.measurement; const [attestation, proof] = await Promise.all([m.status === "AWAITING_ATTESTATION" && m.sourceBlockNumber ? getAttestationProgress(m.sourceBlockNumber) : Promise.resolve(undefined), m.sourceTxHash ? getProofSummary(m.sourceTxHash) : Promise.resolve(undefined)]); return { ...r, attestation, proof }; })`. HTTP: `GET /v1/verify/:hash` → same object, `Cache-Control: public, max-age=15`, 404 when `found: false`.
- [ ] **Step 5:** `VerifyPage.tsx` — `useParams()` from wouter; input box + *Verify* navigates to `/verify/<hash>`; result: four-step rail (Sepolia commitment → attestation → Attestcoin proof → Creditcoin settlement) each with its hash, explorer link and state; render `ProofPanel` (move it from `Home.tsx` to `client/src/components/ProofPanel.tsx`, exported, Home imports it). Copy-link button.
- [ ] **Step 6:** verify + commit: `Public verifier: any root or transaction hash resolves to both chains and the proof`.

---

### Task 3: Area page, export, badge

**Files:**
- Create: `server/signalproof/areaExport.ts`, `server/signalproof/areaExport.test.ts`
- Modify: `server/signalproof/buyerApi.ts` (three routes), `server/routers.ts` (`area({ areaHash })` → `AreaView & { trend }`)
- Create: `client/src/pages/AreaPage.tsx`; Modify: `client/src/pages/Home.tsx` (zone cards link to `/area/<code>`)

**Interfaces (`areaExport.ts`):**
- `areaTrend(view: AreaView): Array<{ t: number; quality: number; latencyMs: number | null; downloadMbps: number | null }>` — samples with a timestamp, ascending by `t` (ms).
- `areaCsv(view: AreaView): string` — header exactly `measurementRoot,status,contributor,timestamp,latencyMs,downloadMbps,quality,sourceTxHash,creditcoinTxHash,rewardWei`; RFC 4180 quoting for any field containing `,` `"` or newline; `\r\n` line ends; empty string for null.
- `areaJson(view: AreaView, generatedAt: Date): { area: string; generatedAt: string; quality: number; sampleCount: number; samples: AreaSample[] }`.
- `badgeSvg(args: { area: string; quality: number | null; samples: number }): string` — width 300, height 20, left label "SignalProof · <area>", right "quality <q> · <n> samples · verified on Creditcoin"; colour `#31B7A6` ≥80, `#F4B95E` ≥60, `#F06A59` otherwise, `#8EA0AC` when `quality === null` (text "no data").

- [ ] **Step 1: Tests** — CSV header + one quoted field (`contributor` forced to `0x"1`), row count = samples; trend ascending and skips null timestamps; badge contains the area, the quality and the colour; JSON shape.
- [ ] **Step 2–3:** run → implement.
- [ ] **Step 4:** routes: `/v1/areas/:area/export.csv` (gated; `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="signalproof-<area>.csv"`), `/v1/areas/:area/export.json` (gated), `/v1/areas/:area/badge.svg` (free, `image/svg+xml`, `Cache-Control: public, max-age=60`; unknown area → grey badge, 200). tRPC `area` returns `{ ...view, trend: areaTrend(view) }` or `null`.
- [ ] **Step 5:** `AreaPage.tsx` — `CoverageMap` with the single zone; KPI strip; `LineChart` (recharts) of `trend`; sample table with `/verify/<root>` links; buttons *CSV* / *JSON* / *Brief* using `getStoredAccessKey()` (on 401 render the response's `howTo` and a link to Data products); *Embed badge* shows `<img src="https://<host>/v1/areas/<area>/badge.svg">` with copy. Home's zone cards: title becomes `<Link href={`/area/${zone.code}`}>`.
- [ ] **Step 6:** verify + commit: `Area page with quality trend, CSV/JSON export and an embeddable badge`.

---

### Task 4: Contributors

**Files:**
- Create: `server/signalproof/contributors.ts`, `server/signalproof/contributors.test.ts`
- Modify: `server/routers.ts` (`contributors` list procedure)
- Create: `client/src/pages/ContributorsPage.tsx`, `client/src/pages/ContributorPage.tsx`; Modify: `client/src/components/WalletControl.tsx` (*My profile* link when connected)

**Interfaces:** `listContributors(snapshot): ContributorRow[]` with
```ts
export type ContributorRow = { rank: number; address: string; submitted: number; settled: number; awaiting: number;
  areas: string[]; rewardAccruedWei: string; firstSeen: number | null; lastSeen: number | null };
```
Sort: `settled` desc, then `lastSeen` desc, then address asc. Addresses compared lower-case, reported as first seen on chain.

- [ ] **Step 1: Tests** — two contributors with 2 and 1 settled → ranks 1,2; tie on settled broken by `lastSeen`; areas de-duplicated; empty snapshot → `[]`; reward sum over settled rows only.
- [ ] **Step 2–3:** run → implement.
- [ ] **Step 4:** `contributors: publicProcedure.query(async () => listContributors(await getOnchainSnapshot()))`.
- [ ] **Step 5:** pages — table with rank, address (link to `/contributors/<address>`), settled/awaiting, cells, CTC accrued, last seen; profile page uses `contributorStats` (+ `rewardsFor`) and renders `<ClaimReward>` when `wallet.address` equals the route address; otherwise a read-only summary and the measurement list with `/verify/<root>` links. `WalletControl`: `<Link href={`/contributors/${wallet.address}`}>My profile</Link>` next to the address chip.
- [ ] **Step 6:** verify + commit: `Contributors leaderboard and per-address profile`.

---

### Task 5: Ops panel

**Files:**
- Create: `server/signalproof/ops.ts`, `server/signalproof/ops.test.ts`
- Modify: `server/signalproof/proofWorker.ts` (add and export `workerHealth`, update it in `startProofWorker`'s interval callback only), `server/signalproof/chainRead.ts` (add and export `snapshotHealth`: `lastSuccessAt`, `lastError`, `emptyResultsRejected` — bump the counter where `reconcileSnapshot` returns `previous` for a shrunk read), `server/routers.ts` (`ops` procedure)
- Create: `client/src/pages/OpsPage.tsx`

**Interfaces:**
```ts
export type WorkerHealth = { mode: "full" | "relay-only"; running: boolean; lastTickAt: number | null;
  lastResult: { relayed: number; settled: number; recovered: number } | null; lastError: string | null; consecutiveFailures: number };
export type SnapshotHealth = { lastSuccessAt: number | null; lastError: string | null; emptyResultsRejected: number };
export function poolRunway(poolWei: bigint, rewardWei: bigint): number | null; // floor(pool/reward); null when reward is 0
export type OpsStatus = {
  relayer: { sepolia: { address: string | null; balanceWei: string | null; error: string | null }; creditcoin: { address: string | null; balanceWei: string | null; error: string | null } };
  pool: { balanceWei: string; rewardWei: string; runway: number | null };
  worker: WorkerHealth; snapshot: SnapshotHealth;
  attestation: { attestedHeight: number; sepoliaHead: number; lag: number; error: string | null };
  generatedAt: string;
};
export async function getOpsStatus(): Promise<OpsStatus>;
```
Relayer addresses via `new Wallet(key).address` when the key is set; balances via `JsonRpcProvider.getBalance`; every probe in its own `try/catch` → `error` per row, never a throw.

- [ ] **Step 1: Tests** — `poolRunway(5n * 10n ** 18n, 10n ** 15n) === 5000`; `poolRunway(1n, 0n) === null`; `workerHealth` starts `{ running: false, lastTickAt: null, consecutiveFailures: 0 … }` (import from `proofWorker.ts` and assert the initial shape).
- [ ] **Step 2–3:** run → implement. In `startProofWorker`, set `workerHealth.running = true; workerHealth.mode = readiness.settleMode`; in `.then` set `lastTickAt = Date.now(); lastResult = …; lastError = null; consecutiveFailures = 0`; in `.catch` set `lastError = code; consecutiveFailures++`; in `stopProofWorker` set `running = false`.
- [ ] **Step 4:** `ops: publicProcedure.query(() => getOpsStatus())`.
- [ ] **Step 5:** `OpsPage.tsx` — four cards (Relayer balances, Reward pool + runway, Worker, Chain reads) + attestation lag; refetch 15 s; a row's `error` rendered in amber, never hidden.
- [ ] **Step 6:** verify + commit: `Ops panel: relayer balances, pool runway, worker and RPC health`.

---

### Task 6: Auto-measure

**Files:**
- Create: `client/src/lib/autoMeasure.ts`, `shared/autoMeasure.ts` + `shared/autoMeasure.test.ts` (pure scheduler, tested under vitest's `shared/**` include)
- Create: `client/src/hooks/useMeasurementRun.ts` (extract `runTest`, `reading`, `testState`, `measureError`, `submittedRoot`, `sessionId`, `tracked`, `attestation` and the status effect from `Home.tsx` lines ~367–500, unchanged in behaviour)
- Create: `client/src/components/AutoMeasure.tsx`; Modify: `client/src/pages/Home.tsx` (measure mode uses the hook; panel added under the run button)

**Interfaces (`shared/autoMeasure.ts`):**
```ts
export const AUTO_MEASURE_INTERVAL_MS = 600_000;
export const SIGN_DEADLINE_MS = 14 * 60_000;
export type CycleLog = { at: number; area: string | null; result: "submitted" | "skipped" | "rejected"; reason: string | null };
/** Milliseconds until the next run; 0 when due. */
export function msUntilNextRun(lastRunAt: number | null, now: number, interval = AUTO_MEASURE_INTERVAL_MS): number;
/** Keep the newest `max` entries. */
export function appendLog(log: CycleLog[], entry: CycleLog, max = 50): CycleLog[];
```
- [ ] **Step 1: Tests** — `msUntilNextRun(null, 100) === 0`; `msUntilNextRun(1000, 1000 + 600_000) === 0`; `msUntilNextRun(1000, 2000) === 599_000`; `appendLog` caps at `max` keeping the newest.
- [ ] **Step 2–3:** run → implement.
- [ ] **Step 4:** `useMeasurementRun()` — returns `{ runTest, runTamperedDemo, reading, testState, measureError, submittedRoot, tracked, attestation }`; `runTest` gains an optional `{ signDeadlineMs }` — wraps `wallet.signMeasurement` in `Promise.race` with a timeout that rejects with `Error("NOT_SIGNED_IN_TIME")`. Home's measure mode is re-pointed at the hook with no JSX change.
- [ ] **Step 5:** `AutoMeasure.tsx` — toggle persisted in `localStorage.signalproof.autoMeasure.enabled`; `setInterval` 1 s computing `msUntilNextRun`; when due and `testState` is idle/settled/rejected → `runTest({ signDeadlineMs: SIGN_DEADLINE_MS })`, then `appendLog`; on toggle-on request `Notification.requestPermission()` and `navigator.wakeLock?.request("screen")` (both optional); effect watching `tracked.data?.status === "SETTLED"` fires `new Notification("Measurement settled on Creditcoin", { body: <area> })` once per root. Copy on screen: "Every cycle asks your wallet to sign — that signature is what makes the measurement yours on-chain. Background tabs are throttled by the browser: install the app and keep it in front."
- [ ] **Step 6:** verify + commit: `Auto-measure: a 10-minute cycle with wallet signing, local log and settlement notifications`.

---

### Task 7: Docs and env

**Files:** `README.md` (new "Product surface" section after "A buyer can query an area, with provenance": buyer access incl. the service-not-data sentence; verifier; area page/export/badge; contributors; ops; auto-measure; update the status table rows for Buyer API and Anti-spam wording), `.env.example` (three vars under a new "Buyer access" block), `docs/TECHNICAL_ARCHITECTURE.md` (routes + modules table), `docs/JUDGE_QA.md` (Q: "You paywalled public data?" → A: the sentence), `todo.md` (move items to done).

- [ ] Write, `pnpm check`, commit: `Docs and env for the product surface`.
