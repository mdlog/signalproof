import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { SIGNAL_PROOF_SETTLEMENT_ABI } from "./abi";
import { BLOCK_PROVER_PRECOMPILE, SELF_SETTLE_GAS_LIMIT, buildExecuteArgs, selfSettleGasLimit, summarizeProof, type ProofData } from "./proofView";

/**
 * The proof inspector shows a judge the live Attestcoin proof for a measurement, and the
 * self-settle button sends exactly the arguments the worker would. Both derive from one proof
 * object, so both are pinned here against a proof shaped like the service actually returns.
 */
const proof: ProofData = {
  chainKey: 1,
  headerNumber: 11_681_452,
  txIndex: 42,
  txHash: "0xbd7261e655c751f9a38acc116808acd3a0c0b0fd14279fe4fad207c742d57223",
  txBytes: "0x" + "02f8".padEnd(3_904, "ab"),
  continuityProof: {
    lowerEndpointDigest: "0x" + "cd".repeat(32),
    roots: ["0x" + "01".repeat(32), "0x" + "02".repeat(32), "0x" + "03".repeat(32)],
  },
  merkleProof: {
    root: "0x" + "ee".repeat(32),
    siblings: [
      { hash: "0x" + "10".repeat(32), isLeft: true },
      { hash: "0x" + "11".repeat(32), isLeft: false },
    ],
  },
  cached: false,
  generatedAt: new Date("2026-09-11T10:00:00Z"),
};

describe("buildExecuteArgs", () => {
  it("lays out the execute() tuple in the order ASCBase expects", () => {
    const args = buildExecuteArgs(proof);
    expect(args).toEqual([
      0,
      1,
      11_681_452,
      proof.txBytes,
      "0x" + "ee".repeat(32),
      [
        { hash: "0x" + "10".repeat(32), isLeft: true },
        { hash: "0x" + "11".repeat(32), isLeft: false },
      ],
      "0x" + "cd".repeat(32),
      ["0x" + "01".repeat(32), "0x" + "02".repeat(32), "0x" + "03".repeat(32)],
    ]);
  });

  it("treats missing continuity roots as an empty list rather than undefined", () => {
    const bare = { ...proof, continuityProof: { ...proof.continuityProof, roots: undefined as unknown as string[] } };
    expect(buildExecuteArgs(bare)[7]).toEqual([]);
  });
});

describe("selfSettleGasLimit", () => {
  it("never hands a wallet less than a measured single settlement needs", () => {
    expect(selfSettleGasLimit(0)).toBeGreaterThanOrEqual(150_640n);
    expect(selfSettleGasLimit(6)).toBeGreaterThanOrEqual(150_640n);
  });
  it("grows with very long continuity proofs instead of capping", () => {
    expect(selfSettleGasLimit(200)).toBeGreaterThan(SELF_SETTLE_GAS_LIMIT);
  });
});

describe("summarizeProof", () => {
  it("describes the proof in the terms the dashboard shows", () => {
    const view = summarizeProof(proof, "0xbd7261e655c751f9a38acc116808acd3a0c0b0fd14279fe4fad207c742d57223");
    expect(view.sourceTxHash).toBe(proof.txHash);
    expect(view.chainKey).toBe(1);
    expect(view.attestedHeight).toBe(11_681_452);
    expect(view.txBytesLength).toBe(1_952);
    expect(view.merkle.root).toBe("0x" + "ee".repeat(32));
    expect(view.merkle.siblingCount).toBe(2);
    expect(view.merkle.siblings[0]).toEqual({ hash: "0x" + "10".repeat(32), isLeft: true });
    expect(view.continuity.rootCount).toBe(3);
    expect(view.continuity.lowerEndpointDigest).toBe("0x" + "cd".repeat(32));
    expect(view.precompile).toBe(BLOCK_PROVER_PRECOMPILE);
    expect(view.execute.gasLimit).toBe(SELF_SETTLE_GAS_LIMIT.toString());
  });

  it("encodes calldata a wallet can send as-is, matching the execute() selector and arguments", () => {
    const view = summarizeProof(proof, proof.txHash);
    expect(view.execute.calldata.startsWith("0xc6339bf7")).toBe(true);
    const iface = new Interface(SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[]);
    const decoded = iface.decodeFunctionData("execute", view.execute.calldata);
    expect(Number(decoded[1])).toBe(1);
    expect(Number(decoded[2])).toBe(11_681_452);
    expect(decoded[3]).toBe(proof.txBytes);
    expect(decoded[7].length).toBe(3);
  });

  it("serialises the execute arguments so a browser can send them without bigint surprises", () => {
    const view = summarizeProof(proof, proof.txHash);
    expect(() => JSON.stringify(view)).not.toThrow();
    expect(view.execute.args[1]).toBe("1");
    expect(view.execute.args[2]).toBe("11681452");
    expect(view.execute.args[5]).toEqual(proof.merkleProof.siblings);
  });
});
