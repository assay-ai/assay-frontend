import { chainFigure, type ChainFigure } from "@/features/chain-read/chain-read";
import type { ProviderChainStake, ProviderStake } from "@/interfaces";

/**
 * Reading `GET /providers/me/stake`'s per-chain list without picking a chain
 * by accident.
 *
 * ## What went wrong, and why a null guard would not have fixed it
 *
 * The response's stake block became `ProviderChainStakeDto[]`. The frontend
 * interface still declared the old flat fields, so `data.staked`,
 * `data.chainReadable`, `data.hasKnownStake` and `data.stakeAuthority` all
 * resolved to `undefined` — and `!undefined` is `true`, so
 * `/provider/capital` printed **"The chain could not be read"** and four em
 * dashes at a provider whose only chain had just answered with $500.00 and
 * `chainReadable: true`.
 *
 * `provider.stake` becoming an array has form in this codebase: the same
 * change took the explorer down when `stake ? … : "—"` met an empty array
 * (every array is truthy). The lesson taken from that one was "branch on
 * `.length`". The lesson from this one is narrower and sharper: **a per-chain
 * list has no scalar reading, and any function that produces one has to say
 * out loud which chain it picked and why.**
 */

/** Every chain's entry, in the order the API served them. Never a sum. */
export function stakeChains(stake: ProviderStake | undefined): readonly ProviderChainStake[] {
  return stake?.stake ?? [];
}

/** The chains that did not answer on this request. Empty is the healthy case. */
export function unreadableChains(
  stake: ProviderStake | undefined,
): readonly ProviderChainStake[] {
  return stakeChains(stake).filter((entry) => entry.chainReadable !== true);
}

/**
 * This chain's `staked`, as one of the three states.
 *
 * Keyed on `hasKnownStake`, not on `chainReadable`: the DTO's own table says
 * `hasKnownStake: false` is "the source has no reading — NEVER a zero", and
 * `staked` is `null` under exactly that condition. `chainReadable` governs the
 * unbonding block and gets its own banner.
 */
export function stakedFigure(entry: ProviderChainStake): ChainFigure {
  return chainFigure(entry.hasKnownStake, entry.staked);
}

/** This chain's `unbonding`. `chainReadable: false` makes it unknown, not zero. */
export function unbondingFigure(entry: ProviderChainStake): ChainFigure {
  return chainFigure(entry.chainReadable, entry.unbonding, { absentText: "None" });
}

/**
 * The one chain the header's "Open stake account" / "Deposit" buttons act on,
 * or `null` when there is no unambiguous answer.
 *
 * ## The rule, and it is deliberately narrow
 *
 * 1. Exactly one chain on the response → that chain. (Today's case, and the
 *    shape of every seeded provider.)
 * 2. More than one, but exactly one with a proved `stakeAuthority` → that one.
 *    The others have nothing to sign with, so there is no choice being made.
 * 3. Anything else → `null`, and the buttons are disabled with a sentence.
 *
 * **`stake[0]` is not on that list and must never be.** The transactions these
 * buttons build name one chain's stake authority as fee payer and sole signer;
 * picking the first row would build a transaction for a chain the provider did
 * not choose, and it would look correct on every screen until it was signed.
 * A blocked action that says why is the safe direction — the cost of this
 * ruling, stated: a provider with proved authorities on two chains cannot open
 * or fund from this header and must use `/provider/exit`, which builds the
 * same intents. That is a visible dead end with a reason, not a wrong
 * transaction.
 */
export function stakeActionChain(stake: ProviderStake | undefined): ProviderChainStake | null {
  const chains = stakeChains(stake);
  if (chains.length === 1) return chains[0];
  const proved = chains.filter((entry) => entry.stakeAuthority !== null);
  return proved.length === 1 ? proved[0] : null;
}

/**
 * The chain the response's SINGLE requirement figures are about, or `null`.
 *
 * `requirementTotal`, `negotiatedMinimum`, `headroom`, `shortfall` and
 * `recommendedBuffer` are denominated in the stake floor's one asset, so they
 * describe that asset's chain and no other. The response does not name that
 * chain, so it is derived: the entry whose own `staked` is quoted in the same
 * CAIP-19 asset. With one chain on the response there is nothing to derive.
 *
 * **`null` rather than a guess.** A provider on two chains whose requirement
 * asset matches neither entry gets no staked figure printed beside the
 * requirement, which is a visibly incomplete sentence — the alternative is
 * comparing a floor against a chain it was never computed for, which reads as
 * a complete and wrong one. Cost if this rule is wrong: the publish
 * checklist's "… staked" clause is omitted on a multi-chain provider until the
 * backend names the floor's chain on the response.
 */
export function requirementChain(stake: ProviderStake | undefined): ProviderChainStake | null {
  const chains = stakeChains(stake);
  if (chains.length === 0) return null;
  const asset =
    stake?.requirementTotal?.asset ??
    stake?.negotiatedMinimum?.asset ??
    stake?.recommendedBuffer?.asset ??
    stake?.shortfall?.asset ??
    stake?.headroom?.asset ??
    null;
  if (asset !== null) {
    const match = chains.find((entry) => entry.staked?.asset === asset);
    if (match) return match;
  }
  return chains.length === 1 ? chains[0] : null;
}

/**
 * The most recent `observedAt` across every chain, for the header's stamp.
 *
 * A **max**, not `stake[0].observedAt`: with two chains the first row's stamp
 * would silently become the whole page's, and it is the older one exactly when
 * one chain is lagging — the case the stamp exists to reveal.
 */
export function latestObservedAt(stake: ProviderStake | undefined): string | null {
  const stamps = stakeChains(stake)
    .map((entry) => entry.observedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (stamps.length === 0) return null;
  /* ISO-8601 UTC strings sort lexicographically; no Date parsing is involved. */
  return stamps.reduce((latest, value) => (value > latest ? value : latest));
}

/**
 * The scale the stake asset is quoted in, for turning a typed amount into
 * atomic units before an intent is built.
 *
 * Every Money on this response is denominated in the stake asset, so any of
 * them carries the mint's figure — and all of them are legitimately null (an
 * unbonded provider, an RPC outage, no active paid binding). The constant is
 * the last resort and matches USDC, the MVP's single settlement asset.
 */
export const STAKE_ASSET_DECIMALS = 6;

export function stakeDecimals(stake: ProviderStake | undefined): number {
  const fromRequirement =
    stake?.requirementTotal ?? stake?.recommendedBuffer ?? stake?.shortfall ?? null;
  if (fromRequirement) return fromRequirement.decimals;
  const fromChain = stakeChains(stake).find((entry) => entry.staked !== null)?.staked;
  return fromChain?.decimals ?? STAKE_ASSET_DECIMALS;
}
