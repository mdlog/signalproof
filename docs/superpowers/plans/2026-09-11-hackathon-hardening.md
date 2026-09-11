# Hackathon Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven pre-submission improvements in `docs/superpowers/specs/2026-09-11-hackathon-hardening-spec.md` — on-chain signature enforcement, rate limiting, buyer API, proof inspector, wallet self-settle, public deployment, and the demo-data push — without breaking the live testnet pipeline.

**Architecture:** The registry gains an EIP-191 recovery of the contributor's signature over the exact text the wallet already signs; the event stays identical so both settlement contracts are only repointed. Server-side additions are pure, tested modules (`rateLimit.ts`, `areas.ts`, `proofView.ts`) wired into tRPC/Express; the client gets three affordances (area brief, proof view, self-settle) on the existing single-page dashboard. Deployment is a Node 22 container.

**Tech Stack:** Solidity 0.8.30 / Foundry (via_ir, shanghai), TypeScript, ethers v6, `@gluwa/usc-sdk` 0.18.0, tRPC 11, Express 4, React 19 + Vite, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-11-hackathon-hardening-spec.md`

## Global Constraints

- Commits: plain messages, no AI attribution trailers (user rule). Author email `17427126+mdlog@users.noreply.github.com` (repo-local config).
- Every production change lands with a failing test first (`pnpm test`, `forge test`). `pnpm verify` must be green before every push.
- Contract toolchain pinned: `solc 0.8.30`, `evm_version = shanghai`, `via_ir = true` (`contracts/foundry.toml`).
- `MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)` must not change (settlement contracts hardcode its keccak).
- Public API never returns `signature`, `nonce`, `sessionHash`.
- The signed text is `buildMeasurementSigningMessage` in `shared/measurement.ts` — unchanged.
- Code freeze 2026-09-13 15:59 UTC.

---

### Task 1: Pin the signing message and a TypeScript-produced signature vector

**Files:**
- Create: `server/signalproof/signing.test.ts`

**Interfaces:**
- Consumes: `buildMeasurementSigningMessage`, `deriveMeasurementRoot` from `shared/measurement.ts`; `Wallet` from ethers.
- Produces: the vector constants (root, contributor, signature) that Task 2 hardcodes in Solidity. Print them once with `console.log` in the test, copy into `contracts/test/SourceBatchRegistry.t.sol`.

- [ ] **Step 1: Write the test that prints and pins the vector**

```ts
import { describe, expect, it } from "vitest";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { buildMeasurementSigningMessage } from "../../shared/measurement";

// Anvil default account #1 — a public test key, never used on any chain.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ROOT = keccak256(toUtf8Bytes("signalproof-signing-vector"));

