import { api } from "./api";

/** `POST /auth/wallet/link` — what our own row says, never an echo of anything we sent. */
export interface WalletLinkResult {
  linked: boolean;
  account: string | null;
  chainId: string | null;
}

/**
 * Tells the API that Privy has the wallet now, and reads back whether it stuck.
 *
 * Deliberately no arguments. The browser knows *when* the wallet appeared,
 * which is the useful half; it is not trusted with *which* address — the API
 * re-reads that from Privy's own user record. A body here would be a caller
 * naming the account its money is spent from.
 */
export function linkWallet(): Promise<WalletLinkResult> {
  return api.post<WalletLinkResult>("/auth/wallet/link");
}
