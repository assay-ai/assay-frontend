"use client";

import { Check } from "lucide-react";

import { buyerCostLines } from "@/features/explorer/buyer-costs";
import { useChains } from "@/hooks/useChains";
import { cn } from "@/utils";

/** "What it costs you" as a checked list, from the served chain list. */
export function BuyerCosts({ className }: { className?: string }) {
  const { chains } = useChains();
  return (
    <ul className={cn("flex flex-col gap-2", className)} data-testid="buyer-costs">
      {buyerCostLines(chains).map((line) => (
        <li key={line} className="flex items-start gap-2 text-body-13 text-01">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-500" />
          {line}
        </li>
      ))}
    </ul>
  );
}
