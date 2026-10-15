import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * "What happens" — the consequence of a sheet's action, first, under its
 * title (OPERATOR-redesign §C7): two to four short lines, each with an icon —
 * the money moved and to whom, who must approve or sign, and whether it can
 * be undone. A sheet with this block drops its paragraph description.
 *
 *   <WhatHappens lines={[
 *     { icon: Ban, text: "It stops paying and being paid within seconds" },
 *     { icon: Users, text: "Lifting it later needs two people" },
 *   ]} />
 *
 * Package A's `ConfirmSheet` takes the same lines as its `outcome` prop.
 */
export interface WhatHappensLine {
  icon: LucideIcon;
  text: React.ReactNode;
  /** "warning" for a line the person must not miss. */
  tone?: "neutral" | "warning";
}

export function WhatHappens({ lines, className }: { lines: readonly WhatHappensLine[]; className?: string }) {
  return (
    <section aria-label="What happens" className={cn("flex w-full flex-col gap-2 rounded-lg bg-02 px-3.5 py-3", className)}>
      <h3 className="text-label-13 text-01">What happens</h3>
      <ul className="flex flex-col gap-1.5">
        {lines.map((line, index) => {
          const Icon = line.icon;
          return (
            <li
              key={index}
              className={cn("flex items-start gap-2 text-body-13 tabular-nums", line.tone === "warning" ? "text-warning-700" : "text-02")}
            >
              <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", line.tone === "warning" ? "text-warning-600" : "text-03")} />
              <span className="min-w-0">{line.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
