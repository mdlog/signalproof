/**
 * Operations status — what it takes to keep the rail running, read live.
 *
 * Relayer balances on both chains, the reward pool and how many settlements it still funds, the
 * proof worker's last tick, the chain reader's health, and the attestation lag. Every probe is
 * its own try/catch: a dead RPC is reported on its row, it never takes the panel down. No secret
 * appears here — relayer addresses are derived from the keys and are public on the explorers.
 */

import { JsonRpcProvider, Wallet } from "ethers";
import { chainInfo } from "@gluwa/usc-sdk";
import { ENV } from "../_core/env";
import { SEPOLIA_CHAIN_ID } from "./abi";
import { getOnchainSnapshot, snapshotHealth, type SnapshotHealth } from "./chainRead";
import { workerHealth, type WorkerHealth } from "./proofWorker";

export type BalanceRow = { address: string | null; balanceWei: string | null; error: string | null };

export type OpsStatus = {
  relayer: { sepolia: BalanceRow; creditcoin: BalanceRow };
  pool: { balanceWei: string; rewardWei: string; runway: number | null; settlementAddress: string };
  worker: WorkerHealth;
  snapshot: SnapshotHealth & { configured: boolean; measurements: number; error: string | null };
  attestation: { attestedHeight: number; sepoliaHead: number; lag: number; error: string | null };
  generatedAt: string;
};

/** Whole settlements the pool can still pay at the current reward; null when the reward is zero. */
export function poolRunway(poolWei: bigint, rewardWei: bigint): number | null {
  if (rewardWei <= 0n) return null;
  return Number(poolWei / rewardWei);
}

async function balanceRow(rpcUrl: string, privateKey: string): Promise<BalanceRow> {
  if (!privateKey) return { address: null, balanceWei: null, error: "no relayer key configured" };
  let address: string;
  try {
    address = new Wallet(privateKey).address;
  } catch {
    return { address: null, balanceWei: null, error: "relayer key is not a valid private key" };
  }
  if (!rpcUrl) return { address, balanceWei: null, error: "no RPC URL configured" };
  try {
    const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
    const balance = await provider.getBalance(address);
    return { address, balanceWei: balance.toString(), error: null };
  } catch (error) {
    return { address, balanceWei: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
  }
}

async function attestationRow(): Promise<OpsStatus["attestation"]> {
  const empty = { attestedHeight: 0, sepoliaHead: 0, lag: 0, error: null as string | null };
  if (!ENV.creditcoinRpcUrl || !ENV.sepoliaRpcUrl) return { ...empty, error: "chain not configured" };
  try {
    const creditcoin = new JsonRpcProvider(ENV.creditcoinRpcUrl, undefined, { staticNetwork: true });
    const sepolia = new JsonRpcProvider(ENV.sepoliaRpcUrl, undefined, { staticNetwork: true });
    const provider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
    const chains = await provider.getSupportedChains();
    const entry = chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID);
    if (!entry) return { ...empty, error: "Sepolia is not attested on this network" };
    const [latest, sepoliaHead] = await Promise.all([
      provider.getLatestAttestedHeightAndHash(Number(entry.chainKey)),
      sepolia.getBlockNumber(),
    ]);
    const attestedHeight = Number(latest.height);
    return { attestedHeight, sepoliaHead, lag: Math.max(0, sepoliaHead - attestedHeight), error: null };
  } catch (error) {
    return { ...empty, error: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
  }
}

export async function getOpsStatus(): Promise<OpsStatus> {
  const [sepolia, creditcoin, snapshot, attestation] = await Promise.all([
    balanceRow(ENV.sepoliaRpcUrl, ENV.sepoliaRelayerPrivateKey),
    balanceRow(ENV.creditcoinRpcUrl, ENV.creditcoinRelayerPrivateKey),
    getOnchainSnapshot(),
    attestationRow(),
  ]);
  const poolWei = BigInt(snapshot.poolBalance || "0");
  const rewardWei = BigInt(snapshot.rewardAmount || "0");
  return {
    relayer: { sepolia, creditcoin },
    pool: {
      balanceWei: poolWei.toString(),
      rewardWei: rewardWei.toString(),
      runway: poolRunway(poolWei, rewardWei),
      settlementAddress: snapshot.settlementAddress,
    },
    worker: { ...workerHealth },
    snapshot: {
      ...snapshotHealth,
      configured: snapshot.configured,
      measurements: snapshot.totals.submitted,
      error: snapshot.error,
    },
    attestation,
    generatedAt: new Date().toISOString(),
  };
}
