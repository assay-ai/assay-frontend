import { isEvmChain } from "@/libs/chains/registry";

/**
 * What the withdraw screen may truthfully say about gas.
 *
 * On `eip155`, `withdraw()` is `msg.sender`-only: `requestWithdraw`
 * already served the delay, so past that point a phished signature would drain
 * the escrow with no remaining brake — requiring the buyer's own transaction
 * means an attacker needs the address itself. The consequence is that a buyer
 * holding USDG and no ETH cannot get out.
 *
 * The platform's answer is a **bounded, once-per-address-ever gas grant**
 * with six refusal reasons, five of which are invisible from this
 * screen: `ALREADY_GRANTED` (a unique index — once per address, ever, not a
 * rate limit), `NO_MATURED_WITHDRAWAL`, `BUYER_HAS_GAS`, `ABOVE_PER_GRANT_CAP`,
 * `DAILY_CAP_REACHED` and `RELAYER_FLOAT_LOW`. **There is no API that reports
 * grant state** before a claim is made. So this note states the mechanism
 * and stops. A screen that promised "we cover the fee" would be making a claim
 * the platform refuses five ways, at the moment somebody is trying to get their
 * money out — which is the worst possible moment to be wrong in that direction.
 *
 * `none` on everything that is not `eip155`, including an id this build cannot
 * parse. The opposite fallback is a gas warning on a Solana withdrawal, which
 * sends a buyer to buy a token they do not need.
 */
export type WithdrawGasNote =
  | { readonly kind: "none" }
  | { readonly kind: "evm"; readonly text: string };

const EVM_TEXT =
  "This step is a transaction you send yourself, so it costs a network fee in the chain's " +
  "native token. If your wallet has none, the withdrawal will not go through — contact " +
  "support before requesting again.";

export function withdrawGasNote(chainId: string): WithdrawGasNote {
  return isEvmChain(chainId) ? { kind: "evm", text: EVM_TEXT } : { kind: "none" };
}
