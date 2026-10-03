import type { Chain } from "@/interfaces/chain";
import { settlementSymbol } from "@/services/chains.service";

import { offeredChains, type DepositableChains } from "./depositable-chains";

/**
 * What the funding screens may call the money — read off `GET /chains`, never
 * written down here.
 *
 * ## The literal this replaces
 *
 * `/funding` printed `USDC` in four places: the deposits table's Method
 * column, the "Send USDC" tile, its `Solana · to your deposit address · ~40s`
 * subtitle and the note under it. All four rendered identically for a buyer on
 * `eip155:46630`, whose money is **USDG** and whose chain is not Solana —
 * measured in Chrome under both identities. A buyer deciding which token to
 * send was being told, confidently, the wrong one.
 *
 * ## Why none of this is a table
 *
 * The frontend never carries a build-time copy of anything the chain
 * list answers, because the copy drifts from the deployment and the failure is
 * a user shown a chain — or here, an asset — the API then refuses. A
 * `Record<chainId, "USDC" | "USDG">` is that copy with one column. So the
 * symbol is served (`Chain.settlementAssetSymbol`) and everything below is a
 * lookup keyed on the chain the caller is actually talking about.
 *
 * ## The dropped `~40s`
 *
 * The tile promised a settlement time. It was a Solana number, it was written
 * in this bundle, and nothing on the wire reports it for any chain. It is
 * deleted rather than made per-chain: the honest per-chain version would be a
 * second build-time table, of numbers nobody measured, on the screen where
 * money moves. A buyer loses a rough expectation; they stop being told a wrong
 * one on the chain that is not Solana.
 */

/**
 * The asset column for one deposit row.
 *
 * Keyed on **the row's own `chainId`**, not on a chain picked once for the
 * table: a two-chain buyer's deposit history is two assets, and a single
 * header value would relabel half of it. `—` when the chain list does not
 * carry that chain — a dash is "we do not know", which is true, where `USDC`
 * would be a claim.
 */
export function depositMethodLabel(chains: readonly Chain[], chainId: string): string {
  return settlementSymbol(chains, chainId) ?? "—";
}

/** The "Add funds" tile's two lines. */
export interface AddFundsTile {
  readonly title: string;
  readonly sub: string;
}

/**
 * The tile, built from **the chains this buyer can actually deposit on** —
 * the same `DepositableChains` the deposit screen's picker is built from, so
 * the two screens cannot disagree about what is on offer.
 *
 * Every state that has no chain in hand names no asset and no network at all.
 * `useChains()` carries an empty list while loading and on error, and
 * "Send USDC / Solana · ~40s" is exactly the default that shipped and was read
 * by a Robinhood-testnet buyer.
 *
 * With two or more chains the symbols are de-duplicated — Solana mainnet and
 * devnet both settle in USDC, and `Send USDC or USDC` makes a reader distrust
 * the screen.
 *
 * **`~40s` is gone and is not replaced.** It was a Solana settlement time,
 * written in this bundle, reported by nothing on the wire, and rendered
 * identically on a chain it was never about. A per-chain version would be a
 * second build-time table of numbers nobody measured, on the screen where
 * money moves.
 *
 * **"to your deposit address" is gone too.** There is no deposit-address flow
 * behind this link: `funding/deposit/page.tsx` composes a transfer out of the
 * connected wallet's own token account and says so in its own comment — *"a
 * bare memo-less transfer to an address could never be reconciled back to an
 * intent anyway."* The tile was describing a mechanism the product does not
 * have.
 */
export function addFundsTile(depositable: DepositableChains): AddFundsTile {
  if (depositable.kind === "not-offered") {
    return {
      title: "Add funds",
      sub: "this account's chain is not one this deployment takes deposits on",
    };
  }

  const chains = offeredChains(depositable);
  if (chains.length === 0) {
    return { title: "Add funds", sub: "reading which chains this deployment accepts…" };
  }

  const symbols = symbolsOf(chains);
  const names = unique(chains.map((chain) => chain.displayName));

  return {
    title:
      symbols.length === 0
        ? "Send your chain's settlement token"
        : symbols.length <= 2
          ? `Send ${joinOr(symbols)}`
          : "Send your chain's settlement token",
    sub:
      names.length <= 2
        ? `${joinOr(names)} · one signature from your connected wallet`
        : `${names.length} chains · one signature from your connected wallet`,
  };
}

/**
 * The sentence under the tile, which used to read "You fund the account with
 * USDC and you can withdraw unspent balance at any time."
 *
 * It keeps saying the true, chain-independent half — no card, no fiat
 * on-ramp, withdrawable — and names the asset only when there is one to name.
 */
export function fundingAssetNote(depositable: DepositableChains): string {
  const head = "There is no card and no fiat on-ramp in this release.";
  const symbols = symbolsOf(offeredChains(depositable));

  if (symbols.length === 0 || symbols.length > 2) {
    return `${head} You fund the account with the settlement token of the chain you deposit on, and you can withdraw unspent balance at any time, on the chain it is held on.`;
  }
  return `${head} You fund the account with ${joinOr(symbols)} and you can withdraw unspent balance at any time, on the chain it is held on.`;
}

/**
 * The symbols actually present, empty strings and absent fields removed.
 *
 * `Chain` is a **hand mirror** of the backend's DTO, so a field it declares is
 * a field this build *expects*, not one the wire guarantees: an API one deploy
 * behind serves the same JSON without `settlementAssetSymbol`, and TypeScript
 * cannot see that across HTTP. Measured, with exactly that mismatch live — the
 * tile rendered `Send` and the note read "You fund the account with and you
 * can withdraw…", which is worse than the wrong-token literal it replaced,
 * because it reads as a broken page rather than a claim.
 *
 * So a missing symbol degrades to the asset-neutral wording, which is true on
 * every chain.
 */
function symbolsOf(chains: readonly Chain[]): string[] {
  return unique(chains.map((chain) => chain.settlementAssetSymbol).filter(Boolean));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function joinOr(values: readonly string[]): string {
  return values.length <= 1 ? (values[0] ?? "") : values.join(" or ");
}
