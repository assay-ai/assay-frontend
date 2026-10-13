export type VerdictSegmentValue = "failed" | "passed" | "degraded" | "all";

/** The feed opens on every verdict: a binding with only passed calls must not look empty. */
export const DEFAULT_VERDICT_SEGMENT: VerdictSegmentValue = "all";

export interface VerdictEmptyStateInput {
  segment: VerdictSegmentValue;
  /** The window the feed is scoped to (`w_1`), or `null` when it reads all time. */
  windowLabel: string | null;
  /** Verified calls the scoped window counts — the figure the Live SLA page shows. */
  windowVerifiedCalls?: number;
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
  // The window's own counter says calls were judged: the rows are missing, not the judging.
  if (input.windowLabel && (input.windowVerifiedCalls ?? 0) > 0) {
    const calls = input.windowVerifiedCalls!.toLocaleString("en-US");
    return {
      title: `No verdict rows for window ${input.windowLabel}`,
      description: `This window counts ${calls} verified call${
        input.windowVerifiedCalls === 1 ? "" : "s"
      }, but their verdict rows are not available here. The Live SLA page has the window's totals; switch to all time to see the verdicts we hold.`,
    };
  }
  return {
    title: input.windowLabel ? `No verdicts${where}` : "No verdicts yet",
    description: `A verdict appears here the moment a call against this binding is judged. Nothing has been judged ${
      input.windowLabel ? "in this window " : ""
    }yet.`,
  };
}
