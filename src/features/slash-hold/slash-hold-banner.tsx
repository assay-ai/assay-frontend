"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { routes } from "@/libs/routes";

import { HOLD_ADD_STAKE, HOLD_RESUMES, HOLD_WHAT_TO_DO, slashHoldBanner } from "./model";
import { providerQueries } from "@/features/provider-home/queries";
import { usePenalties } from "@/features/provider-penalties/use-penalties";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { formatMoney } from "@/utils/money";

/**
 * The slash-hold banner, mounted once in the provider console shell.
 *
 * Shares `["provider", "me"]` with the screens that read the provider record.
 * An unregistered organization (`404 PROVIDER_NOT_FOUND`) or a failed read
 * shows nothing: the banner only ever speaks about a hold the backend reported.
 */
export function SlashHoldBanner({ wrapperClassName }: { wrapperClassName?: string }) {
  const me = useQuery({
    ...providerQueries.me(),
    // A hold starts and lifts on the chain's schedule, so re-read it; not after a refusal (an unregistered org).
    refetchInterval: (query) => (query.state.error ? false : 60_000),
  });
  // The same reads as the nav badge and Stake: is any penalty open, and what is the minimum?
  const penalties = usePenalties({ withCases: "none" });
  const stake = useStakeStatus();
  // Unknown while the chain is read or could not be: the backend's words stay, penalties included.
  const penaltyPending = penalties.isLoading || penalties.isError ? undefined : penalties.rows.some((row) => row.tab !== "closed");
  const model = slashHoldBanner(me.data?.slashHolds, {
    penaltyPending,
    minimum: stake.required ? formatMoney(stake.required) : null,
  });
  if (!model) return null;

  return (
    <div className={wrapperClassName}>
      <Banner
        role="alert"
        tone="warning"
        title={model.title}
        description={
          <span className="flex flex-col gap-1">
            {model.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {model.penaltyRelated ? (
              <span>
                {HOLD_WHAT_TO_DO}{" "}
                <Link href={routes.penalties()} className="font-semibold underline">
                  Penalties on chain
                </Link>
                . {HOLD_RESUMES}
              </span>
            ) : (
              <span>
                {HOLD_ADD_STAKE}{" "}
                <Link href={routes.stake("stake")} className="font-semibold underline">
                  Add stake
                </Link>
                . {HOLD_RESUMES}
              </span>
            )}
          </span>
        }
      />
    </div>
  );
}
