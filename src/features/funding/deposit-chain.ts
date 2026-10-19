import type { Chain } from "@/interfaces/chain";

/**
 * Which chain a deposit goes to.
 *
 * The backend requires `chainId` only when the buyer has two accounts — the
 * DTO field is optional and `resolveDepositChain` refuses only when the
 * choice is genuinely ambiguous. That changes nothing here: this screen
 * always sends the chain, because the argument for showing it was never about
 * validation.
 *
 * *A deposit is irreversible and unbridgeable. A default is a
 * mechanism for putting money somewhere it can never leave except back to the
 * buyer.* One field on the request and one line on the screen is a very cheap
 * price for removing that, and it costs a one-chain deployment nothing.
 *
 * `none-offered` is not "Solana". `useChains()` is deliberately empty while
 * loading and on error, and a screen that filled the gap with a
 * constant would offer a chain the API may refuse at the moment money moves.
 *
 * There is no `selected` and no `default` field on `choose`, deliberately:
 * a shape with nowhere to put a pre-selection cannot grow one by accident.
 */
export type DepositChoice =
  | { readonly kind: "none-offered" }
  | { readonly kind: "fixed"; readonly chain: Chain }
  | { readonly kind: "choose"; readonly options: readonly Chain[] };

export function depositChoice(chains: readonly Chain[]): DepositChoice {
  if (chains.length === 0) return { kind: "none-offered" };
  if (chains.length === 1) return { kind: "fixed", chain: chains[0] };
  return { kind: "choose", options: chains };
}

/**
 * The chain the screen asked for is the chain the intent was minted on.
 *
 * The backend may **infer** the chain when the buyer has one linked
 * account. That is fine while one chain is enabled and it is a money-losing
 * hole the moment two are: the buyer reads "Robinhood Chain testnet", the
 * intent is minted on Solana, and the deposit lands somewhere the screen never
 * named. So the chain the response names is checked against the one asked for.
 *
 * Throws rather than returning a result: the only correct response is to stop
 * before a wallet is asked to sign, and a boolean invites a caller to ignore it.
 */
export function assertRequirementsChain(
  requested: string,
  requirementsChainId: string,
): void {
  if (requirementsChainId === requested) return;
  throw new Error(
    `The deposit was created on ${requirementsChainId}, not the ${requested} you chose. ` +
      "Nothing was signed and no money moved.",
  );
}
