import type { Chain } from "@/interfaces/chain";
import { isTestnet } from "@/features/buyer-money/gas-help";
import { isEvmChain } from "@/libs/chains/registry";

/**
 * What a buyer pays besides the price, in plain sentences, for the public
 * pages (How it works, a tool's "What a call costs"). Every fact here is one
 * the app already enforces or shows elsewhere; nothing is a new number:
 *
 *  - the price includes Assay's fee (the provider calculator takes the fee out
 *    of the buyer's price: `provider-economics.ts`);
 *  - the minimum deposit is the deposit drawer's (`DEPOSIT_MINIMUM_USD`);
 *  - the token and chain come from `GET /chains`;
 *  - EVM deposits cost gas in ETH, other chains' fees are paid by Assay (the
 *    deposit drawer's own source line);
 *  - sign-in creates a wallet for anyone without one (Privy `createOnLogin`).
 */
export const DEPOSIT_MINIMUM_USD = "5";

export function buyerCostLines(chains: readonly Pick<Chain, "chainId" | "displayName" | "settlementAssetSymbol">[]): string[] {
  const lines = [
    "The listed price includes Assay's fee. Nothing is added on top, and you pay only when the result passes.",
    "Free-tier calls need no deposit: sign in, create an agent key, and call.",
  ];
  const where = chains.length
    ? chains.map((c) => `${c.settlementAssetSymbol} on ${c.displayName}`).join(" or ")
    : null;
  lines.push(
    `Paid calls come from a balance you deposit: at least $${DEPOSIT_MINIMUM_USD}.00${where ? `, in ${where}` : ""}. You can withdraw what you do not spend.`,
  );
  const evm = chains.filter((c) => isEvmChain(c.chainId));
  const other = chains.filter((c) => !isEvmChain(c.chainId));
  const gas: string[] = [];
  if (evm.length) gas.push(`a little ETH on ${evm.map((c) => c.displayName).join(" or ")} for the network fee`);
  if (other.length) gas.push(`no network fee on ${other.map((c) => c.displayName).join(" or ")} (Assay pays it)`);
  lines.push(
    `To deposit you need a wallet (signing in creates one if you have none)${gas.length ? ` and ${gas.join("; ")}` : ""}.`,
  );
  if (chains.length && chains.every((c) => isTestnet(c))) {
    lines.push("This site runs on a test network: the tokens have no real value.");
  }
  return lines;
}
