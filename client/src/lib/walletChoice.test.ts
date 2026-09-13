import { describe, expect, it } from "vitest";
import { dedupeAnnouncements, pickWallet, type WalletInfo } from "./walletChoice";

/**
 * A browser with several wallet extensions announces all of them through EIP-6963, in an order the
 * user did not choose. Picking the first one sent every "Connect wallet" click to Rabby on a
 * machine where the user meant MetaMask, and Rabby's refusal surfaced as "You rejected the
 * connection request". The rule: one wallet connects silently, a remembered wallet connects
 * silently, several wallets with no memory means ask.
 */
const rabby: WalletInfo = { uuid: "1", name: "Rabby Wallet", rdns: "io.rabby", icon: "" };
const metamask: WalletInfo = { uuid: "2", name: "MetaMask", rdns: "io.metamask", icon: "" };
const okx: WalletInfo = { uuid: "3", name: "OKX Wallet", rdns: "com.okex.wallet", icon: "" };

describe("pickWallet", () => {
  it("connects the only wallet without asking", () => {
    expect(pickWallet([metamask], null)).toEqual({ kind: "pick", wallet: metamask });
  });

  it("asks when several wallets are installed and none was chosen before", () => {
    expect(pickWallet([rabby, metamask, okx], null)).toEqual({ kind: "ask", wallets: [rabby, metamask, okx] });
  });

  it("uses the remembered wallet when it is still installed, whatever its position", () => {
    expect(pickWallet([rabby, metamask, okx], "io.metamask")).toEqual({ kind: "pick", wallet: metamask });
  });

  it("asks again when the remembered wallet was uninstalled", () => {
    expect(pickWallet([rabby, okx], "io.metamask")).toEqual({ kind: "ask", wallets: [rabby, okx] });
  });

  it("reports nothing to connect when no wallet announced itself", () => {
    expect(pickWallet([], null)).toEqual({ kind: "none" });
  });
});

describe("dedupeAnnouncements", () => {
  it("keeps one entry per wallet even when an extension announces itself twice", () => {
    const twice = [rabby, metamask, { ...metamask }, okx];
    expect(dedupeAnnouncements(twice).map((w) => w.name)).toEqual(["Rabby Wallet", "MetaMask", "OKX Wallet"]);
  });
});
