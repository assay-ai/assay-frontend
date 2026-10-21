/**
 * Sentences of the Not charged page (`/guarantee`) that depend on the counts,
 * kept pure so they are tested without rendering the page.
 */

function plural(n: number, one: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;
}

/**
 * The teal card when nothing was withheld. "Every call passed" is only said
 * when no call ended without running: an EXPIRED call that never held money
 * did not pass anything (BUG-BUY-MONEY-01).
 */
export function nothingWithheldHeading(notRunCalls: number): string {
  return notRunCalls > 0 ? "No call this month failed our checks" : "Every call this month passed";
}

/**
 * The note on calls that never ran (EXPIRED, nothing held): in no line, never
 * charged. `complete: false` when the calls read stopped at its page cap, so
 * the count is a floor ("at least", fe-followup M1).
 */
export function notRunSentence(notRunCalls: number, complete = true): string {
  return (
    `Separately, ${complete ? "" : "at least "}${plural(notRunCalls, "call")} this month did not run: the payment could not be set up in time, ` +
    "so nothing was held and nothing was charged. They are not counted above."
  );
}

/**
 * The count of a reason nested under its line. The line counts the calls
 * (`GET /withheld`), and its reasons are parts of it, so a reason reads
 * "4 of 4 calls", never a second count beside the line's (BUG-X-01). When the
 * reason's count is not a part of the line's (the fold reads at most 1,000
 * calls, the line is the ledger's), it is a plain count.
 */
export function partOfLine(reasonCalls: number, lineCalls: number): string {
  if (lineCalls > 0 && reasonCalls <= lineCalls) {
    return `${reasonCalls.toLocaleString("en-US")} of ${plural(lineCalls, "call")}`;
  }
  return plural(reasonCalls, "call");
}
