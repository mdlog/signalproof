/**
 * One proof object, two consumers.
 *
 * The worker settles with `buildExecuteArgs`; the dashboard's proof inspector and the "settle from
 * my wallet" button consume `summarizeProof`, which carries the same arguments in a JSON-safe
 * shape. Deriving both from one place means what a judge sees on screen is literally what is
 * sent to the BlockProver precompile.
 */

import type { proofProvider } from "@gluwa/usc-sdk";
import { Interface } from "ethers";
import { SIGNAL_PROOF_SETTLEMENT_ABI } from "./abi";
import { fallbackGasLimit } from "./worker";

const settlementInterface = new Interface(SIGNAL_PROOF_SETTLEMENT_ABI as unknown as string[]);

/**
 * Gas limit handed to a browser wallet for a self-settle.
 *
 * A single settlement measured 150,640 gas live (6 continuity roots) and the batch probe puts a
 * one-entry verification at 77,828; `fallbackGasLimit` models only the precompile call and is far
 * too low for the whole execute(). Wallets also estimate first, so this is the ceiling, not the
 * cost: CC3 gas is 0.5 gwei and unused gas is refunded.
 */
export const SELF_SETTLE_GAS_LIMIT = 400_000n;

export function selfSettleGasLimit(continuityRootCount: number): bigint {
  const modelled = fallbackGasLimit(continuityRootCount) * 3n;
  return modelled > SELF_SETTLE_GAS_LIMIT ? modelled : SELF_SETTLE_GAS_LIMIT;
}

export type ProofData = proofProvider.ContinuityResponse;

/** Attestcoin BlockProver precompile on Creditcoin — the verifier `ASCBase.execute()` calls. */
export const BLOCK_PROVER_PRECOMPILE = "0x0000000000000000000000000000000000000FD2";

export type MerkleSibling = { hash: string; isLeft: boolean };

/**
 * Arguments for `execute(uint8,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[])`,
 * selector 0xc6339bf7. Action 0: a single-purpose ASC has one dispatch path.
 */
export type ExecuteArgs = readonly [
  action: number,
  chainKey: number,
  blockHeight: number,
  encodedTransaction: string,
  merkleRoot: string,
  siblings: MerkleSibling[],
  lowerEndpointDigest: string,
  continuityRoots: string[],
];

export function buildExecuteArgs(proof: ProofData): ExecuteArgs {
  return [
    0,
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots ?? [],
  ];
}

export type ProofSummary = {
  sourceTxHash: string;
  chainKey: number;
  attestedHeight: number;
  txIndex: number;
  /** Length of the RLP-encoded source transaction + receipt the precompile decodes. */
  txBytesLength: number;
  merkle: { root: string; siblingCount: number; siblings: MerkleSibling[] };
  continuity: { lowerEndpointDigest: string; rootCount: number; roots: string[] };
  precompile: string;
  /**
   * What `execute()` is called with — numbers as decimal strings so JSON and wallets agree — and
   * the ABI-encoded calldata, so a wallet can send it exactly as the relayer would.
   */
  execute: { selector: "0xc6339bf7"; args: unknown[]; calldata: string; gasLimit: string };
  cached: boolean;
  generatedAt: string;
};

export function summarizeProof(proof: ProofData, sourceTxHash: string): ProofSummary {
  const args = buildExecuteArgs(proof);
  const roots = proof.continuityProof.roots ?? [];
  return {
    sourceTxHash: proof.txHash || sourceTxHash,
    chainKey: proof.chainKey,
    attestedHeight: proof.headerNumber,
    txIndex: proof.txIndex,
    txBytesLength: Math.max(0, (proof.txBytes.length - 2) / 2),
    merkle: {
      root: proof.merkleProof.root,
      siblingCount: proof.merkleProof.siblings.length,
      siblings: args[5],
    },
    continuity: {
      lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
      rootCount: roots.length,
      roots,
    },
    precompile: BLOCK_PROVER_PRECOMPILE,
    execute: {
      selector: "0xc6339bf7",
      args: [args[0], String(args[1]), String(args[2]), args[3], args[4], args[5], args[6], args[7]],
      calldata: settlementInterface.encodeFunctionData("execute", [...args]),
      gasLimit: selfSettleGasLimit(roots.length).toString(),
    },
    cached: proof.cached,
    generatedAt: proof.generatedAt instanceof Date ? proof.generatedAt.toISOString() : String(proof.generatedAt),
  };
}
