import { plainRuleCode } from "@/libs/plain-language";

/**
 * A failure count as a sentence: `{ key: "FRESHNESS_STALE", count: 21 }` →
 * "21 calls returned data older than allowed." Keys the dictionary does not
 * know fall back to the shared rule-code wording, never the raw key.
 */
const FAILURE_PHRASES: Record<string, [one: string, many: string]> = {
  FRESHNESS_STALE: ["returned data older than allowed", "returned data older than allowed"],
  VALUE_RANGE_OUT_OF_BOUNDS: ["returned a value outside the plausible range", "returned a value outside the plausible range"],
  REQUIRED_FIELDS_MISSING: ["left out a required field", "left out a required field"],
  MIN_ARRAY_LENGTH: ["returned too few results", "returned too few results"],
  VALID_URL: ["returned a link that is not a valid address", "returned a link that is not a valid address"],
  NO_DUPLICATES: ["returned the same value twice", "returned the same value twice"],
  SCHEMA: ["did not match the declared response shape", "did not match the declared response shape"],
  TIMEOUT: ["timed out", "timed out"],
  UPSTREAM_ERROR: ["got an error from your API", "got an error from your API"],
};

export function failureSentence(key: string, count: number): string {
  const calls = count === 1 ? "1 call" : `${count.toLocaleString("en-US")} calls`;
  const phrase = FAILURE_PHRASES[key.toUpperCase()];
  if (phrase) return `${calls} ${count === 1 ? phrase[0] : phrase[1]}.`;
  const reason = plainRuleCode(key.toLowerCase());
  return `${calls} failed the check: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
}
