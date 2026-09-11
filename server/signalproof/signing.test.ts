import { describe, expect, it } from "vitest";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { buildMeasurementSigningMessage } from "../../shared/measurement";

/**
 * The registry rebuilds this exact text on-chain and recovers the signer from it, so TypeScript
 * and Solidity must agree byte for byte. This test pins the text, and the vector it prints is
 * hardcoded in contracts/test/SourceBatchRegistry.t.sol (VECTOR_*). If the message ever changes,
 * regenerate both together — a mismatch means every browser submission is refused on Sepolia.
 */

// Anvil default account #1 — a public test key, never used on any chain.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ROOT = keccak256(toUtf8Bytes("signalproof-signing-vector"));

describe("signing message vector", () => {
  it("is the exact text the registry rebuilds on-chain", async () => {
    const wallet = new Wallet(KEY);
    const message = buildMeasurementSigningMessage({
      measurementRoot: ROOT,
      contributorAddress: wallet.address,
    });

    expect(message).toBe(
      "SignalProof — confirm this measurement\n\n" +
        "Signing proves this measurement is yours, so the reward is credited to your address.\n" +
        "It authorises no transaction and cannot move your funds.\n\n" +
        `Measurement: ${ROOT}\n` +
        `Contributor: ${wallet.address.toLowerCase()}`,
    );

    const signature = await wallet.signMessage(message);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);

    // The values the Solidity test pins. Printed so they can be copied, never computed there.
    console.log(JSON.stringify({ root: ROOT, contributor: wallet.address, signature }));
  });
});
