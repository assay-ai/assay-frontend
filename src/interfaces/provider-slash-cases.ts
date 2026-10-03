import type { Money } from "@/interfaces/api";
import type {
  SlashAttributionRow,
  SlashProposalCase,
} from "@/interfaces/provider-disputes";

/**
 * The slash case screen's slash-proposal case — the full `SlashProposalCaseDto`.
 *
 * `@/interfaces/provider-disputes` already types the part the dispute form's filing
 * form needs (the proposal summary, the change overlay, the failures-by-agent
 * rows, the suggested claim) and its own docstring says the rest — "the
 * arithmetic table, prior windows, inaction forecast" — is the slash case screen's. This is
 * that rest, and it **extends** the existing interface rather than restating
 * it: one endpoint described twice is two descriptions that drift, and the
 * thing they would drift about here is how much money is being taken.
 *
 * Every field is verbatim from assay-backend `src/modules/slash/dto/
 * slash-proposal.dto.ts`, checked against a live response from the running
 * API. What the DTO does **not** carry is listed in the screen's docstring,
 * because on this surface an absent field has to render as absent.
 */

/**
 * One line of "The measurement".
 *
 * `value` is already formatted by the server and is rendered verbatim — the
 * DTO says so, and re-formatting it here would mean this screen and the
 * evidence pack could quote the same strike differently.
 *
 * `expression` is `null` wherever the strike's frozen `computation` array has
 * no step with that label. That is the honest state and not a gap to fill:
 * The working shown is the working that was recorded when the window closed.
 */
export interface SlashArithmeticRow {
  /** e.g. `observed_rate`. */
  key: string;
  /** The working, e.g. `60 failed / 400 verified`. Null where none was frozen. */
  expression: string | null;
  /** Already formatted for display. */
  value: string;
  /** The aside, e.g. `observed 15.00% > 3.81% → breach`. */
  note: string | null;
  /** Drives colour only; carries no meaning of its own. */
  tone: "NEUTRAL" | "GOOD" | "BAD";
}

/** One bar of the "previous 5 windows" strip — this window and the five before it. */
export interface SlashPriorWindow {
  windowId: string;
  /** The provider-facing label, e.g. `w_6`. */
  label: string;
  /** Observed failure rate, 0–1. */
  observedRate: number;
  closedAt: string;
  /** True for the window this proposal is about. */
  isSubject: boolean;
}

/**
 * "What happens if you do nothing", as fields.
 *
 * `graceHours` and `projectedRestoreHours` are null when the floor is **not**
 * breached — so the design's green "floor restored in ~14 hours" note is
 * conditional, not decoration.
 */
export interface SlashInactionForecast {
  executesAt: string;
  /** Stake now. */
  stakeBefore: Money;
  /** Stake after the penalty, if it executes. */
  stakeAfter: Money;
  minimumRequired: Money;
  fallsBelowMinimum: boolean;
  /** Hours of grace that would open. Null when the floor is not breached. */
  graceHours: number | null;
  /**
   * Estimated hours of earning, at the current rate, to cover the shortfall.
   *
   * **Not a projection that the floor restores by itself.** It was, when the
   * platform held a provider's earnings and could sweep them into stake; lean
   * v3 pays the provider's own token account at redemption, so there is nothing
   * held to sweep and closing the gap is a deposit the provider makes. The
   * field is the same rate; the claim a screen may build on it is weaker.
   * Null when the floor is not breached, or when there is no earnings
   * run-rate to project from — the two are indistinguishable on the wire.
   */
  projectedRestoreHours: number | null;
  /** Routing is unaffected by a proposal. Always true; the server states it anyway. */
  routingContinues: boolean;
}

/** The whole of the slash case screen. Extends the dispute form's subset so the two cannot disagree. */
export interface SlashProposalCaseDetail extends SlashProposalCase {
  inaction: SlashInactionForecast;
  /** The measurement, worked. Empty for a `DATA_FAIL` proposal — there is no strike to render. */
  arithmetic: SlashArithmeticRow[];
  /** This window and the previous five, oldest first. */
  priorWindows: SlashPriorWindow[];
  /** Failures by rule. `failuresByAgent` is inherited. */
  failuresByRule: SlashAttributionRow[];
}
