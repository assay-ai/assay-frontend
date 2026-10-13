"use client";

import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";

import { bannerStateFor, blockSummary, dismissBlockedRefusal } from "./state";
import { useAccountBlockSnapshot, useAccountBlockStatus } from "./use-account-block";

export const BLOCKED_TITLE = "Your account is blocked by Assay";
export const BLOCKED_DESCRIPTION =
  "You can still sign in and view your data, but you cannot make payments or change anything, and your agents' requests are refused. Please contact Assay support to resolve this.";
export const REFUSED_TITLE = "This action was refused because an account in it is blocked";
export const REFUSED_DESCRIPTION =
  "Assay has blocked one of the accounts this action involves, for example a provider or a payment wallet, so nothing was changed. You can keep using the rest of your account. Contact Assay support if you think this is wrong.";

/**
 * The blocked-account banner, mounted once per signed-in shell.
 *
 * Reads `GET /account/block-status` (cached) and the latest blocked refusal.
 * A confirmed block is persistent — no dismiss — because every write will keep
 * being refused until an operator lifts it. A refusal that may be about
 * another party can be dismissed.
 */
export function AccountBlockBanner({ wrapperClassName }: { wrapperClassName?: string }) {
  const status = useAccountBlockStatus();
  const { refusal } = useAccountBlockSnapshot();
  const state = bannerStateFor(status.data, refusal);

  if (state.kind === "none") return null;

  if (state.kind === "blocked") {
    const lines = state.blocks.map((entry) => blockSummary(entry));
    return (
      <div className={wrapperClassName}>
        <Banner
        role="alert"
        tone="danger"
          title={BLOCKED_TITLE}
        description={lines.length > 0 ? `${BLOCKED_DESCRIPTION} ${lines.join(" ")}` : BLOCKED_DESCRIPTION}
        />
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <Banner
        role="alert"
        tone="warning"
        title={REFUSED_TITLE}
        description={REFUSED_DESCRIPTION}
        action={<BannerAction onClick={dismissBlockedRefusal}>Dismiss</BannerAction>}
      />
    </div>
  );
}
