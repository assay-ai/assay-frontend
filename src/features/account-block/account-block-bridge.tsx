"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { onAccountBlocked, registerWriteGuard } from "@/libs/ApiClient";

import { blockedWriteGuard, getAccountBlockSnapshot, reportBlockedRefusal, resetAccountBlock } from "./state";
import { ACCOUNT_BLOCK_STATUS_KEY } from "./use-account-block";

/**
 * Connects `ApiClient` to the blocked-account banner. Pure side effect.
 *
 *  1. Every `403 ACCOUNT_BLOCKED` / `AUTH_ORGANIZATION_SUSPENDED` on the shared
 *     client is recorded as a refusal (the banner shows) and the block status
 *     is re-read, so the banner can say whether it is this account. Nothing
 *     here signs out or navigates — that is the 401 handler's job alone, and
 *     these codes never reach it.
 *  2. The write guard refuses writes client-side while the block is confirmed.
 *  3. A different identity starts with a clean slate.
 */
export function AccountBlockBridge({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { ready, authenticated, user } = usePrivy();

  React.useEffect(() => {
    onAccountBlocked((error) => {
      reportBlockedRefusal(error);
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_BLOCK_STATUS_KEY });
    });
    registerWriteGuard((method, url) =>
      blockedWriteGuard(getAccountBlockSnapshot().confirmed, method, url),
    );
    return () => {
      onAccountBlocked(null);
      registerWriteGuard(null);
    };
  }, [queryClient]);

  const identity = ready ? (authenticated ? (user?.id ?? "authenticated") : null) : undefined;
  const lastIdentity = React.useRef(identity);
  React.useEffect(() => {
    if (identity === undefined) return;
    if (lastIdentity.current !== undefined && lastIdentity.current !== identity) resetAccountBlock();
    lastIdentity.current = identity;
  }, [identity]);

  return <>{children}</>;
}
