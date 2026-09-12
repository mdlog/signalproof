/**
 * One wallet connection for the whole app.
 *
 * `useWallet()` owns provider discovery and the EIP-1193 event subscriptions, so it must be
 * instantiated exactly once. The shell (header control, wrong-chain banner), the console and every
 * route page read it from here rather than each opening their own connection.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useWallet } from "@/hooks/useWallet";

export type WalletApi = ReturnType<typeof useWallet>;

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  return <Ctx.Provider value={wallet}>{children}</Ctx.Provider>;
}

export function useWalletContext(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWalletContext must be used inside <WalletProvider>");
  return v;
}
