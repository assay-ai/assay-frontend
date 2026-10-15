import type { PolicyDiffEntry } from "@/interfaces/provider-policy-changes";

/**
 * What one line of a policy diff means for a provider, in plain words.
 *
 * The diff is a structural one over the decision document ("$.threshold
 * changed 0.65 → 0.7"), which only an engineer reads. Each known shape gets a
 * sentence about its effect on the provider's results; anything unknown gets a
 * neutral sentence, and the raw diff stays available under "Technical
 * details".
 */
export type ImpactDirection = "stricter" | "looser" | "neutral";

export interface PlainImpact {
  text: string;
  direction: ImpactDirection;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function checkName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as Record<string, unknown>).verifierId;
  if (typeof id !== "string" || !id) return null;
  const words = id
    .replace(/^(det|xcheck|llm|stat)\./, "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return words ? words : null;
}

export function plainImpact(entry: PolicyDiffEntry): PlainImpact {
  const path = entry.path;
  const before = num(entry.before);
  const after = num(entry.after);

  if (/\.threshold$/.test(path) && entry.changeType === "changed" && before !== null && after !== null) {
    if (after > before) {
      return {
        text: `Checks get stricter: a result needs a score of ${after} to pass, up from ${before}. More calls may fail the check, so your failure rate could rise.`,
        direction: "stricter",
      };
    }
    if (after < before) {
      return {
        text: `Checks get more lenient: a result needs a score of ${after} to pass, down from ${before}. Fewer calls should fail the check.`,
        direction: "looser",
      };
    }
  }

  if (/\.verifiers\[\d+\]$/.test(path)) {
    const name = checkName(entry.after ?? entry.before);
    const named = name ? ` (${name})` : "";
    if (entry.changeType === "added") {
      return { text: `One more check${named} runs on each result. A result now has one more way to fail.`, direction: "stricter" };
    }
    if (entry.changeType === "removed") {
      return { text: `One check${named} no longer runs on each result.`, direction: "looser" };
    }
    return { text: `One of the checks${named} changes how it works.`, direction: "neutral" };
  }

  if (/\.verifiers\[\d+\]\.weight$/.test(path)) {
    return { text: "How much one check counts toward the score changes.", direction: "neutral" };
  }

  if (/\.clauses\[\d+\]/.test(path)) {
    if (entry.changeType === "added") return { text: "A new rule is added that each result must meet.", direction: "stricter" };
    if (entry.changeType === "removed") return { text: "A rule each result had to meet is removed.", direction: "looser" };
    if (before !== null && after !== null) {
      return { text: `One of the rules that decides when a result fails changes its threshold from ${before} to ${after}; the technical details below name it.`, direction: "neutral" };
    }
    return { text: "A rule each result must meet changes.", direction: "neutral" };
  }

  if (entry.changeType === "added") return { text: "A new setting is added to the checks.", direction: "neutral" };
  if (entry.changeType === "removed") return { text: "A setting is removed from the checks.", direction: "neutral" };
  return { text: "A setting of the checks changes.", direction: "neutral" };
}

/** One sentence for the whole change. */
export function overallImpact(diff: readonly PolicyDiffEntry[]): string {
  if (diff.length === 0) return "Nothing that decides pass or fail changes.";
  const directions = diff.map((entry) => plainImpact(entry).direction);
  const stricter = directions.includes("stricter");
  const looser = directions.includes("looser");
  if (stricter && !looser) return "Overall the checks get stricter: expect a few more of your calls to fail them.";
  if (looser && !stricter) return "Overall the checks get more lenient: expect fewer of your calls to fail them.";
  if (stricter && looser) return "Some checks get stricter and some more lenient: watch your failure rate after it takes effect.";
  return "The checks change, but not clearly in either direction: watch your failure rate after it takes effect.";
}
