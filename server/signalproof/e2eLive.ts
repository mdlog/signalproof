/**
 * Live end-to-end proof run against real chains.
 *
 * Submits a measurement to SourceBatchRegistry on Ethereum Sepolia, waits for the Attestcoin
 * attestation to reach that block, fetches the inclusion proof, and settles it on Creditcoin CC3.
 * No database required — this exercises the same call sequence proofWorker.ts uses, in isolation,
 * so a failure points at the chain path rather than at the gateway.
 *
 *   pnpm e2e:live
 *
 * Takes roughly 9-13 minutes, dominated by the attestation wait. That wait is the reason a live
 * real-time demo is not possible.
 */

import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, hexlify, toUtf8Bytes, zeroPadValue } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { ENV } from "../_core/env";
import {
  CC3_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  SIGNAL_PROOF_SETTLEMENT_ABI,
  SOURCE_BATCH_REGISTRY_ABI,
} from "./abi";
import { fallbackGasLimit, withGasBuffer } from "./worker";
import { SEPOLIA_SENDER_PROVIDER_OPTIONS } from "./chain";
import { AREA_PRECISION, encodeGeohash, geohashCellSize } from "../../shared/geohash";
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

async function main() {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000 / 60).toFixed(1)}m`;

  console.log("\nSignalProof — live end-to-end run\n");

  const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, SEPOLIA_SENDER_PROVIDER_OPTIONS);
  const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
  const sepoliaSigner = new Wallet(ENV.sepoliaRelayerPrivateKey, sepolia);
  const cc3Signer = new Wallet(ENV.creditcoinRelayerPrivateKey, creditcoin);

  step(0, "Preflight");
  const [sNet, cNet] = await Promise.all([sepolia.getNetwork(), creditcoin.getNetwork()]);
  if (Number(sNet.chainId) !== SEPOLIA_CHAIN_ID) throw new Error(`Sepolia RPC is chain ${sNet.chainId}`);
  if (Number(cNet.chainId) !== CC3_TESTNET_CHAIN_ID) throw new Error(`CC3 RPC is chain ${cNet.chainId}`);
  ok(`Sepolia ${sNet.chainId} · CC3 ${cNet.chainId}`);
  ok(`registry   ${ENV.sourceBatchRegistryAddress}`);
  ok(`settlement ${ENV.settlementContractAddress}`);

  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
  const chains = await chainInfoProvider.getSupportedChains();
  const entry = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);
  if (!entry) throw new Error("Sepolia is not an attested source chain here");
  const chainKey = Number(entry.chainKey);
  ok(`chainKey ${chainKey} (resolved, not hardcoded)`);

  const registry = new Contract(
    ENV.sourceBatchRegistryAddress,
    SOURCE_BATCH_REGISTRY_ABI as unknown as string[],
    sepoliaSigner,
  );
  const settlement = new Contract(
    ENV.settlementContractAddress,
    SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[],
    cc3Signer,
  );

  const poolBefore = await creditcoin.getBalance(ENV.settlementContractAddress);
  const rewardsBefore: bigint = await settlement.rewards(cc3Signer.address);
  ok(`reward pool ${poolBefore} wei · contributor accrued ${rewardsBefore} wei`);

  // ---------------------------------------------------------------- //
  step(1, "Submit measurement to Ethereum Sepolia");

  // Derived, not random: the same keccak of the same canonical payload the gateway now recomputes
  // and refuses to accept a mismatch for. A random root here would test a path nothing else uses.
  const nonce = makeNonce();
  // Sudirman CBD, Jakarta, at the gateway's coarse precision. The map decodes this back to a
  // ~1.2 km x 0.6 km cell — the contributor is somewhere inside it, never at the marker.
  const areaLabel = encodeGeohash(-6.225, 106.809, AREA_PRECISION);
  const areaHash = b32(areaLabel);
  const sessionHash = deriveSessionHash(`e2e-${nonce}`);
  const timestamp = Math.floor(Date.now() / 1000);
  const measurementRoot = deriveMeasurementRoot({
    areaHash: areaLabel,
    networkType: "4g",
    latencyMs: 28,
    downloadMbps: 91,
    uploadMbps: 0,
    packetLossBps: 0,
    timestampMs: String(timestamp * 1000),
    nonce,
    sessionHash,
    contributorAddress: cc3Signer.address,
  });

  info(`measurementRoot ${measurementRoot}`);
  info(`contributor     ${cc3Signer.address}`);
  const cell = geohashCellSize(areaLabel)!;
  info(`areaHash        ${areaLabel} (cell ${cell.widthM} m x ${cell.heightM} m)`);

  // The contributor signs the same text a wallet would; the registry recovers it on-chain.
  const signature = await cc3Signer.signMessage(
    buildMeasurementSigningMessage({ measurementRoot, contributorAddress: cc3Signer.address }),
  );

  const submitTx = await registry.submitMeasurement(
    measurementRoot, areaHash, cc3Signer.address, sessionHash,
    BigInt(timestamp), 28n, 91n, signature,
  );
  info(`tx ${submitTx.hash} — waiting for inclusion...`);
  const receipt = await submitTx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("source tx reverted");
  ok(`mined in block ${receipt.blockNumber} (${elapsed()})`);
  ok(`https://sepolia.etherscan.io/tx/${receipt.hash}`);

  // ---------------------------------------------------------------- //
  step(2, "Wait for Attestcoin attestation to reach that block");
  info("polling getLatestAttestedHeightAndHash every 20s — expect roughly 7-9 minutes");

  const deadline = Date.now() + 25 * 60 * 1000;
  let attested = 0;
  while (Date.now() < deadline) {
    const latest = await chainInfoProvider.getLatestAttestedHeightAndHash(chainKey);
    attested = Number(latest.height);
    if (attested >= receipt.blockNumber) break;
    info(`attested ${attested} · need ${receipt.blockNumber} · ${receipt.blockNumber - attested} blocks to go (${elapsed()})`);
    await sleep(20_000);
  }
  if (attested < receipt.blockNumber) throw new Error(`timed out waiting for attestation (${elapsed()})`);
  ok(`attested height ${attested} >= ${receipt.blockNumber} (${elapsed()})`);

  // ---------------------------------------------------------------- //
  step(3, "Fetch the inclusion proof");

  const builder = new proofProvider.service.ProofBuilder(
    chainKey, ENV.attestcoinProofServiceUrl, 120_000,
  );
  const result = await builder.getProof(receipt.hash);
  if (!result.success || !result.data) {
    throw new Error(`proof generation failed: ${result.error ?? "unknown"}`);
  }
  const proof = result.data; // ProofResult -> ContinuityResponse
  ok(`headerNumber ${proof.headerNumber} · chainKey ${proof.chainKey}`);
  ok(`merkle siblings ${proof.merkleProof.siblings.length} · continuity roots ${proof.continuityProof.roots?.length ?? 0}`);
  ok(`txBytes ${(proof.txBytes.length - 2) / 2} bytes (${elapsed()})`);

  // ---------------------------------------------------------------- //
  step(4, "Settle on Creditcoin CC3");

  const roots = proof.continuityProof.roots ?? [];
  const args = [
    0, proof.chainKey, proof.headerNumber, proof.txBytes,
    proof.merkleProof.root, proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest, roots,
  ] as const;

  let gasLimit: bigint;
  try {
    const est = await settlement.execute.estimateGas(...args);
    gasLimit = withGasBuffer(est);
    info(`estimated ${est} → limit ${gasLimit} (+35%)`);
  } catch (e) {
    gasLimit = fallbackGasLimit(roots.length);
    info(`estimateGas failed against the precompile as expected; fallback limit ${gasLimit}`);
  }

  const execTx = await settlement.execute(...args, { gasLimit });
  info(`tx ${execTx.hash} — waiting...`);
  const execReceipt = await execTx.wait(1);
  if (!execReceipt || execReceipt.status !== 1) throw new Error("settlement tx reverted");
  ok(`settled in block ${execReceipt.blockNumber}, gas used ${execReceipt.gasUsed} (${elapsed()})`);
  ok(`https://creditcoin-testnet.blockscout.com/tx/${execReceipt.hash}`);

  // ---------------------------------------------------------------- //
  step(5, "Verify the outcome on-chain");

  const verified = execReceipt.logs
    .map((l: { topics: readonly string[]; data: string }) => {
      try { return settlement.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((p: { name: string } | null) => p?.name === "MeasurementVerified");

  if (!verified) throw new Error("MeasurementVerified was not emitted");
  ok(`MeasurementVerified emitted`);
  info(`measurementRoot ${verified.args.measurementRoot}`);
  info(`contributor     ${verified.args.contributor}`);
  info(`reward          ${verified.args.rewardAmount} wei`);

  const settledFlag: boolean = await settlement.settled(measurementRoot);
  const rewardsAfter: bigint = await settlement.rewards(cc3Signer.address);
  if (!settledFlag) throw new Error("settled[measurementRoot] is false");
  ok(`settled[root] = true`);
  ok(`contributor accrued ${rewardsBefore} → ${rewardsAfter} wei`);

  console.log(`\nEnd-to-end complete in ${elapsed()}.`);
  console.log(`  Sepolia   https://sepolia.etherscan.io/tx/${receipt.hash}`);
  console.log(`  Creditcoin https://creditcoin-testnet.blockscout.com/tx/${execReceipt.hash}\n`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
