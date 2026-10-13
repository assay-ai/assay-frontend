export type VerdictSegmentValue = "failed" | "passed" | "degraded" | "all";

/** The feed opens on every verdict: a binding with only passed calls must not look empty. */
export const DEFAULT_VERDICT_SEGMENT: VerdictSegmentValue = "all";

export interface VerdictEmptyStateInput {
  segment: VerdictSegmentValue;
  /** The window the feed is scoped to (`w_1`), or `null` when it reads all time. */
  windowLabel: string | null;
  /** Any filter from the Filter sheet (agent, rule, dates) is applied. */
  filtersApplied: boolean;
  /** Rows came back but the search box hides all of them. */
  searching: boolean;
}

/**
 * What the empty feed says. It names whatever is narrowing the feed, and only
 * says "nothing has been judged" when nothing narrows it.
 */
export function verdictEmptyState(input: VerdictEmptyStateInput): {
  title: string;
  description: string;
} {
  const where = input.windowLabel ? ` in window ${input.windowLabel}` : "";

  if (input.searching) {
    return {
      title: "No verdicts match this search",
      description: "Clear the search, try another verdict filter, or switch to all time.",
    };
  }
  if (input.filtersApplied) {
    return {
      title: "No verdicts match these filters",
      description:
        "Nothing in this scope matches the applied filters. Change or clear them to see more.",
    };
  }
  if (input.segment !== "all") {
    return {
      title: `No ${input.segment} verdicts${where}`,
      description: `Only ${input.segment} verdicts are shown. Choose "all" to see every judged call${
        input.windowLabel ? ", or switch to all time" : ""
      }.`,
    };
  }
  return {
    title: input.windowLabel ? `No verdicts${where}` : "No verdicts yet",
    description: `A verdict appears here the moment a call against this binding is judged. Nothing has been judged ${
      input.windowLabel ? "in this window " : ""
    }yet.`,
  };
}
