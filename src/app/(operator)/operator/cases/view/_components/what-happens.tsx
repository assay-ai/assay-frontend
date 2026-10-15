import * as React from "react";

/**
 * "What happens", directly under a sheet's title: two to four short lines,
 * each with an icon — money moved and to whom, who must approve or sign, and
 * whether it can be undone (spec C7). Local to the penalty sheets until the
 * shared `ConfirmSheet.outcome` lands.
 */
export interface WhatHappensLine {
  icon: React.ReactElement;
  text: React.ReactNode;
}

export function WhatHappens({ lines }: { lines: readonly WhatHappensLine[] }) {
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-01 bg-02 px-3.5 py-3">
      <p className="text-label-13 text-01">What happens</p>
      <ul className="flex flex-col gap-1.5">
        {lines.map((line, index) => (
          <li key={index} className="flex items-start gap-2 text-body-13 text-02">
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-03 [&>svg]:size-4">
              {line.icon}
            </span>
            <span className="min-w-0">{line.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
