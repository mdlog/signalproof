/**
 * Fetch and summarise the Attestcoin proof for a source transaction, keylessly.
 *
 * The proof service answers in a few seconds once the block is attested and refuses before that,
 * so the answer is cached briefly per transaction and a refusal is reported as NOT_ATTESTED_YET
 * rather than as a failure. Nothing here can spend anything.
 */

import { getReadContext } from "./chain";
import { summarizeProof, type ProofSummary } from "./proofView";

export type ProofLookup =
  | { ok: true; proof: ProofSummary }
  | { ok: false; code: "NOT_ATTESTED_YET" | "PROOF_SERVICE_ERROR"; detail: string };

const cache = new Map<string, { at: number; value: ProofLookup }>();
const CACHE_TTL_MS = 60_000;

export function classifyProofError(message: string): "NOT_ATTESTED_YET" | "PROOF_SERVICE_ERROR" {
  return /not (yet )?attested|attestation|not found|no header|height/i.test(message)
    ? "NOT_ATTESTED_YET"
    : "PROOF_SERVICE_ERROR";
}

export async function getProofSummary(sourceTxHash: string): Promise<ProofLookup> {
  const key = sourceTxHash.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: ProofLookup;
  try {
    const ctx = await getReadContext();
    const result = await ctx.proofBuilder.getProof(sourceTxHash);
    if (!result.success || !result.data) {
      const detail = result.error ?? "unknown";
      value = { ok: false, code: classifyProofError(detail), detail: detail.slice(0, 200) };
    } else {
      value = { ok: true, proof: summarizeProof(result.data, sourceTxHash) };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    value = { ok: false, code: classifyProofError(detail), detail: detail.slice(0, 200) };
  }

  // Only a successful proof is worth remembering; a refusal should be retried on the next click.
  if (value.ok) cache.set(key, { at: Date.now(), value });
  return value;
}
