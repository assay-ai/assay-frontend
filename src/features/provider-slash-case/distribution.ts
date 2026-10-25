import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import type { ChainParams } from "@/interfaces/chain";

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
 * ## The percentages are the chain's
 *
 * They are `params().slashAgentBps` / `slashPlatformBps` on chain, served on
 * `GET /chains` (`Chain.params`), and changeable by `updateConfig`. So they are
 * passed in ({@link SlashSplit}), never typed here. An executed record carries
 * the split the chain actually applied (`SlashExecuted.agentAmount` /
 * `platformAmount` / `providerAmount`), and that is shown as recorded
 * ({@link recordedSplit}), never recomputed from today's terms.
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

/** The chain's split of a penalty, in bps: what the agents and the platform get; the provider keeps the rest. */
export interface SlashSplit {
  agentBps: number;
  platformBps: number;
}

/** The split from the chain's params (`GET /chains`), or `null` while unknown. */
export function splitOfParams(params: ChainParams | null | undefined): SlashSplit | null {
  if (!params || params.slashAgentBps === null || params.slashPlatformBps === null) return null;
  return { agentBps: params.slashAgentBps, platformBps: params.slashPlatformBps };
}

const BPS_DENOMINATOR = 10_000;

export interface SlashDistribution {
  /** `slashAgentBps` — paid to the harmed agent. */
  agent: Money;
  /** `slashPlatformBps` — paid to the platform treasury. */
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
export function splitPenalty(penalty: Money, split: SlashSplit | null): SlashDistribution | null {
  if (!split) return null;
  const total = new Decimal(penalty.amount || "0");
  const agent = total.mul(split.agentBps).div(BPS_DENOMINATOR).floor();
  const platform = total.mul(split.platformBps).div(BPS_DENOMINATOR).floor();
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

/**
 * An executed penalty as the chain recorded it (`SlashExecuted`): the agents'
 * and the platform's amounts, and the provider's share that was never taken.
 */
export function recordedSplit(
  recorded: { agentAmount: string; platformAmount: string; providerAmount: string },
  like: { asset: string; decimals: number },
): SlashDistribution {
  const money = (amount: string): Money => ({ amount, asset: like.asset, decimals: like.decimals });
  const agent = new Decimal(recorded.agentAmount || "0");
  const platform = new Decimal(recorded.platformAmount || "0");
  return {
    agent: money(agent.toFixed(0)),
    platform: money(platform.toFixed(0)),
    neverTaken: money(new Decimal(recorded.providerAmount || "0").toFixed(0)),
    taken: money(agent.plus(platform).toFixed(0)),
  };
}
