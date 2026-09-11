/**
 * Live end-to-end run for the BATCH settlement route.
 *
 *   pnpm e2e:batch
 *
 * The single-measurement harness (e2eLive.ts) proves the pipeline works. This one proves the
 * optimisation is real: several measurements, ONE continuity proof, one Creditcoin transaction.
 *
 * A continuity proof walks the attestation chain back to a checkpoint and is the expensive part of
 * a verification — proving N measurements individually pays for N of them. The batch overload
 * carries exactly one for the whole set, which is only sound when every entry falls inside the
 * range that proof was built over. So the harness does not assume the saving: it submits several
 * measurements with consecutive nonces so they land in the same or adjacent Sepolia blocks, fetches
 * a proof for each, and REPORTS whether the proof service actually handed back identical continuity
 * proofs. If it did not, that is the finding, and each measurement settles on its own instead.
 *
 * Takes roughly 9-14 minutes, dominated by the attestation wait.
 */

import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, hexlify, toUtf8Bytes, zeroPadValue } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { ENV } from "../_core/env";
import {
  CC3_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  SIGNAL_PROOF_BATCH_ABI,
  SOURCE_BATCH_REGISTRY_ABI,
} from "./abi";
import { fallbackBatchGasLimit, withGasBuffer } from "./worker";
import { SEPOLIA_SENDER_PROVIDER_OPTIONS } from "./chain";
import { AREA_PRECISION, encodeGeohash } from "../../shared/geohash";
import {
  buildMeasurementSigningMessage,
  deriveMeasurementRoot,
  deriveSessionHash,
  makeNonce,
} from "../../shared/measurement";

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (n: number, m: string) => console.log(`\n[${n}] ${m}`);
const info = (m: string) => console.log(`      ${m}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b32 = (s: string) => zeroPadValue(hexlify(toUtf8Bytes(s)), 32);

/** How many measurements to put through in one batch. Three is enough to show the saving. */
const COUNT = 3;

async function main() {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000 / 60).toFixed(1)}m`;

  console.log("\nSignalProof — live batch settlement run\n");

  if (!ENV.batchSettlementAddress) {
    throw new Error("BATCH_SETTLEMENT_ADDRESS is not set. Run ./contracts/deploy.sh batch first.");
  }

  const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, SEPOLIA_SENDER_PROVIDER_OPTIONS);
  const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
  const sepoliaSigner = new Wallet(ENV.sepoliaRelayerPrivateKey, sepolia);
  const cc3Signer = new Wallet(ENV.creditcoinRelayerPrivateKey, creditcoin);

  step(0, "Preflight");
  const [sNet, cNet] = await Promise.all([sepolia.getNetwork(), creditcoin.getNetwork()]);
  if (Number(sNet.chainId) !== SEPOLIA_CHAIN_ID) throw new Error(`Sepolia RPC is chain ${sNet.chainId}`);
  if (Number(cNet.chainId) !== CC3_TESTNET_CHAIN_ID) throw new Error(`CC3 RPC is chain ${cNet.chainId}`);
  ok(`Sepolia ${sNet.chainId} · CC3 ${cNet.chainId}`);
  ok(`registry ${ENV.sourceBatchRegistryAddress}`);
  ok(`batch    ${ENV.batchSettlementAddress}`);

  const registry = new Contract(
    ENV.sourceBatchRegistryAddress,
    SOURCE_BATCH_REGISTRY_ABI as unknown as string[],
    sepoliaSigner,
  );
  const batch = new Contract(
    ENV.batchSettlementAddress,
    SIGNAL_PROOF_BATCH_ABI as unknown as string[],
    cc3Signer,
  );

  // The gate is the whole security argument, so check it before spending anything.
  const gatedOn: string = await registry.relayer();
  if (gatedOn.toLowerCase() !== sepoliaSigner.address.toLowerCase()) {
    throw new Error(`registry accepts ${gatedOn}, but this harness signs as ${sepoliaSigner.address}`);
  }
  ok(`registry gated on the relayer ${gatedOn}`);

  const boundRegistry: string = await batch.sourceRegistry();
  if (boundRegistry.toLowerCase() !== ENV.sourceBatchRegistryAddress.toLowerCase()) {
    throw new Error(`batch contract is bound to ${boundRegistry}, not the configured registry`);
  }
  ok(`batch contract bound to that same registry`);

  const poolBefore = await creditcoin.getBalance(ENV.batchSettlementAddress);
  const accruedBefore: bigint = await batch.rewards(cc3Signer.address);
  ok(`batch pool ${poolBefore} wei · contributor accrued ${accruedBefore} wei`);

  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
  const chains = await chainInfoProvider.getSupportedChains();
  const entry = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);
  if (!entry) throw new Error("Sepolia is not an attested source chain here");
  const chainKey = Number(entry.chainKey);
  ok(`chainKey ${chainKey} (resolved, not hardcoded)`);

  // ---------------------------------------------------------------- //
  step(1, `Submit ${COUNT} measurements to Ethereum Sepolia`);

  // Nonces assigned up front and the sends never awaited individually, so the transactions go out
  // together and land in the same or adjacent blocks. Awaiting each in turn would spread them over
  // 3 blocks and across a 12-second window, which is exactly the shape that does NOT batch.
  let nonce = await sepolia.getTransactionCount(sepoliaSigner.address, "pending");
  const timestamp = Math.floor(Date.now() / 1000);
  const areaLabel = encodeGeohash(-6.225, 106.809, AREA_PRECISION);
  const areaHash = b32(areaLabel);

  const roots: string[] = [];
  const sends = [];
  for (let i = 0; i < COUNT; i++) {
    const salt = makeNonce();
    const sessionHash = deriveSessionHash(`e2e-batch-${salt}`);
    const measurementRoot = deriveMeasurementRoot({
      areaHash: areaLabel,
      networkType: "4g",
      latencyMs: 28 + i,
      downloadMbps: 91,
      uploadMbps: 0,
      packetLossBps: 0,
      timestampMs: String(timestamp * 1000),
      nonce: salt,
      sessionHash,
      contributorAddress: cc3Signer.address,
    });
    roots.push(measurementRoot);
    info(`#${i + 1} ${measurementRoot}`);

    sends.push(
      registry.submitMeasurement(
        measurementRoot, areaHash, cc3Signer.address, sessionHash,
        BigInt(timestamp), BigInt(28 + i), 91n,
        await cc3Signer.signMessage(
          buildMeasurementSigningMessage({ measurementRoot, contributorAddress: cc3Signer.address }),
        ),
        { nonce: nonce++ },
      ),
    );
  }

  const txs = await Promise.all(sends);
  const receipts = await Promise.all(txs.map((t) => t.wait(1)));
  for (const r of receipts) {
    if (!r || r.status !== 1) throw new Error("a source transaction reverted");
  }
  const blocks = receipts.map((r) => r!.blockNumber);
  const highest = Math.max(...blocks);
  ok(`${COUNT} measurements mined in block(s) ${[...new Set(blocks)].join(", ")} (${elapsed()})`);

  // ---------------------------------------------------------------- //
  step(2, "Wait for Attestcoin attestation to reach the highest block");
  info("polling getLatestAttestedHeightAndHash every 20s — expect roughly 7-9 minutes");

  const deadline = Date.now() + 25 * 60 * 1000;
  let attested = 0;
  while (Date.now() < deadline) {
    const latest = await chainInfoProvider.getLatestAttestedHeightAndHash(chainKey);
    attested = Number(latest.height);
    if (attested >= highest) break;
    info(`attested ${attested} · need ${highest} · ${highest - attested} to go (${elapsed()})`);
    await sleep(20_000);
  }
  if (attested < highest) throw new Error(`timed out waiting for attestation (${elapsed()})`);
  ok(`attested height ${attested} >= ${highest} (${elapsed()})`);

  // ---------------------------------------------------------------- //
  step(3, `Fetch ${COUNT} inclusion proofs`);

  const builder = new proofProvider.service.ProofBuilder(chainKey, ENV.attestcoinProofServiceUrl, 120_000);
  type Proof = NonNullable<Awaited<ReturnType<typeof builder.getProof>>["data"]>;
  const proofs: Proof[] = [];
  for (const r of receipts) {
    const result = await builder.getProof(r!.hash);
    if (!result.success || !result.data) {
      throw new Error(`proof generation failed for ${r!.hash}: ${result.error ?? "unknown"}`);
    }
    proofs.push(result.data);
    info(`${r!.hash.slice(0, 12)}… header ${result.data.headerNumber} · ${result.data.continuityProof.roots?.length ?? 0} continuity root(s)`);
  }

  // ---------------------------------------------------------------- //
  step(4, "Can these share one continuity proof?");

  const fingerprint = (p: Proof) =>
    [p.chainKey, p.continuityProof.lowerEndpointDigest, (p.continuityProof.roots ?? []).join(",")].join("|");

  const groups = new Map<string, Proof[]>();
  proofs.forEach((p) => {
    const key = fingerprint(p);
    const existing = groups.get(key);
    if (existing) existing.push(p);
    else groups.set(key, [p]);
  });

  const largest = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  ok(`${proofs.length} proof(s) fall into ${groups.size} continuity group(s)`);
  if (largest.length < 2) {
    info("the proof service issued a distinct continuity proof per transaction, so no batching is");
    info("possible for this set — the worker would settle each one through the single-proof path.");
    throw new Error("no group of 2+ formed; nothing to demonstrate on the batch route");
  }
  ok(`largest group holds ${largest.length} measurement(s) — one proof covers all of them`);

  // ---------------------------------------------------------------- //
  step(5, "Settle the whole group in ONE Creditcoin transaction");

  const shared = largest[0].continuityProof;
  const continuityRoots = shared.roots ?? [];
  const args = [
    largest[0].chainKey,
    largest.map((p) => p.headerNumber),
    largest.map((p) => p.txBytes),
    largest.map((p) => ({ root: p.merkleProof.root, siblings: p.merkleProof.siblings })),
    { lowerEndpointDigest: shared.lowerEndpointDigest, roots: continuityRoots },
  ] as const;

  let gasLimit: bigint;
  try {
    const est = await batch.executeBatch.estimateGas(...args);
    gasLimit = withGasBuffer(est);
    info(`estimated ${est} → limit ${gasLimit} (+35%)`);
  } catch {
    gasLimit = fallbackBatchGasLimit(largest.length, continuityRoots.length);
    info(`estimateGas failed against the precompile as expected; fallback limit ${gasLimit}`);
  }

  const execTx = await batch.executeBatch(...args, { gasLimit });
  info(`tx ${execTx.hash} — waiting...`);
  const execReceipt = await execTx.wait(1);
  if (!execReceipt || execReceipt.status !== 1) throw new Error("batch settlement tx reverted");
  ok(`settled in block ${execReceipt.blockNumber}, gas used ${execReceipt.gasUsed} (${elapsed()})`);
  ok(`https://creditcoin-testnet.blockscout.com/tx/${execReceipt.hash}`);

  // ---------------------------------------------------------------- //
  step(6, "Verify the outcome on-chain");

  const parsed = execReceipt.logs
    .map((l: { topics: readonly string[]; data: string }) => {
      try { return batch.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .filter((p: { name: string } | null): p is { name: string; args: Record<string, unknown> } => p !== null);

  const verified = parsed.filter((p: { name: string }) => p.name === "MeasurementVerified");
  const summary = parsed.find((p: { name: string }) => p.name === "BatchSettled");
  if (verified.length === 0) throw new Error("no MeasurementVerified emitted");
  ok(`${verified.length} MeasurementVerified event(s) from ONE transaction`);
  if (summary) {
    ok(`BatchSettled: ${summary.args.measurementCount} measurement(s) across ${summary.args.transactionCount} proved transaction(s)`);
  }

  let settledCount = 0;
  for (const root of roots) {
    if ((await batch.settled(root)) as boolean) settledCount++;
  }
  const accruedAfter: bigint = await batch.rewards(cc3Signer.address);
  ok(`settled[root] true for ${settledCount}/${roots.length} submitted measurement(s)`);
  ok(`contributor accrued ${accruedBefore} → ${accruedAfter} wei`);

  // The number that justifies the whole exercise.
  const perMeasurement = execReceipt.gasUsed / BigInt(verified.length);
  console.log(`\nBatch settlement complete in ${elapsed()}.`);
  console.log(`  ${verified.length} measurements · 1 continuity proof · 1 transaction`);
  console.log(`  ${execReceipt.gasUsed} gas total → ${perMeasurement} gas per measurement`);
  console.log(`  https://creditcoin-testnet.blockscout.com/tx/${execReceipt.hash}\n`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