describe("signing message vector", () => {
  it("is the exact text the registry rebuilds on-chain", async () => {
    const wallet = new Wallet(KEY);
    const message = buildMeasurementSigningMessage({ measurementRoot: ROOT, contributorAddress: wallet.address });
    expect(message).toBe(
      "SignalProof — confirm this measurement\n\n" +
        "Signing proves this measurement is yours, so the reward is credited to your address.\n" +
        "It authorises no transaction and cannot move your funds.\n\n" +
        `Measurement: ${ROOT}\n` +
        `Contributor: ${wallet.address.toLowerCase()}`,
    );
    const signature = await wallet.signMessage(message);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    // Copied verbatim into contracts/test/SourceBatchRegistry.t.sol (VECTOR_*). Regenerate both
    // together if the message text ever changes.
    console.log(JSON.stringify({ root: ROOT, contributor: wallet.address, signature }));
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run server/signalproof/signing.test.ts` → PASS, and note the printed JSON.

- [ ] **Step 3: Commit** — `git add server/signalproof/signing.test.ts && git commit -m "Pin the contributor signing message with a signature vector"`

---

### Task 2: Registry verifies the contributor's signature on-chain

**Files:**
- Modify: `contracts/src/SourceBatchRegistry.sol`
- Modify: `contracts/test/SourceBatchRegistry.t.sol`

**Interfaces:**
- Produces: `function submitMeasurement(bytes32,bytes32,address,bytes32,uint256,uint256,uint256,bytes signature)`, `function signingMessage(bytes32,address) pure returns (string)`, `function signingDigest(bytes32,address) pure returns (bytes32)`, `function recoverContributor(bytes32,address,bytes) pure returns (address)`, errors `SignatureMismatch(address recovered, address contributor)`, `BadSignatureLength(uint256 length)`.

- [ ] **Step 1: Failing tests** (append to `SourceBatchRegistry.t.sol`; adapt `setUp` so the relayer is `RELAYER` and calls are pranked)

```solidity
uint256 constant VECTOR_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
bytes32 constant VECTOR_ROOT = /* from Task 1 */;
address constant VECTOR_CONTRIBUTOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
bytes constant VECTOR_SIG = hex"/* from Task 1, without 0x */";

function _sign(uint256 key, bytes32 root, address contributor) internal view returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.signingDigest(root, contributor));
    return abi.encodePacked(r, s, v);
}

function test_acceptsASignatureProducedByTheTypeScriptClient() public {
    vm.prank(RELAYER);
    registry.submitMeasurement(VECTOR_ROOT, keccak256("qqguw6"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 28, 91, VECTOR_SIG);
    assertTrue(registry.registered(VECTOR_ROOT));
}

function testFuzz_recoversTheSignerForAnyRoot(bytes32 root, uint248 keySeed) public {
    uint256 key = bound(uint256(keySeed), 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
    address contributor = vm.addr(key);
    vm.assume(root != bytes32(0));
    assertEq(registry.recoverContributor(root, contributor, _sign(key, root, contributor)), contributor);
}

function test_rejectsASignatureFromSomeoneElse() public {
    bytes memory sig = _sign(VECTOR_KEY, VECTOR_ROOT, VECTOR_CONTRIBUTOR);
    address other = address(0xBEEF);
    vm.prank(RELAYER);
    vm.expectRevert(); // SignatureMismatch(recovered, other)
    registry.submitMeasurement(VECTOR_ROOT, keccak256("z"), other, keccak256("s"), block.timestamp, 1, 1, sig);
}

function test_rejectsAMalformedSignature() public {
    vm.prank(RELAYER);
    vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.BadSignatureLength.selector, 3));
    registry.submitMeasurement(VECTOR_ROOT, keccak256("z"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 1, 1, hex"010203");
}

function test_theRelayerGateIsStillCheckedFirst() public {
    vm.prank(address(0xA77ACC));
    vm.expectRevert(abi.encodeWithSelector(SourceBatchRegistry.NotAuthorised.selector, address(0xA77ACC)));
    registry.submitMeasurement(VECTOR_ROOT, keccak256("z"), VECTOR_CONTRIBUTOR, keccak256("s"), block.timestamp, 1, 1, VECTOR_SIG);
}
```

- [ ] **Step 2: Run** `cd contracts && forge test --match-contract SourceBatchRegistryTest` → compile error (no 8-arg function). Expected.

- [ ] **Step 3: Implement in `SourceBatchRegistry.sol`**

```solidity
error SignatureMismatch(address recovered, address contributor);
error BadSignatureLength(uint256 length);

bytes16 private constant HEX_DIGITS = "0123456789abcdef";

/// @notice The exact text the contributor's wallet displayed and signed (EIP-191 personal_sign).
///         Mirrors shared/measurement.ts buildMeasurementSigningMessage byte for byte.
function signingMessage(bytes32 measurementRoot, address contributor) public pure returns (string memory) {
    return string.concat(
        unicode"SignalProof — confirm this measurement\n\n",
        "Signing proves this measurement is yours, so the reward is credited to your address.\n",
        "It authorises no transaction and cannot move your funds.\n\n",
        "Measurement: 0x", _hex(abi.encodePacked(measurementRoot)), "\n",
        "Contributor: 0x", _hex(abi.encodePacked(contributor))
    );
}

function signingDigest(bytes32 measurementRoot, address contributor) public pure returns (bytes32) {
    bytes memory message = bytes(signingMessage(measurementRoot, contributor));
    return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", _decimal(message.length), message));
}

function recoverContributor(bytes32 measurementRoot, address contributor, bytes calldata signature) public pure returns (address) {
    if (signature.length != 65) revert BadSignatureLength(signature.length);
    bytes32 r = bytes32(signature[0:32]);
    bytes32 s = bytes32(signature[32:64]);
    uint8 v = uint8(signature[64]);
    if (v < 27) v += 27;
    return ecrecover(signingDigest(measurementRoot, contributor), v, r, s);
}

function _hex(bytes memory data) private pure returns (string memory) {
    bytes memory out = new bytes(data.length * 2);
    for (uint256 i; i < data.length; ++i) {
        uint8 b = uint8(data[i]);
        out[2 * i] = HEX_DIGITS[b >> 4];
        out[2 * i + 1] = HEX_DIGITS[b & 0x0f];
    }
    return string(out);
}

function _decimal(uint256 value) private pure returns (string memory) {
    if (value == 0) return "0";
    uint256 digits; for (uint256 t = value; t != 0; t /= 10) ++digits;
    bytes memory out = new bytes(digits);
    while (value != 0) { out[--digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
    return string(out);
}
```
and in `submitMeasurement(..., bytes calldata signature)`, after the existing checks and before writing state:
```solidity
address recovered = recoverContributor(measurementRoot, contributor, signature);
if (recovered != contributor) revert SignatureMismatch(recovered, contributor);
```

- [ ] **Step 4: Run** the registry tests → PASS (other suites still fail to compile until Task 3).

- [ ] **Step 5: Commit** — `git commit -am "Registry verifies the contributor's signature on-chain"`

---

### Task 3: Move every Foundry test to a shared signed-submit helper

**Files:**
- Create: `contracts/test/SignedSubmit.sol`
- Modify: `EndToEnd.t.sol`, `RegistryAuthorisation.t.sol`, `AdvUnlimitedMint.t.sol`, `DoubleSettlement.t.sol`, `BatchPoison.t.sol`, `SignalProofBatchSettlement.t.sol`

**Interfaces:**
- Produces: `abstract contract SignedSubmit is Test { uint256 constant CONTRIBUTOR_KEY = 0xA11CE; address CONTRIBUTOR = vm.addr(CONTRIBUTOR_KEY); function sigFor(SourceBatchRegistry, uint256 key, bytes32 root, address contributor) returns (bytes memory); function submitSigned(SourceBatchRegistry, uint256 key, bytes32 root, bytes32 area, bytes32 session, uint256 ts, uint256 lat, uint256 dl) }`

- [ ] **Step 1:** Write the helper; every `submitMeasurement(root, area, CONTRIBUTOR, …)` call becomes `submitSigned(registry, CONTRIBUTOR_KEY, root, area, session, ts, lat, dl)` (prank stays where it was; the helper does not prank). Tests whose contributor was a literal address (`address(0xC0FFEE)`, `ATTACKER`) get a key constant and `vm.addr`.
- [ ] **Step 2:** `forge test` → all suites compile and pass (expect 72+ tests). Fix any test whose exploit narrative changes: `AdvUnlimitedMint` still reverts `NotAuthorised` before the signature is looked at — assert that order.
- [ ] **Step 3:** Commit — `git commit -am "Foundry tests submit through a signed helper"`

---

### Task 4: Server follows the new registry: ABI, relayer, retired registries

**Files:**
- Modify: `server/signalproof/abi.ts` (registry ABI: 8-arg `submitMeasurement`, `signingDigest`, `recoverContributor`, new errors)
- Modify: `server/signalproof/abi.test.ts` (function list includes `recoverContributor`)
- Modify: `server/signalproof/relayer.ts:79-87` (pass `row.signature`)
- Modify: `server/_core/env.ts` (`retiredRegistries: process.env.RETIRED_REGISTRIES ?? ""`)
- Modify: `server/signalproof/chainRead.ts` (scan retired registries; `parseRetiredRegistries`)
- Test: `server/signalproof/chainRead.test.ts`

- [ ] **Step 1: Failing test** for the env parser

```ts
import { parseRetiredRegistries } from "./chainRead";
describe("parseRetiredRegistries", () => {
  it("reads address:deployBlock pairs and ignores blanks", () => {
    expect(parseRetiredRegistries(" 0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc:11658403 ,,")).toEqual([
      { address: "0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc", deployBlock: 11658403 },
    ]);
  });
  it("drops a pair whose block is not a number", () => {
    expect(parseRetiredRegistries("0xabc:nope")).toEqual([]);
  });
});
```
- [ ] **Step 2:** Run → `parseRetiredRegistries is not a function`.
- [ ] **Step 3: Implement**

```ts
export function parseRetiredRegistries(raw: string): Array<{ address: string; deployBlock: number }> {
  return raw.split(",").map((s) => s.trim()).filter(Boolean).flatMap((pair) => {
    const [address, block] = pair.split(":");
    const deployBlock = Number.parseInt(block ?? "", 10);
    return address && Number.isFinite(deployBlock) ? [{ address, deployBlock }] : [];
  });
}
```
In `getOnchainSnapshot`, after `submittedLogs` is scanned, also scan each retired registry with the same topic from its deploy block and concatenate; `scannedFromBlock.sepolia` becomes the minimum start block. The relayer passes `row.signature` as the 8th argument.
- [ ] **Step 4:** `pnpm check && pnpm test` green; `forge build` then `pnpm test` again so the artifact cross-check runs.
- [ ] **Step 5:** Commit — `git commit -am "Relayer sends the contributor signature; dashboard scans retired registries"`

---

### Task 5: Deploy the signed registry, repoint, prove it live

- [ ] `pnpm deploy:check` (balances ≥ 0.001 ETH / funded CTC — measured 0.499 ETH, 88 CTC).
- [ ] Before deploying, set `RETIRED_REGISTRIES=0x15F3d74846a40bD67f8ce345B73ae4c400f759Dc:11658403` in `.env` (and in `.env.example`).
- [ ] `pnpm deploy:sepolia` → writes the new `SOURCE_BATCH_REGISTRY_ADDRESS` and deploy block into `.env`.
- [ ] `./contracts/deploy.sh repoint` → both settlement contracts read the new registry.
- [ ] Verify on Etherscan (`forge verify-contract` step in the script) and `pnpm smoke`.
- [ ] Pre-warm: start `pnpm dev`, submit two measurements from the browser (wallet), watch `AWAITING_ATTESTATION → SETTLED` within ~10 min; confirm the dashboard shows old (retired) + new rows.
- [ ] Update `.env.example` addresses/blocks; commit — `git commit -am "Deploy the signed registry and repoint the settlement contracts"`

---

### Task 6: Gateway rate limit (anti-spam policy)

**Files:**
- Create: `server/signalproof/rateLimit.ts`, `server/signalproof/rateLimit.test.ts`
- Modify: `server/routers.ts` (before `insertMeasurement`)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";
describe("rate limiter", () => {
  it("allows 3 measurements per contributor per cell in 10 minutes and refuses the 4th", () => {
    const limit = createRateLimiter({ max: 3, windowMs: 600_000 });
    const key = { contributor: "0xabc", areaHash: "qqguw6" };
    expect(limit.check(key, 0).ok).toBe(true);
    expect(limit.check(key, 1_000).ok).toBe(true);
    expect(limit.check(key, 2_000).ok).toBe(true);
    const fourth = limit.check(key, 3_000);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.retryAfterMs).toBe(597_000);
  });
  it("forgets attempts older than the window", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1_000 });
    const key = { contributor: "0xabc", areaHash: "qqguw6" };
    expect(limit.check(key, 0).ok).toBe(true);
    expect(limit.check(key, 1_001).ok).toBe(true);
  });
  it("keeps cells and contributors separate", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1_000 });
    expect(limit.check({ contributor: "0xabc", areaHash: "a" }, 0).ok).toBe(true);
    expect(limit.check({ contributor: "0xabc", areaHash: "b" }, 0).ok).toBe(true);
    expect(limit.check({ contributor: "0xdef", areaHash: "a" }, 0).ok).toBe(true);
  });
});
```
- [ ] **Step 2:** Run → module missing.
- [ ] **Step 3: Implement** a `Map<string, number[]>` limiter; key `${contributor.toLowerCase()}:${areaHash}`; prune timestamps `< now - windowMs`; `check` records on success; returns `{ ok: true } | { ok: false, retryAfterMs }`. Wire in `submitMeasurement`: `const gate = measurementRateLimit.check({ contributor: input.contributorAddress, areaHash: input.areaHash }, Date.now()); if (!gate.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });` placed after integrity, before the duplicate lookup. Export `MEASUREMENT_RATE_LIMIT = { max: 3, windowMs: 600_000 }` and surface it in `integrationStatus` as `rateLimit` so the UI can state the policy.
- [ ] **Step 4:** Tests green; the client shows "Rate limited — 3 measurements per cell per 10 minutes" on that error.
- [ ] **Step 5:** Commit — `git commit -am "Gateway limits measurements per contributor per cell"`

---

### Task 7: Buyer API v1 and a working area brief

**Files:**
- Create: `server/signalproof/areas.ts`, `server/signalproof/areas.test.ts`
- Modify: `server/_core/index.ts` (routes), `client/src/pages/Home.tsx` (Data products card + brief dialog)

**Interfaces:**
- Produces: `areaView(snapshot: OnchainSnapshot, geohash: string): AreaView | null` — `{ areaHash, cell: {lat,lon,bounds}, sampleCount, settledCount, avgLatencyMs, avgDownloadMbps, quality, lastUpdatedMs, samples: [{ measurementRoot, status, timestamp, latencyMs, downloadMbps, sourceTxHash, creditcoinTxHash, explorer: {source, settlement} }] }`; `listAreas(snapshot)`; `buildAreaBrief(view: AreaView, generatedAt: Date): string` (markdown).
- Routes: `GET /v1/areas` → `{ generatedAt, registry, settlement, areas: [...] }`; `GET /v1/areas/:geohash` → `AreaView` or 404 `{ error: "AREA_NOT_FOUND" }`; `GET /v1/areas/:geohash/brief` → `text/markdown`.

- [ ] **Step 1: Failing tests** using a hand-built snapshot with two measurements in `qqguw6` (one settled, one awaiting) and one in `qqguyg`: `areaView` aggregates counts/averages, includes both explorer links, returns null for an unknown cell; `buildAreaBrief` contains the cell size line, the settled count, and every settlement tx hash.
- [ ] **Step 2:** Run → module missing. **Step 3:** Implement with `decodeGeohash` from `shared/geohash.ts` for the cell bounds and the same `qualityScore` formula as the UI (move it to `shared/quality.ts` and import in both). **Step 4:** Tests green; `curl localhost:3000/v1/areas/qqguw6 | head`.
- [ ] **Step 5: UI** — the "Create area brief (not built)" button becomes "Create area brief"; it fetches `/v1/areas/${zone.code}/brief`, shows it in a `Dialog` with a copy button and a link to `/v1/areas/${zone.code}` ("JSON with provenance"). The status panel text becomes "Area cards and the read-only buyer API are live; authentication and retention policy are not built."
- [ ] **Step 6:** Commit — `git commit -am "Buyer API v1: area views with per-sample provenance, and a working area brief"`

---

### Task 8: Proof inspector

**Files:**
- Create: `server/signalproof/proofView.ts`, `server/signalproof/proofView.test.ts`
- Modify: `server/signalproof/chain.ts` (`getReadContext()` — providers, ChainInfo, ProofBuilder, chainKey; no signers), `server/signalproof/proofWorker.ts` (use `buildExecuteArgs`), `server/routers.ts` (`proofFor`), `client/src/pages/Home.tsx` (View proof)

**Interfaces:**
- Produces: `buildExecuteArgs(proof: ProofData): ExecuteArgs` (the 8-tuple, bigints as-is) and `summarizeProof(proof, sourceTxHash): ProofSummary` — `{ sourceTxHash, chainKey, attestedHeight: headerNumber, txBytesLength, merkle: { root, siblings: [{hash,isLeft}] }, continuity: { lowerEndpointDigest, roots: string[] }, execute: { action: 0, args: string[] (JSON-safe), gasLimit: string }, precompile: "0x0000000000000000000000000000000000000FD2" }`; tRPC `signalproof.proofFor({ sourceTxHash })` cached 60 s per hash; error `{ error: "NOT_ATTESTED_YET" | message }` when the proof service refuses.

- [ ] **Step 1: Failing tests** for `buildExecuteArgs` (order and types of the tuple, `siblings` passed through, `roots ?? []`) and `summarizeProof` (counts, JSON-safe strings, gasLimit = `fallbackGasLimit(roots.length)`).
- [ ] **Step 2–4:** implement, refactor `settleMeasurement` to call `buildExecuteArgs`, keep `pnpm test` green.
- [ ] **Step 5: UI** — every Proof queue row gets "View proof"; on click, `proofFor` → panel: attested height, Merkle root + N siblings (first 3 shown, rest collapsed), M continuity roots, lowerEndpointDigest, txBytes length, the precompile address, and — for settled rows — the settlement tx link. On `NOT_ATTESTED_YET`, the panel says so with the current lag from `attestationProgress`.
- [ ] **Step 6:** Commit — `git commit -am "Proof inspector: the live Attestcoin proof for any measurement"`

---

### Task 9: Settle from my wallet + relay-only worker mode

**Files:**
- Modify: `server/_core/env.ts` (`proofWorkerMode: process.env.PROOF_WORKER_MODE ?? "full"`), `server/signalproof/worker.ts` (`readinessFrom` gains `settleMode: "full" | "relay-only"`; `shouldAutoSettle(mode)`), `server/signalproof/proofWorker.ts` (skip settlement when relay-only), `shared/abi.ts` (move `SIGNAL_PROOF_SETTLEMENT_ABI` here; `server/signalproof/abi.ts` re-exports), `client/src/hooks/useWallet.ts` (reuse `switchToCreditcoin`), `client/src/pages/Home.tsx` (button)

- [ ] **Step 1: Failing test** — `shouldAutoSettle("full") === true`, `shouldAutoSettle("relay-only") === false`, `readinessFrom([], "relay-only").settleMode === "relay-only"`.
- [ ] **Step 2–4:** implement; the worker's settle loop returns early with a one-line log in relay-only mode; `integrationStatus` exposes `settleMode`.
- [ ] **Step 5: UI** — on an `AWAITING_ATTESTATION` row: "Settle from my wallet" → `proofFor` → `switchToCreditcoin()` → `new Contract(settlementAddress, SIGNAL_PROOF_SETTLEMENT_ABI, signer).execute(...args, { gasLimit })` → toast with the tx link; on revert containing `MeasurementAlreadySettled`/`processed`, say "already settled by the relayer". In relay-only mode the sidebar reads "Relay only — settle from your wallet".
- [ ] **Step 6:** Verify live with `PROOF_WORKER_MODE=relay-only pnpm dev` and a real wallet; commit — `git commit -am "Settle from the contributor's own wallet; relay-only worker mode"`

---

### Task 10: Public deployment

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `render.yaml`
- Modify: `README.md` ("Live demo" at the top once the URL exists)

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```
- [ ] Build locally: `docker build -t signalproof .` and `docker run -p 3000:3000 --env-file .env signalproof` → `/api/trpc/signalproof.integrationStatus` OK. (If Docker is unavailable locally, rely on the host's build.)
- [ ] `fly launch --no-deploy` / Render blueprint; secrets = the chain variables from `.env` (relayer keys as secrets). The user logs in (`! fly auth login`).
- [ ] Health check path: `/api/trpc/signalproof.integrationStatus`. Set `PORT` per host.
- [ ] Commit config — `git commit -am "Container and host configs for the public demo"`

---

### Task 11: Docs, deck, submission package, memory, final verification

- [ ] README: new registry address + "signed on-chain" paragraph; retired registry note; rate-limit policy; buyer API section with `curl` example; proof inspector; self-settle + `PROOF_WORKER_MODE`; live demo URL; test counts.
- [ ] `docs/TECHNICAL_ARCHITECTURE.md` §3.4, §4 gateway, §6 security, §9 limitations.
- [ ] `docs/deck/SignalProof-deck.html` slides 4, 5, 6, 10, 11 (addresses, signature enforcement, buyer API now built, live URL); re-render PDF.
- [ ] `docs/SUBMISSION.md` Field 4/5 (addresses, new capabilities), `docs/JUDGE_QA.md` Q5 (relayer can no longer forge attribution), `docs/RUBRIC_SCORECARD.md` (C2/C3/C4/C5 re-scored), `docs/DEMO_RUNBOOK.md` + `docs/VIDEO_SCRIPT.md` (proof inspector and self-settle beats), `.env.example`, `todo.md`.
- [ ] Memory: update `signalproof-buidl-ctc-submission.md` with the new registry address and live URL.
- [ ] `pnpm verify` green; `git clone --recursive` smoke from a clean dir; push.
