"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { getProviderMe } from "@/services/provider-profile.service";

import { HOLD_RESUMES, HOLD_WHAT_TO_DO, PENALTIES_ON_CHAIN_HREF, slashHoldBanner } from "./model";

/**
 * The slash-hold banner, mounted once in the provider console shell.
 *
 * Shares `["provider", "me"]` with the screens that read the provider record.
 * An unregistered organization (`404 PROVIDER_NOT_FOUND`) or a failed read
 * shows nothing: the banner only ever speaks about a hold the backend reported.
 */
export function SlashHoldBanner({ wrapperClassName }: { wrapperClassName?: string }) {
  const me = useQuery({
    queryKey: ["provider", "me"],
    queryFn: getProviderMe,
    retry: 0,
    // A hold starts and lifts on the chain's schedule, so re-read it; not after a refusal (an unregistered org).
    refetchInterval: (query) => (query.state.error ? false : 60_000),
  });
  const model = slashHoldBanner(me.data?.slashHolds);
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
            <span>
              {HOLD_WHAT_TO_DO}{" "}
              <Link href={PENALTIES_ON_CHAIN_HREF} className="font-semibold underline">
                Penalties on chain
              </Link>
              . {HOLD_RESUMES}
            </span>
          </span>
        }
      />
    </div>
  );
}
