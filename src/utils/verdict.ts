import type { WireVerdict } from "@/interfaces";

/**
 * The one place an internal verdict becomes something a person reads.
 *
 * Design-system rule: **never show a
 * raw verdict**. The internal token must not reach the screen, and the word
 * "skipped" must appear nowhere. The sentences below are copied verbatim from
 * the design's Verdict vocabulary table — do not reword them.
 *
 * The map is deliberately TOTAL over what the wire can emit, which is wider
 * than both the design's table and the API's own declared enum:
 *
 *   design table    6 values
 *   OpenAPI enum    7 values (adds EMPTY_UNVERIFIED, omits UNVERIFIED)
 *   actually seen   UNVERIFIED, and null on an expired call
 *
 * A partial map would render a blank where a sentence belongs, which on this
 * product means a person cannot tell whether they were charged. So the three
 * values the design never wrote copy for are present, marked `provisional`,
 * and worded to claim nothing about money. **They need a designer's words
 * before any of this ships to a user.**
 */

export type VerdictMark = "check" | "cross" | "bang" | "dash" | "tilde" | "none";

export interface VerdictPresentation {
  /** The sentence a person reads. Never the token. */
  shownAs: string;
  mark: VerdictMark;
  /** Whether the call was charged. `null` where the design does not say. */
  charged: boolean | null;
  /**
   * True when this wording is OURS, not the design's. Surface it in review, and
   * do not treat it as approved product copy.
   */
  provisional: boolean;
}

const FROM_DESIGN: Record<string, VerdictPresentation> = {
  PASS: {
    shownAs: "Passed every check we run on this call",
    mark: "check",
    charged: true,
    provisional: false,
  },
  FAIL: {
    shownAs: "Failed our checks — you were not charged",
    mark: "cross",
    charged: false,
    provisional: false,
  },
  DEGRADED: {
    shownAs:
      "Rule checks passed. We could not run the relevance judgement, so it was not counted either way.",
    mark: "bang",
    charged: true,
    provisional: false,
  },
  SKIPPED: {
    // The design appends the sample rate at the call site; see `withRate`.
    shownAs: "Not sampled for relevance judgement",
    mark: "dash",
    charged: true,
    provisional: false,
  },
  EMPTY_CONFIRMED: {
    shownAs: "The tool returned nothing, and nothing was the right answer",
    mark: "dash",
    charged: true,
    provisional: false,
  },
  MISAPPLIED: {
    shownAs: "This request was outside what the tool covers. You were not charged.",
    mark: "tilde",
    charged: false,
    provisional: false,
  },
};

const PROVISIONAL: Record<string, VerdictPresentation> = {
  UNVERIFIED: {
    shownAs: "We did not run checks on this call",
    mark: "dash",
    charged: null,
    provisional: true,
  },
  EMPTY_UNVERIFIED: {
    shownAs: "The tool returned nothing. We did not check whether that was the right answer.",
    mark: "dash",
    charged: null,
    provisional: true,
  },
};

const NO_VERDICT: VerdictPresentation = {
  shownAs: "No result recorded for this call",
  mark: "none",
  charged: null,
  provisional: true,
};

/** Total: every wire value, including null and anything unrecognised. */
export function presentVerdict(verdict: WireVerdict | string | undefined): VerdictPresentation {
  if (verdict === null || verdict === undefined) return NO_VERDICT;
  return FROM_DESIGN[verdict] ?? PROVISIONAL[verdict] ?? NO_VERDICT;
}

/**
 * SKIPPED is the one sentence the design always shows with its rate attached —
 * "Not sampled for relevance judgement (1 call in 125 at this price)". Passing
 * no rate returns the bare sentence rather than inventing a number.
 */
export function withRate(presentation: VerdictPresentation, rate?: string | null): string {
  if (!rate) return presentation.shownAs;
  return `${presentation.shownAs} (${rate})`;
}

/** Every wording that is ours rather than the design's. For review surfaces. */
export function provisionalVerdicts(): string[] {
  return [...Object.keys(PROVISIONAL), "null"];
}
