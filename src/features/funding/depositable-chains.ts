import type { Chain } from "@/interfaces/chain";
import { freeCallsOnlyText, servesPaidCalls } from "@/libs/chains/paid-rails";
import { isEvmChain } from "@/libs/chains/registry";
import { findChain } from "@/services/chains.service";

/**
 * Which chains this buyer may be offered a deposit on — the deployment's
 * enabled set, **narrowed to the account they actually hold**.
 *
 * ## The defect
 *
 * The picker offered every enabled chain to everybody. Measured in Chrome: a
 * buyer whose only account is `eip155:46630` was offered `Solana devnet`,
 * could select it, and walked to a fully-priced summary — chain named in
 * words, "You pay $25.00", "Credited to balance $25.00", a live `Deposit
 * $25.00` button — before anything refused them. `POST /deposits` answers that
 * combination `409 PAYMENT_DEPOSIT_ACCOUNT_NOT_LINKED` ("No linked account on
 * that chain… You can deposit on: eip155:46630"), so no money was ever at
 * risk; what was wrong is that a choice which never existed was presented as
 * one, and the refusal arrived after the buyer had priced it.
 *
 * ## Where the narrowing comes from
 *
 * `GET /escrow` reports `account`, a CAIP-10 the controller takes **from the
 * session and never from the request** — `escrow.service.ts` and
 * `funding/escrow/page.tsx` both already read the chain off it for exactly
 * that reason. So the linked chain is a served fact, not a derived one, and
 * this file adds no table: it intersects one list from the API with one field
 * from another.
 *
 * There is one linked account today (`sessionAccounts()` on the backend
 * returns a single entry and says so). The shape below takes a list of chains
 * back, so the day `agent_accounts` lands this function changes and its
 * callers do not.
 *
 * ## Why a failed account read does NOT block
 *
 * `unfiltered` deliberately offers everything when the account could not be
 * read. The alternative — blocking deposits because an unrelated escrow read
 * failed — takes away the thing that still works, and the cost of being wrong
 * in this direction is bounded and loud: `POST /deposits` is called *before*
 * any wallet is opened, and an unlinked chain comes back as a named 409 with
 * nothing signed and no money moved.
 */
export type DepositableChains =
  /** The chain list itself is empty — loading, or the API could not be asked. */
  | { readonly kind: "no-chains" }
  /** The chain list is in hand; which account this session holds is not, yet. */
  | { readonly kind: "reading-account" }
  /** The account could not be read. Offer the deployment's list; the API is the judge. */
  | { readonly kind: "unfiltered"; readonly chains: readonly Chain[] }
  /** The buyer's own chain, and only it. */
  | { readonly kind: "linked"; readonly chains: readonly Chain[] }
  /** The buyer holds an account on a chain this deployment does not offer. */
  | { readonly kind: "not-offered"; readonly accountChainId: string };

export interface LinkedAccountRead {
  readonly status: "loading" | "error" | "ready";
  /** CAIP-2, off `chainIdOfAccount(escrow.account)`. `null` when unknown. */
  readonly chainId: string | null;
}

export function depositableChains(
  chains: readonly Chain[],
  account: LinkedAccountRead,
): DepositableChains {
  if (chains.length === 0) return { kind: "no-chains" };
  if (account.status === "loading") return { kind: "reading-account" };
  if (account.status === "error" || account.chainId === null) {
    // A deposit funds paid calls, so a chain that serves free calls only is not
    // offered — unless it is all there is, where picking it says why.
    const paid = chains.filter((chain) => servesPaidCalls(chain.chainId));
    return { kind: "unfiltered", chains: paid.length > 0 ? paid : chains };
  }

  const linked = findChain(chains, account.chainId);
  if (linked === null) return { kind: "not-offered", accountChainId: account.chainId };
  return { kind: "linked", chains: [linked] };
}

/** The chains to hand the picker. Empty for every state that has none. */
export function offeredChains(result: DepositableChains): readonly Chain[] {
  return result.kind === "unfiltered" || result.kind === "linked" ? result.chains : [];
}

/**
 * Whether *this surface* can take a deposit on the chosen chain, and what to
 * say when it cannot.
 *
 * Separate from the narrowing above because they are different refusals. That
 * one is about the buyer's account; this one is about what this browser can
 * sign.
 *
 * ## eip155: embedded wallets, with an RPC, only
 *
 * The screen now builds the eip155 deposit (`features/funding/evm-deposit.ts`):
 * `approve`, then a `depositFor` signed and handed to the settle route UNSENT,
 * which `EvmFacilitator` verifies and broadcasts. Two things still refuse it:
 *
 *  - ~~An external wallet.~~ No longer a refusal (2026-09-29): an injected
 *    wallet cannot sign without sending, so it SENDS `depositFor` and the
 *    backend settles by hash (`POST /deposits/:id/broadcast`).
 *  - **No public RPC for the chain** (`GET /chains` served no `publicRpcUrl`). The
 *    browser fills nonce, gas and fees itself, so without an RPC there is no
 *    transaction to sign.
 *
 * ## A chain with no paid rail
 *
 * Solana serves free calls only today (`libs/chains/paid-rails.ts`). Escrow
 * money is spent on paid calls alone, so a deposit there is refused here too.
 *
 * Said while the buyer is still reading, not at the click — the same fact,
 * delivered before it costs them anything.
 *
 * Keyed on the namespace, never on a chain id — `libs/chains/registry.ts`'s
 * rule. The first thing a hardcoded chain id does here is get a second EVM
 * chain wrong.
 */
export function depositUnavailableOn(
  chainId: string | null,
  chainName: string | null,
  wallet: {
    /** `null` while the wallet is not resolved yet — no refusal on a guess. */
    readonly kind: "embedded" | "external" | null;
    readonly rpcConfigured: boolean;
  },
): string | null {
  if (chainId === null) return null;
  const name = chainName ?? chainId;
  /*
    Escrow money is spent only on paid calls, and a chain with no paid rail
    (Solana today) refuses every one with `409 CHAIN_RAIL_NOT_OFFERED`. A
    deposit there would sit unspent, so it is not offered.
  */
  if (!servesPaidCalls(chainId)) {
    return `${freeCallsOnlyText(name)} Deposits on it are not offered for now.`;
  }
  if (!isEvmChain(chainId)) return null;
  if (!wallet.rpcConfigured) {
    return (
      `Deposits on ${name} aren't available right now. Money already in your escrow is safe and ` +
      `shown above.`
    );
  }
  return null;
}
