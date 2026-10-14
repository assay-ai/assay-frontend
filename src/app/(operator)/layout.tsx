"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { pendingBadge } from "@/features/operator/approvals";
import { OperatorRefusal, SuspendedBanner } from "@/features/operator/operator-refusal";
import { OperatorSessionContext } from "@/features/operator/session-context";
import { msUntilExpiry } from "@/features/operator/sign-in";
import { OperatorSignInScreen } from "@/features/operator/sign-in-screen";
import { ApiError } from "@/libs/ApiClient";
import { toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import {
  clearOperatorSession,
  readOperatorSession,
  subscribeOperatorSession,
  type OperatorSessionEnd,
  type OperatorSessionRecord,
} from "@/libs/operator-session";
import { getOperatorIdentity, listApprovals, logoutOperator } from "@/services/operator.service";

/**
 * The operator console shell.
 *
 * ## This route group authenticates by itself
 *
 * The operator signs in with a wallet (`OperatorSignInScreen`): the backend
 * issues an EIP-4361 message, the wallet signs it, and the verify answers an
 * 8-hour session held under its own storage key (`src/libs/operator-session.ts`),
 * never the buyer and provider `accessToken`.
 *
 * `operatorApi` is built with `triggerGlobalUnauthorized: false` so an expired
 * operator session cannot sign a buyer out. Its own 401 handler drops the
 * operator session instead, and this shell subscribes to that: a 401 on ANY
 * operator call, an expiry timer, or Sign out all return to the sign-in screen.
 *
 * ## Why the session is read in an effect
 *
 * `localStorage` does not exist during the server render, so the first paint is
 * always the loading one and the session arrives on the first commit.
 *
 * ## The Toaster
 *
 * A `toast()` with no `<Toaster />` in the tree is a silent no-op. Every
 * operator action reports its result by toast, so the mount below is
 * load-bearing.
 */

/** The console's screens. Case pages are reached from the queue. */
const CONSOLE_NAV: readonly { href: string; label: string }[] = [
  { href: "/operator", label: "Queue" },
  { href: "/operator/approvals", label: "Approvals" },
  { href: "/operator/blocks", label: "Blocks" },
  { href: "/operator/arbiter", label: "Arbiter" },
  { href: "/operator/operators", label: "Operators" },
  { href: "/operator/override-log", label: "Override log" },
];

const PENDING_PAGE = 100;

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  /** `null` = signed out. `undefined` = storage not read yet (first render / SSR). */
  const [session, setSession] = React.useState<OperatorSessionRecord | null | undefined>(undefined);
  const [lastEnd, setLastEnd] = React.useState<OperatorSessionEnd | null>(null);

  React.useEffect(() => {
    setSession(readOperatorSession());
    return subscribeOperatorSession((end) => {
      setSession(readOperatorSession());
      setLastEnd(end);
      // Whatever the last operator could see must not be shown to the next.
      if (end) queryClient.removeQueries({ queryKey: ["operator"] });
    });
  }, [queryClient]);

  // Expiry: back to sign-in the moment the session ends, not on the next 401.
  const expiresAt = session?.expiresAt;
  React.useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => clearOperatorSession("expired"), msUntilExpiry(expiresAt));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const identityQuery = useQuery({
    queryKey: ["operator", "me", session?.token ?? null],
    queryFn: getOperatorIdentity,
    retry: 0,
    enabled: Boolean(session),
  });

  const { data, error, isError, isLoading } = identityQuery;

  const pendingQuery = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: PENDING_PAGE }),
    enabled: Boolean(session && data),
    refetchInterval: 30_000,
    retry: 0,
  });
  const badge = pendingQuery.data
    ? pendingBadge(pendingQuery.data.items.length, pendingQuery.data.pageInfo.hasMore)
    : null;

  const signOut = React.useCallback(async () => {
    try {
      await logoutOperator();
    } catch {
      /* the session is dropped here whatever the backend answered */
    }
    clearOperatorSession("signed-out");
  }, []);

  let body: React.ReactNode;

  if (session === undefined) {
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (session === null) {
    body = <OperatorSignInScreen lastEnd={lastEnd} onSignedIn={() => setLastEnd(null)} />;
  } else if (isLoading) {
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (isError) {
    // A 401 has already ended the session and drawn the sign-in screen. What
    // reaches here is another refusal: a 403 for an operator removed or
    // suspended since signing in, among them.
    body =
      error instanceof ApiError && error.status === 401 ? (
        <p className="text-body-13 text-03">Loading…</p>
      ) : (
        <OperatorRefusal error={error} onSignOut={() => void signOut()} />
      );
  } else if (!data) {
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (data.status !== "ACTIVE") {
    body = (
      <SuspendedBanner
        detail={`Operator is ${data.status.toLowerCase()}: ${data.subject}`}
        onSignOut={() => void signOut()}
      />
    );
  } else {
    body = (
      <OperatorSessionContext.Provider value={data}>
        <header className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-01 pb-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-heading-md text-01">{data.displayName}</p>
            <p className="truncate font-mono text-mono-13 text-03">
              {data.subject}
              {data.walletAddress ? ` · ${toChecksumAddress(data.walletAddress)}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Your roles">
            {data.roles.map((role) => (
              <Tag key={role} variant="secondary" size="sm">
                {role}
              </Tag>
            ))}
          </div>

          <nav aria-label="Operator console" className="ml-auto flex flex-wrap items-center gap-3">
            {CONSOLE_NAV.map((item) => {
              const active =
                item.href === "/operator" ? pathname === "/operator" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "inline-flex items-center gap-1 text-label-13 text-01 underline underline-offset-4"
                      : "inline-flex items-center gap-1 text-label-13 text-02 hover:text-01 hover:underline"
                  }
                >
                  {item.label}
                  {item.href === "/operator/approvals" && badge ? (
                    <span
                      className="rounded-full bg-primary-500 px-1.5 font-mono text-mono-12 text-on-color"
                      aria-label={`${badge} pending`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <Button type="button" variant="secondary" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>

        {children}
      </OperatorSessionContext.Provider>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-02">
      {/* Same Main as the provider console: gap 16, padding
          [22, 26] from tablet, gap 14 / padding 16 below it. */}
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 p-4 tablet:gap-4 tablet:px-[26px] tablet:py-[22px]">
        {body}
      </main>

      <Toaster
        position="top-center"
        icons={{
          success: <CheckCircle className="mt-2 text-xl" />,
          error: <AlertFill className="mt-2 text-danger-500" />,
        }}
      />
    </div>
  );
}
