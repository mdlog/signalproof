/**
 * The buyer's API key on this browser.
 *
 * Kept in localStorage only as a convenience for the dashboard's own brief/export buttons; the
 * key itself is stateless and can always be re-derived by signing for the same payment again.
 */

const STORAGE_KEY = "signalproof.accessKey";

export type StoredAccess = { key: string; expiresAt: string; txHash: string };

export type AccessTerms = {
  enabled: boolean;
  price: string;
  priceWei: string;
  days: number;
  payTo: string;
  chainId: number;
  whatItFunds: string;
};

export function getStoredAccess(): StoredAccess | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAccess;
    if (!parsed.key || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeAccess(access: StoredAccess): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(access));
  } catch {
    /* private mode — the key is still shown on screen */
  }
}

export function clearAccess(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Headers for a metered call: the Bearer key when one is stored, nothing otherwise. */
export function accessHeaders(): Record<string, string> {
  const access = getStoredAccess();
  return access ? { Authorization: `Bearer ${access.key}` } : {};
}

/** A metered URL a browser can open directly: the stored key travels as `?key=`, since a link cannot send a header. */
export function withAccessKey(path: string): string {
  const access = getStoredAccess();
  if (!access) return path;
  return `${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(access.key)}`;
}

export async function fetchAccessTerms(): Promise<AccessTerms> {
  const res = await fetch("/v1/access", { cache: "no-store" });
  if (!res.ok) throw new Error(`The access endpoint answered ${res.status}.`);
  return (await res.json()) as AccessTerms;
}

/** The exact text the wallet signs; must match `buildAccessSigningMessage` on the server. */
export function buildAccessSigningMessage(txHash: string, address: string): string {
  return `SignalProof API access\nTransaction: ${txHash.toLowerCase()}\nAddress: ${address}`;
}

export type RedeemResult =
  | { ok: true; key: string; expiresAt: string; txHash: string; curl: string }
  | { ok: false; code: string; detail?: string };

export async function redeemAccess(args: { txHash: string; address: string; signature: string }): Promise<RedeemResult> {
  const res = await fetch("/v1/access/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) return { ok: false, code: body.error ?? `HTTP_${res.status}`, detail: body.detail };
  return { ok: true, key: body.key, expiresAt: body.expiresAt, txHash: body.txHash, curl: body.curl };
}

/**
 * What a 401 from a metered endpoint says, in the API's own words. Returned as text for the UI to
 * show as-is — the refusal is the product's real answer, not something to paper over.
 */
export async function describeAccessRefusal(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; detail?: string; price?: string; days?: number };
    if (body.error === "ACCESS_REQUIRED") {
      return `${body.detail ?? "API key required."} A key costs ${body.price ?? "CTC"} for ${body.days ?? 30} days and funds the contributor reward pool — see Data products.`;
    }
    return body.detail ?? body.error ?? `The buyer API answered ${res.status}.`;
  } catch {
    return `The buyer API answered ${res.status}.`;
  }
}
