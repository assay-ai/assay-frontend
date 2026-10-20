"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { hasBlockStatusSession, settleBlockStatus } from "@/features/account-block/state";
import { ApiError, getSessionToken } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { getMeStatus, type MeStatusResponse } from "@/services/dashboard.service";

import { ME_STATUS_KEY } from "./keys";

export { ME_STATUS_KEY };

/** Refetched this often (and on focus) so a lifted block lifts the banner without a reload. */
export const ME_STATUS_POLL_MS = 60_000;

export type MeStatusPart = keyof MeStatusResponse;

/**
 * What a `null` part reads as: that part's request failed, exactly as the
 * three separate reads failed before. The other parts are unaffected.
 */
export function partUnavailable(part: MeStatusPart): ApiError {
  return new ApiError("ME_STATUS_PART_UNAVAILABLE", `${part} could not be read`, 0);
}

async function readMeStatus(): Promise<MeStatusResponse> {
  const requestedAt = Date.now();
  const status = await getMeStatus();
  // Before any observer's `confirmed` effect: a lifted confirmed block clears its refusals.
  if (status.blockStatus) settleBlockStatus(status.blockStatus.blocked === true, requestedAt);
  return status;
}

/**
 * One part of `GET /me/status`, as a query of its own: its data, or its error
 * when the part came back `null` (`select` throwing makes this observer's
 * result an error and keeps the part it last read, as a failed refetch did).
 *
 * `enabled: false` only subscribes: another observer does the fetching.
 * `poll` is for ONE observer per shell (`useAccountBlockStatus`): every
 * observer with an interval runs its own timer, so several would fetch
 * several times a minute. The others read the cache, refetch on focus when
 * stale, and see every refetch.
 */
export function useMeStatusPart<P extends MeStatusPart>(
  part: P,
  options: { poll?: boolean; enabled?: boolean } = {},
) {
  const { ready, authenticated } = usePrivy();
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  React.useEffect(() => setHasStoredToken(getSessionToken() !== null), []);
  const select = SELECTORS[part] as (status: MeStatusResponse) => NonNullable<MeStatusResponse[P]>;
  return useQuery<MeStatusResponse, ApiError, NonNullable<MeStatusResponse[P]>>({
    queryKey: ME_STATUS_KEY,
    queryFn: readMeStatus,
    select,
    // Not `ready` alone: on a token-based session Privy may never become ready.
    // The demo answers from fixtures with no session, like its other data.
    enabled:
      options.enabled !== false &&
      (demoEnabled() || hasBlockStatusSession({ ready, authenticated, hasStoredToken })),
    staleTime: 30_000,
    refetchInterval: options.poll ? ME_STATUS_POLL_MS : false,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

function selectPart<P extends MeStatusPart>(part: P) {
  return (status: MeStatusResponse): NonNullable<MeStatusResponse[P]> => {
    const value = status[part];
    if (value === null || value === undefined) throw partUnavailable(part);
    return value as NonNullable<MeStatusResponse[P]>;
  };
}

// Stable functions, so React Query runs each `select` once per answer, not once per render.
const SELECTORS: { [P in MeStatusPart]: (status: MeStatusResponse) => NonNullable<MeStatusResponse[P]> } = {
  blockStatus: selectPart("blockStatus"),
  unreadCount: selectPart("unreadCount"),
  debts: selectPart("debts"),
};
