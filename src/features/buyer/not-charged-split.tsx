import { notChargedLines, notChargedSplitText } from "./not-charged";
import type { WithheldForAsset } from "./wire";

/**
 * "Not charged: 4 failed our checks (incl. wrong format), 10 had no usable
 * result, 5 not collected." — the /spend headline's reasons, in the words the
 * Not charged page and the statement use. Nothing when no call was withheld.
 */
export function NotChargedSplitLine({
  withheld,
}: {
  withheld: WithheldForAsset | null | undefined;
}) {
  const text = withheld ? notChargedSplitText(notChargedLines(withheld)) : null;
  if (!text) return null;
  return (
    <p className="text-body-13 text-03" data-testid="spend-not-charged-split">
      Not charged: {text}.
    </p>
  );
}
