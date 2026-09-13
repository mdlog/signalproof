/**
 * Which wallet to talk to when a browser has several.
 *
 * EIP-6963 makes every installed wallet announce itself; the order is the extensions' load order,
 * not the user's preference. Taking the first one sent "Connect wallet" to whichever extension
 * happened to answer first — and its refusal read as if the user had refused. The rule here is
 * the obvious one: one wallet connects on its own, a remembered wallet connects on its own, and
 * several wallets with nothing remembered means ask.
 */

export type WalletInfo = { uuid: string; name: string; rdns: string; icon: string };

export type WalletChoice =
  | { kind: "none" }
  | { kind: "pick"; wallet: WalletInfo }
  | { kind: "ask"; wallets: WalletInfo[] };

/** The localStorage key under which the chosen wallet's rdns is remembered. */
export const WALLET_PREFERENCE_KEY = "signalproof.wallet.rdns";

export function pickWallet(found: WalletInfo[], preferredRdns: string | null): WalletChoice {
  if (found.length === 0) return { kind: "none" };
  if (preferredRdns) {
    const remembered = found.find((w) => w.rdns === preferredRdns);
    if (remembered) return { kind: "pick", wallet: remembered };
  }
  if (found.length === 1) return { kind: "pick", wallet: found[0] };
  return { kind: "ask", wallets: found };
}

/** Some extensions announce twice (Backpack does); keep the first announcement per uuid. */
export function dedupeAnnouncements<T extends { uuid: string }>(found: T[]): T[] {
  const seen = new Set<string>();
  return found.filter((w) => (seen.has(w.uuid) ? false : (seen.add(w.uuid), true)));
}
