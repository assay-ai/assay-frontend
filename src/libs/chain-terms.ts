import type { Chain, ChainParams } from "@/interfaces/chain";

/**
 * Every on-chain number a screen prints, as text, from `GET /chains`
 * (`Chain.params`). The chain is the source of truth: no screen keeps a copy
 * of the fee, the minimum stake, the slash split or cap, the unbonding period,
 * the slash delay, the dispute hold or the contract delays. A value not known
 * yet reads {@link UNKNOWN}, never a guess.
 */

/** What a screen shows for a value the API has not given yet. */
export const UNKNOWN = "—";

/**
 * A duration as words: `3600` → `1 hour`, `259200` → `72 hours`, `950400` →
 * `11 days`, `600` → `10 minutes`. Whole days only from four days up, so the
 * slash delay reads in hours and the unbonding period in days. The same rule
 * as the backend's `durationText`.
 */
export function durationText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return UNKNOWN;
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (seconds >= 4 * 86_400 && seconds % 86_400 === 0) return plural(seconds / 86_400, "day");
  if (seconds >= 3_600 && seconds % 3_600 === 0) return plural(seconds / 3_600, "hour");
  if (seconds >= 60 && seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

/** A duration as a compound adjective: `3600` → `1-hour` ("the 1-hour hold"), `600` → `10-minute`. */
export function compoundDurationText(seconds: number | null | undefined): string {
  const words = durationText(seconds);
  return words === UNKNOWN ? UNKNOWN : words.replace(/ (day|hour|minute|second)s?$/, "-$1");
}

/** `1000` bps → `10%`, `1250` → `12.5%`. */
export function percentText(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return UNKNOWN;
  return `${bps / 100}%`;
}

/** Atomic units → `$50.00` (two decimals, truncated, never rounded up). */
export function usdText(minor: string | null | undefined, decimals: number): string {
  if (minor === null || minor === undefined || !/^\d+$/.test(minor)) return UNKNOWN;
  const padded = minor.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction = padded.slice(padded.length - decimals).padEnd(2, "0").slice(0, 2);
  return `$${Number(whole).toLocaleString("en-US")}.${fraction}`;
}

/** Atomic units as a plain dollar number (`"50000000"`, 6 → `50`), or `null`. */
export function usdNumber(minor: string | null | undefined, decimals: number): number | null {
  if (minor === null || minor === undefined || !/^\d+$/.test(minor)) return null;
  return Number(minor) / 10 ** decimals;
}

/** The provider's share of a slash, in bps: what agents and the platform do not take. */
export function providerShareBps(params: ChainParams | null | undefined): number | null {
  if (!params || params.slashAgentBps === null || params.slashPlatformBps === null) return null;
  return 10_000 - params.slashAgentBps - params.slashPlatformBps;
}

/** The text of every on-chain term, for {@link fillTerms} and for screens that print one. */
export interface ChainTerms {
  /** Platform fee, `10%`. */
  feePercent: string;
  /** `$50.00`. */
  minimumStake: string;
  /** Most taken per rolling 24 h, `10%`. */
  dailyCapPercent: string;
  /** Per-record penalty ceiling, `$1.00`. */
  penaltyCeiling: string;
  agentShare: string;
  platformShare: string;
  providerShare: string;
  /** `11 days`. */
  unbonding: string;
  /** The delay a provider actually gets before a penalty can be taken, `72 hours`. */
  slashDelay: string;
  /** The dispute hold on each paid call, `1 hour`. */
  holdWindow: string;
  /** The same as an adjective, `1-hour` ("the 1-hour hold"). */
  holdCompound: string;
  /** Escrow withdrawal delay, `3 hours`. */
  withdrawDelay: string;
  tightenDelay: string;
  redeemGrace: string;
  /** How long a held payment can stay held, `7 days`. */
  heldTimeout: string;
}

export function chainTerms(chain: Chain | null | undefined): ChainTerms {
  const params = chain?.params ?? null;
  const decimals = chain?.decimals ?? 6;
  return {
    feePercent: percentText(params?.takeRateBps),
    minimumStake: usdText(params?.minimumStake, decimals),
    dailyCapPercent: percentText(params?.slashCapBps),
    penaltyCeiling: usdText(params?.penaltyAmount, decimals),
    agentShare: percentText(params?.slashAgentBps),
    platformShare: percentText(params?.slashPlatformBps),
    providerShare: percentText(providerShareBps(params)),
    unbonding: durationText(params?.unbondingPeriodSeconds),
    slashDelay: durationText(params?.effectiveSlashDelaySeconds),
    holdWindow: durationText(params?.collectHoldSeconds),
    holdCompound: compoundDurationText(params?.collectHoldSeconds),
    withdrawDelay: durationText(params?.withdrawDelaySeconds),
    tightenDelay: durationText(params?.tightenDelaySeconds),
    redeemGrace: durationText(params?.redeemGraceSeconds),
    heldTimeout: durationText(params?.heldTimeoutSeconds),
  };
}

/** Every term unknown: what a screen shows before `GET /chains` answered. */
export const UNKNOWN_TERMS: ChainTerms = chainTerms(null);

/**
 * Replace `{{feePercent}}`-style placeholders with the chain's terms. Static
 * copy tables (the glossary, the explorer text) carry placeholders instead of
 * numbers, and the component that renders them fills them in.
 */
export function fillTerms(text: string, terms: ChainTerms): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in terms ? terms[key as keyof ChainTerms] : match,
  );
}

/**
 * The chain whose terms a chain-less screen (the public pages, the provider
 * onboarding) shows: the one named, else the first chain that has on-chain
 * params. Every deployment today has exactly one such chain.
 */
export function termsChain(chains: readonly Chain[], chainId?: string | null): Chain | null {
  if (chainId) return chains.find((chain) => chain.chainId === chainId) ?? null;
  return chains.find((chain) => chain.params !== undefined) ?? null;
}
