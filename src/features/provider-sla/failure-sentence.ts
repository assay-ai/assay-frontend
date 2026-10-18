import { plain } from "@/libs/plain-language";

/**
 * One line per group of failed calls in a window, as a sentence:
 *
 *   "1 call failed: a value was outside the allowed range"
 *   "3 calls failed our checks (which rule: see Checked calls below)"
 *
 * A `quorum_*` key names what decided the verdict ("enough checks failed"),
 * not what was wrong with the result, so it is not shown as the reason: the
 * failing rule is on each call under Checked calls.
 */
export function failureSentence(group: { key: string; count: number }): string {
  const calls = `${group.count.toLocaleString("en-US")} call${group.count === 1 ? "" : "s"} failed`;
  if (/^quorum_/i.test(group.key)) return `${calls} our checks (which rule: see Checked calls below)`;
  const reason = plain(group.key);
  return reason ? `${calls}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : calls;
}
