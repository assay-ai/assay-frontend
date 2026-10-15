"use client";

import { ExternalLink } from "lucide-react";

import type { Chain } from "@/interfaces/chain";
import { gasHelp } from "@/features/buyer-money/gas-help";
import { cn } from "@/utils";

/** "No ETH for gas? …" on test networks only; nothing elsewhere. */
export function GasHelpNote({ chain, className }: { chain: Chain | null | undefined; className?: string }) {
  const help = gasHelp(chain);
  if (!help) return null;
  return (
    <p className={cn("text-body-xs text-03", className)} data-testid="gas-help">
      {help.text}
      {help.faucetUrl ? (
        <>
          {" "}
          <a
            href={help.faucetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline"
          >
            Open the faucet
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        </>
      ) : null}
    </p>
  );
}
