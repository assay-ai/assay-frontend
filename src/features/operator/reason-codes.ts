import type { ArbitrationOutcome } from "@/interfaces/operator";

/**
 * The six outcomes, their reason codes and their consequences.
 *
 * ## Two hand mirrors, and no sync guard in either direction
 *
 * `REASON_CODES` and `OUTCOME_CONSEQUENCE` both live in
 * assay-backend `src/modules/slash/domain/arbitration.ts` (lines 273 and 104) and
 * **no endpoint exposes either** — verified 2026-08-23; their only readers are
 * themselves and `reasonCodesAreValid`. So this file is copied by hand and
 * nothing detects drift: add a code on the backend and it is unofferable here;
 * remove one and this form offers a choice the API answers with a 422.
 *
 * The reason-code failure is at least loud — `decide` validates the pair
 * server-side. The consequence table is worse: it is only ever *rendered*, so a
 * drifted copy tells an adjudicator the wrong thing about what they are about
 * to cause, and nothing anywhere disagrees.
 *
 * Whoever changes either backend constant must change this file in the same
 * breath. Copied verbatim on 2026-08-23.
 */
export const REASON_CODES: Readonly<Record<ArbitrationOutcome, readonly string[]>> =
  Object.freeze({
    UPHELD: ["RATE_GENUINELY_EXCEEDED", "UPSTREAM_QUALITY_DEGRADED", "PROVIDER_CONFIRMED"],
    UPHELD_RECALCULATED: [
      "EXCLUDED_CALLS_MISCOUNTED", "PRICE_BASIS_WRONG", "MULTIPLIER_MISAPPLIED",
    ],
    OVERTURNED_PLATFORM_DEFECT: [
      "MAPPING_REGRESSION", "ROUTING_MISDIRECTED",
      "CLASSIFIER_MISLABELLED", "EGRESS_OR_TIMEOUT_OURS",
    ],
    OVERTURNED_POLICY_DEFECT: [
      "RULE_TOO_STRICT_FOR_INPUT_CLASS", "SCHEMA_STALE", "SEMANTIC_PROMPT_REGRESSION",
    ],
    OVERTURNED_GRIEFING: ["SINGLE_AGENT_CONCENTRATION", "ADVERSARIAL_QUERY_PATTERN"],
    OVERTURNED_INSUFFICIENT_EVIDENCE: [
      "SAMPLE_BELOW_GATE", "CONFIDENCE_INTERVAL_STRADDLES_THRESHOLD",
    ],
  });

export interface OutcomeConsequence {
  readonly penaltyStands: boolean;
  readonly recalculated: boolean;
  readonly strikesStand: boolean;
  readonly routingWeightStands: boolean;
  readonly opensFleetSweep: boolean;
  readonly countsAsFalsePositive: boolean;
  readonly raisesSamplingToFull: boolean;
}

export const OUTCOME_CONSEQUENCE: Readonly<Record<ArbitrationOutcome, OutcomeConsequence>> =
  Object.freeze({
    UPHELD: {
      penaltyStands: true, recalculated: false, strikesStand: true,
      routingWeightStands: true, opensFleetSweep: false,
      countsAsFalsePositive: false, raisesSamplingToFull: false,
    },
    UPHELD_RECALCULATED: {
      penaltyStands: true, recalculated: true, strikesStand: true,
      routingWeightStands: true, opensFleetSweep: false,
      // The finding held; only our arithmetic was wrong.
      countsAsFalsePositive: false, raisesSamplingToFull: false,
    },
    OVERTURNED_PLATFORM_DEFECT: {
      penaltyStands: false, recalculated: false, strikesStand: false,
      routingWeightStands: false, opensFleetSweep: true,
      countsAsFalsePositive: true, raisesSamplingToFull: false,
    },
    OVERTURNED_POLICY_DEFECT: {
      penaltyStands: false, recalculated: false, strikesStand: false,
      routingWeightStands: false, opensFleetSweep: true,
      countsAsFalsePositive: true, raisesSamplingToFull: false,
    },
    OVERTURNED_GRIEFING: {
      penaltyStands: false, recalculated: false, strikesStand: false,
      routingWeightStands: false, opensFleetSweep: false,
      // The measurement was right and a third party caused it. Counting it
      // would make our own error metric move whenever someone attacks a provider.
      countsAsFalsePositive: false, raisesSamplingToFull: false,
    },
    OVERTURNED_INSUFFICIENT_EVIDENCE: {
      penaltyStands: false, recalculated: false,
      // The strikes stand: the calls really did fail, we simply could not say
      // at what rate. Removing them would erase an observation, not a verdict.
      strikesStand: true, routingWeightStands: true, opensFleetSweep: false,
      // We proposed taking money on evidence that could not support it.
      countsAsFalsePositive: true, raisesSamplingToFull: true,
    },
  });

/** The operator case brief, literally. */
export const DECISION_NOTE_MIN_LENGTH = 120;
/** The shorter actions — suspend, extend, second, reverse. */
export const SHORT_NOTE_MIN_LENGTH = 20;

export const ALL_OUTCOMES: readonly ArbitrationOutcome[] = Object.freeze([
  "UPHELD", "UPHELD_RECALCULATED",
  "OVERTURNED_PLATFORM_DEFECT", "OVERTURNED_POLICY_DEFECT",
  "OVERTURNED_GRIEFING", "OVERTURNED_INSUFFICIENT_EVIDENCE",
]);

/**
 * The two outcomes that are findings about **us**, and so the only two that may
 * open a fleet sweep. `chk_fleet_sweeps_outcome` refuses the rest at the
 * database too. Derived from the table rather than listed again.
 */
export const SWEEPABLE_OUTCOMES: readonly ArbitrationOutcome[] = Object.freeze(
  ALL_OUTCOMES.filter((o) => OUTCOME_CONSEQUENCE[o].opensFleetSweep),
);
