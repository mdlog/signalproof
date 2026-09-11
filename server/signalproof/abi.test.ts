import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface, id } from "ethers";
import { describe, expect, it } from "vitest";
import {
  CC3_TESTNET_CHAIN_ID,
  EXECUTE_SELECTOR,
  MEASUREMENT_SUBMITTED_TOPIC,
  SEPOLIA_CHAIN_ID,
  SIGNAL_PROOF_BATCH_ABI,
  SIGNAL_PROOF_SETTLEMENT_ABI,
  SOURCE_BATCH_REGISTRY_ABI,
} from "./abi";

const ROOT = resolve(__dirname, "../..");

/**
 * These ABIs are hand-written literals rather than imports of the Foundry build output, so that
 * the server bundle carries no filesystem dependency on contracts/out. The trade-off is drift:
 * a change to a Solidity signature would leave the relayer encoding calldata nobody can decode.
 * These tests are what makes that trade-off safe.
 */
describe("ABI constants", () => {
  it("pins the ASCBase.execute selector documented by the Attestcoin reference implementation", () => {
    const iface = new Interface(SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[]);
    const fragment = iface.getFunction("execute");
    expect(fragment).not.toBeNull();
    expect(fragment!.selector).toBe(EXECUTE_SELECTOR);
  });

  it("does not confuse the tuple-array encoding", () => {
    // Hand-keccaking the literal string with "tuple(...)" in it yields 0x97cdec1a, which is wrong.
    // This asserts we resolved through ethers rather than by string manipulation.
    const wrong = id(
      "execute(uint8,uint64,uint64,bytes,bytes32,tuple(bytes32,bool)[],bytes32,bytes32[])",
    ).slice(0, 10);
    expect(EXECUTE_SELECTOR).not.toBe(wrong);
    expect(EXECUTE_SELECTOR).toBe(
      id("execute(uint8,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[])").slice(
        0,
        10,
      ),
    );
  });

  it("pins the MeasurementSubmitted topic the settlement contract filters on", () => {
    const iface = new Interface(SOURCE_BATCH_REGISTRY_ABI as unknown as string[]);
    const event = iface.getEvent("MeasurementSubmitted");
    expect(event).not.toBeNull();
    expect(event!.topicHash).toBe(MEASUREMENT_SUBMITTED_TOPIC);
  });

  it("keeps contributor indexed — the destination chain reads it from topics[3]", () => {
    const iface = new Interface(SOURCE_BATCH_REGISTRY_ABI as unknown as string[]);
    const event = iface.getEvent("MeasurementSubmitted")!;
    const indexed = event.inputs.filter((i) => i.indexed).map((i) => i.name);
    expect(indexed).toEqual(["measurementRoot", "areaHash", "contributor"]);
  });

  it("pins the claim() selector the browser wallet sends as raw calldata", () => {
    // client/src/hooks/useWallet.ts sends this 4-byte selector with no ABI and no contract
    // instance, so nothing else would catch it drifting.
    const iface = new Interface(SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[]);
    expect(iface.getFunction("claim")!.selector).toBe("0x4e71d92d");
  });

  it("keeps the chain ids distinct and correct", () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
    // 102032 is Devnet and 102030 is Mainnet. Proving against either would be silently wrong.
    expect(CC3_TESTNET_CHAIN_ID).toBe(102031);
  });
});

/**
 * Cross-check against the compiled artifacts when they are present.
 *
 * Skipped rather than failed when contracts/out is absent, so `pnpm test` still works on a clean
 * clone that has not run `forge build`.
 */
describe("ABI matches the compiled contracts", () => {
  const settlementArtifact = resolve(
    ROOT,
    "contracts/out/SignalProofSettlement.sol/SignalProofSettlement.json",
  );
  const registryArtifact = resolve(
    ROOT,
    "contracts/out/SourceBatchRegistry.sol/SourceBatchRegistry.json",
  );
  const built = existsSync(settlementArtifact) && existsSync(registryArtifact);

  it.skipIf(!built)("execute selector matches the compiled settlement contract", () => {
    const artifact = JSON.parse(readFileSync(settlementArtifact, "utf8"));
    const compiled = new Interface(artifact.abi);
    expect(compiled.getFunction("execute")!.selector).toBe(EXECUTE_SELECTOR);
  });

  it.skipIf(!built)("MeasurementSubmitted topic matches the compiled registry", () => {
    const artifact = JSON.parse(readFileSync(registryArtifact, "utf8"));
    const compiled = new Interface(artifact.abi);
    expect(compiled.getEvent("MeasurementSubmitted")!.topicHash).toBe(MEASUREMENT_SUBMITTED_TOPIC);
  });

  it.skipIf(!built)("every function this server calls exists on the compiled contracts", () => {
    const settlement = new Interface(
      JSON.parse(readFileSync(settlementArtifact, "utf8")).abi,
    );
    const registry = new Interface(JSON.parse(readFileSync(registryArtifact, "utf8")).abi);

    for (const name of ["execute", "settled", "rewards", "claim", "sourceRegistry"]) {
      expect(settlement.getFunction(name), `settlement.${name} missing`).not.toBeNull();
    }
    for (const name of ["submitMeasurement", "registered"]) {
      expect(registry.getFunction(name), `registry.${name} missing`).not.toBeNull();
    }
  });

  it.skipIf(!built)(
    "the settlement contract's own event signature constant matches the registry",
    () => {
      // SignalProofSettlement hardcodes MEASUREMENT_SUBMITTED_SIG as a compile-time keccak. If the
      // registry's event ever changes shape, the settlement contract would silently match nothing
      // and every proof would fail with NoMeasurementLog.
      const registry = new Interface(JSON.parse(readFileSync(registryArtifact, "utf8")).abi);
      expect(registry.getEvent("MeasurementSubmitted")!.topicHash).toBe(
        id("MeasurementSubmitted(bytes32,bytes32,address,bytes32,uint256,uint256,uint256)"),
      );
    },
  );
});

describe("the two settlement routes emit different MeasurementVerified events", () => {
  const topic0 = (abi: readonly string[]) =>
    new Interface(abi as unknown as string[]).getEvent("MeasurementVerified")!.topicHash;

  it("have different topic0, so one cannot be scanned with the other's", () => {
    // The single-proof event carries ASCBase's `queryId`; the batch has none to carry, because one
    // proof covers many measurements. Scanning the batch contract for the single contract's topic
    // returns zero logs with no error — measurements stay "awaiting" forever after being paid.
    // This assertion exists so that stops being a silent failure.
    expect(topic0(SIGNAL_PROOF_SETTLEMENT_ABI)).not.toBe(topic0(SIGNAL_PROOF_BATCH_ABI));
  });

  it("agree on the fields the dashboard joins on", () => {
    // Different signatures are fine; different meanings would not be. Both must expose the root,
    // the area, the contributor and the reward under the same names and positions.
    for (const abi of [SIGNAL_PROOF_SETTLEMENT_ABI, SIGNAL_PROOF_BATCH_ABI]) {
      const inputs = new Interface(abi as unknown as string[]).getEvent("MeasurementVerified")!
        .inputs;
      expect(inputs.slice(0, 4).map((i) => `${i.name}:${i.type}`)).toEqual([
        "measurementRoot:bytes32",
        "areaHash:bytes32",
        "contributor:address",
        "rewardAmount:uint256",
      ]);
      expect(inputs.slice(0, 3).every((i) => i.indexed)).toBe(true);
    }
  });
})
