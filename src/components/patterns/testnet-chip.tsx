"use client";

import { FlaskConical } from "lucide-react";

import type { Chain } from "@/interfaces/chain";
import { isTestnet } from "@/features/buyer-money/gas-help";
import { useChains } from "@/hooks/useChains";
import { cn } from "@/utils";

type ChainLike = Pick<Chain, "displayName" | "chainId">;

/**
 * Whether this deployment runs on test money: every chain it serves is a test
 * network. A mixed list (one testnet, one main network) is not "testnet" as a
 * whole, so the deployment-wide chip stays off and each signing sheet decides
 * for its own chain. An empty list (still loading, or unreadable) is not
 * evidence of anything, so it is `false` too.
 */
export function deploymentIsTestnet(chains: readonly ChainLike[]): boolean {
  return chains.length > 0 && chains.every((chain) => isTestnet(chain));
}

/** The chip's hover text: which network, and what that means for money. */
export function testnetTitle(chains: readonly ChainLike[]): string {
  const names = Array.from(new Set(chains.map((chain) => chain.displayName)));
  const where = names.length ? names.join(", ") : "a test network";
  return `Runs on ${where}. Payments use test tokens with no real value.`;
}

/**
 * "Testnet · test money", from the served chain list (`GET /chains`) and
 * `isTestnet()`; nothing at all on a main network.
 *
 * Without `chain` it speaks for the whole deployment (top bars, public pages,
 * login). With `chain` it speaks for that one chain (a funding hero, a signing
 * sheet), so a sheet on a main network never carries the label even when
 * another served chain is a testnet.
 */
export function TestnetChip({
  chain,
  className,
  compact = false,
}: {
  /** The chain this screen moves money on. Omit to use every served chain. */
  chain?: ChainLike | null;
  className?: string;
  /** "Testnet" only, for narrow bars. */
  compact?: boolean;
}) {
  const { chains } = useChains();
  const scope: readonly ChainLike[] = chain ? [chain] : chains;
  if (!deploymentIsTestnet(scope)) return null;
  const title = testnetTitle(scope);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700",
        className,
      )}
      title={title}
      data-testid="testnet-chip"
    >
      <FlaskConical aria-hidden="true" className="size-3" />
      {/* Narrow bars (under 420 px) keep the flask and the screen-reader text only. */}
      <span className={compact ? "max-[419px]:sr-only" : undefined}>{compact ? "Testnet" : "Testnet · test money"}</span>
      <span className="sr-only">. {title}</span>
    </span>
  );
}
