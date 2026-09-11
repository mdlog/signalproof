/**
 * Live smoke test against Creditcoin CC3 Testnet.
 *
 * Proves the Attestcoin read path works from this machine before a single contract is deployed:
 * the RPC answers, the ChainInfo precompile is callable, Ethereum Sepolia is an attested source
 * chain, and attestation is actually progressing.
 *
 * Deliberately read-only — no key, no gas, no transaction. Run it any time the pipeline looks
 * wrong to find out whether the problem is ours or the network's.
 *
 *   pnpm smoke
 */

import { JsonRpcProvider } from "ethers";
import { chainInfo } from "@gluwa/usc-sdk";
import { CC3_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from "./abi";

const CC3_RPC = process.env.CREDITCOIN_RPC_URL || "https://rpc.cc3-testnet.creditcoin.network";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);

async function main() {
  let failures = 0;
  const fail = (m: string) => {
    bad(m);
    failures++;
  };

  console.log("\nSignalProof — Attestcoin live smoke test");
  console.log(`  CC3 RPC:     ${CC3_RPC}`);
  console.log(`  Sepolia RPC: ${SEPOLIA_RPC}\n`);

  // 1 — both RPCs reachable and pointing at the chains we think they are.
  console.log("[1] RPC reachability and chain identity");
  const cc3 = new JsonRpcProvider(CC3_RPC, undefined, { staticNetwork: true });
  const sepolia = new JsonRpcProvider(SEPOLIA_RPC, undefined, { staticNetwork: true });

  const cc3Net = await cc3.getNetwork();
  Number(cc3Net.chainId) === CC3_TESTNET_CHAIN_ID
    ? ok(`CC3 chain id ${cc3Net.chainId}`)
    : fail(`CC3 chain id ${cc3Net.chainId}, expected ${CC3_TESTNET_CHAIN_ID}`);

  const sepoliaNet = await sepolia.getNetwork();
  Number(sepoliaNet.chainId) === SEPOLIA_CHAIN_ID
    ? ok(`Sepolia chain id ${sepoliaNet.chainId}`)
    : fail(`Sepolia chain id ${sepoliaNet.chainId}, expected ${SEPOLIA_CHAIN_ID}`);

  const [cc3Head, sepoliaHead] = await Promise.all([cc3.getBlockNumber(), sepolia.getBlockNumber()]);
  ok(`CC3 head block ${cc3Head}`);
  ok(`Sepolia head block ${sepoliaHead}`);

  // 2 — chain key resolution. Matching on chainId, never on chainName.
  console.log("\n[2] Attestcoin ChainInfo precompile");
  const provider = new chainInfo.PrecompileChainInfoProvider(cc3);
  ok(`precompile address ${chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS}`);

  const chains = await provider.getSupportedChains();
  ok(`${chains.length} supported source chain(s)`);
  for (const c of chains) {
    console.log(`      chainKey=${c.chainKey}  chainId=${c.chainId}  name="${c.chainName}"`);
  }

  const sepoliaEntry = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);
  if (!sepoliaEntry) {
    fail(`Ethereum Sepolia (${SEPOLIA_CHAIN_ID}) is not an attested source chain here`);
    console.log(`\n${failures} check(s) failed.\n`);
    process.exit(1);
  }
  const chainKey = Number(sepoliaEntry.chainKey);
  ok(`resolved chainKey=${chainKey} for Sepolia`);

  // The name the chain reports differs from the SDK docs. Matching on it would find nothing.
  if (sepoliaEntry.chainName !== "Ethereum Sepolia") {
    ok(`chainName is "${sepoliaEntry.chainName}" — confirms matching on chainId is required`);
  }

  // 3 — attestation is live and moving.
  console.log("\n[3] Attestation progress");
  const first = await provider.getLatestAttestedHeightAndHash(chainKey);
  const firstHeight = Number(first.height);
  ok(`latest attested Sepolia height ${firstHeight}`);

  const lag = sepoliaHead - firstHeight;
  console.log(`      lag behind Sepolia head: ${lag} blocks (~${(lag * 12 / 60).toFixed(1)} min)`);
  if (lag < 0) fail("attested height is ahead of the Sepolia head — RPCs disagree");
  else if (lag > 200) fail(`attestation lag ${lag} blocks is far beyond the expected 34-41`);
  else ok("lag is within the expected operating range");

  const genesis = await provider.getAttestationGenesisHeight(chainKey);
  ok(`attestation genesis height ${genesis}`);

  // 4 — a specific height can be located, which is what the proof path needs.
  console.log("\n[4] Continuity bounds for an attested height");
  const probe = firstHeight - 5;
  const bounds = await provider.getContinuityBounds(chainKey, probe);
  ok(
    `height ${probe} bracketed by parent=${bounds.parentHeight} child=${bounds.childHeight}` +
      ` (attested=${bounds.isAttested})`,
  );
  if (!bounds.isAttested) {
    fail(`height ${probe} reports not attested despite being below the latest attested height`);
  }

  console.log(
    failures === 0
      ? `\nAll checks passed. The Attestcoin read path is live from this machine.\n` +
          `Use chainKey=${chainKey}; expect ~${(lag * 12 / 60).toFixed(0)} minutes from a Sepolia tx to a provable one.\n`
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nSmoke test threw:", error instanceof Error ? error.message : error);
  process.exit(1);
});
