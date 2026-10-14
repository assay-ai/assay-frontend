import Decimal from "decimal.js";

import type { Money } from "@/interfaces";

/**
 * Where a penalty goes — and the design is wrong about a third of it.
 *
 * `dObK1` reads:
 *
 * > `Distribution  $3.00 agents who bought from this binding · $1.50 platform
 * > · $0.50 insurance reserve`
 *
 * The percentages (60/30/10) are right. **There is no insurance reserve.**
 * From the program's `instructions/slash.rs` (assay-solana repo):
 *
 * ```text
 * applied          the penalty, after the stake cap and the 24h cap
 * ├── 60%  agent_amount     → the harmed agent's derived ATA
 * ├── 30%  platform_amount  → the treasury's derived ATA
 * └── 10%  the remainder    → stays exactly where it is
 * ```
 *
 * and, in that file's own words: *"The provider's 10% is not paid back to
 * them; it is never taken. So the stake reduction is `agent_amount +
 * platform_amount`, not `applied`, and a provider judged $10 loses $9."*
 *
 * That distinction is the whole point on this screen. A provider deciding
 * whether to trust the platform's arithmetic must not be told they paid into
 * a fund that does not exist, when what actually happened is that a tenth of
 * the judgement was never taken from them at all.
 *
 * ## The percentages are not on the wire
 *
 * They are `Config.slash_agent_bps` / `slash_platform_bps` on chain, set by
 * `initialize_config` and changeable by `update_config`. **No API this app
 * can reach publishes them** — not
 * `GET /providers/me/slash-proposals/:id`, not the stake endpoints, nothing. So
 * they are transcribed here from the program's own documented split, and the
 * screen labels the line as the protocol's split rather than as a figure the
 * case returned. If the on-chain parameters are ever tuned, this file is the
 * one place that has to move, and the right fix is for the case DTO to carry
 * them. `distribution.test.ts` pins these values against an excerpt of the
 * program's `state.rs`.
 *
 * ## What it splits, and what it does not
 *
 * `penaltyAmount` is the **uncapped** formula result. On EVM the amount
 * reserved at proposal (at most the stake cap allows) is what an executed
 * penalty takes, always whole: since assay-evm 9f036a3 a penalty that does not
 * fit today's limit waits (`SlashWindowNotDrained`) and is never paid in part.
 * The backend does not compute the reservation, so this splits the proposed
 * penalty, and the screen says so.
 */

/** `Config.slash_agent_bps` — the harmed agent's share. */
export const SLASH_AGENT_BPS = 6000;
/** `Config.slash_platform_bps` — the treasury's share. */
export const SLASH_PLATFORM_BPS = 3000;

/**
 * Where these numbers came from, and the fact that nothing keeps them current.
 *
 * Exported rather than left in a comment so that the screen can print it. A
 * provider being told how their stake was split deserves to know the split is
 * the platform's published figure at a date, not a value read from the chain
 * a moment ago — those are different claims and only one of them is true.
 */
export const SLASH_SPLIT_SOURCE = {
  file: "assay-solana: programs/x402-payment/src/state.rs",
  readAt: "2026-09-03",
  /** No endpoint publishes `slash_agent_bps` / `slash_platform_bps` yet. */
  publishedByApi: false,
} as const;

const BPS_DENOMINATOR = 10_000;

export interface SlashDistribution {
  /** 60% — paid to the harmed agent. */
  agent: Money;
  /** 30% — paid to the platform treasury. */
  platform: Money;
  /**
   * The remainder. **Not a payment**: it is the part of the judgement that is
   * never taken from the provider's stake at all.
   */
  neverTaken: Money;
  /** `agent + platform` — the actual stake reduction. */
  taken: Money;
}

/**
 * Split a penalty exactly the way `slash.rs` does.
 *
 * `bps_of` floors, and `provider_amount` is `applied − agent − platform`
 * rather than a third `bps_of` call — which is what keeps rounding dust from
 * disappearing, so `agent + platform + neverTaken == penalty` for every input.
 * Reproduced here rather than approximated, because a share the screen shows
 * and a share the chain moves that differ by one minor unit is exactly the
 * kind of discrepancy this screen exists to rule out.
 *
 * All arithmetic is on minor units through `decimal.js`; nothing becomes a
 * float on the way.
 */
export function splitPenalty(penalty: Money): SlashDistribution {
  const total = new Decimal(penalty.amount || "0");
  const agent = total.mul(SLASH_AGENT_BPS).div(BPS_DENOMINATOR).floor();
  const platform = total.mul(SLASH_PLATFORM_BPS).div(BPS_DENOMINATOR).floor();
  const neverTaken = total.minus(agent).minus(platform);

  const like = (value: Decimal): Money => ({
    amount: value.toFixed(0),
    asset: penalty.asset,
    decimals: penalty.decimals,
  });

  return {
    agent: like(agent),
    platform: like(platform),
    neverTaken: like(neverTaken),
    taken: like(agent.plus(platform)),
  };
}
