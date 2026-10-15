"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { PageState } from "@/components/patterns/page-state";
import { groupApprovals, needsYouCount } from "@/features/operator/inbox";
import { useToSign } from "@/features/operator/use-to-sign";
import { capabilitiesFor } from "@/features/operator/roles";
import { OperatorBottomTabs, OperatorMobileTopBar, OperatorTopBar } from "@/features/operator/operator-shell";
import { OperatorRefusal, SuspendedBanner } from "@/features/operator/operator-refusal";
import { OperatorSessionContext } from "@/features/operator/session-context";
import { msUntilExpiry, signOutOperator } from "@/features/operator/sign-in";
import { ConsoleShortcuts } from "@/features/operator/shortcuts";
import { OperatorSignInScreen } from "@/features/operator/sign-in-screen";
import { ApiError } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { DEMO_OPERATOR_TOKEN_PREFIX, type DemoOperatorPreset } from "@/libs/demo/fixtures-operator";
import {
  clearOperatorSession,
  readOperatorSession,
  saveOperatorSession,
  subscribeOperatorSession,
  type OperatorSessionEnd,
  type OperatorSessionRecord,
} from "@/libs/operator-session";
import { getOperatorIdentity, listApprovals, listArbiterDisputes, logoutOperator } from "@/services/operator.service";
import { useTheme } from "@/providers/ThemeProvider";

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

const PENDING_PAGE = 100;

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const { themeType } = useTheme();
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
  const canRule = data ? capabilitiesFor(data.roles).rule : false;
  const disputesQuery = useQuery({
    queryKey: ["operator", "arbiter", "disputes"],
    queryFn: listArbiterDisputes,
    enabled: Boolean(session && data && canRule),
    refetchInterval: 60_000,
    retry: 0,
  });
  const toSign = useToSign(Boolean(session && data && canRule));
  // The badge counts what this operator can act on — the same rule as the Home heading.
  const needsYou = data
    ? needsYouCount(
        pendingQuery.data ? groupApprovals(pendingQuery.data.items, data).needsYou.length : 0,
        disputesQuery.data?.length ?? 0,
        canRule,
        toSign.count,
      )
    : 0;

  // Ends the operator session only; the Privy login stays signed in.
  const signOut = React.useCallback(
    () => signOutOperator({ logout: logoutOperator, clear: () => clearOperatorSession("signed-out") }),
    [],
  );

  let body: React.ReactNode;
  const loading = <PageState kind="loading" rows={4} label="Loading the operator console" />;

  if (session === undefined) {
    body = loading;
  } else if (session === null) {
    body = <OperatorSignInScreen lastEnd={lastEnd} onSignedIn={() => setLastEnd(null)} />;
  } else if (isLoading) {
    body = loading;
  } else if (isError) {
    // A 401 has already ended the session and drawn the sign-in screen. What
    // reaches here is another refusal: a 403 for an operator removed or
    // suspended since signing in, among them.
    body =
      error instanceof ApiError && error.status === 401 ? (
        loading
      ) : (
        <OperatorRefusal error={error} onSignOut={() => void signOut()} />
      );
  } else if (!data) {
    body = loading;
  } else if (data.status !== "ACTIVE") {
    body = (
      <SuspendedBanner
        detail={`Operator is ${data.status.toLowerCase()}: ${data.subject}`}
        onSignOut={() => void signOut()}
      />
    );
  }

  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // Demo only: switch the role shown without going back to sign-in. What the
  // last role could see is dropped first, as on a real sign-out.
  const demoPreset: DemoOperatorPreset | null = session?.token.startsWith(DEMO_OPERATOR_TOKEN_PREFIX)
    ? (session.token.slice(DEMO_OPERATOR_TOKEN_PREFIX.length) as DemoOperatorPreset)
    : null;
  const switchDemoRole = React.useCallback(
    (preset: DemoOperatorPreset) => {
      if (!session) return;
      queryClient.removeQueries({ queryKey: ["operator"] });
      saveOperatorSession({ token: `${DEMO_OPERATOR_TOKEN_PREFIX}${preset}`, expiresAt: session.expiresAt });
    },
    [queryClient, session],
  );

  const signedIn = Boolean(session && data && data.status === "ACTIVE" && !isError);
  const shell = signedIn && data && session
    ? {
        identity: data,
        pathname,
        needsYou,
        expiresAt: session.expiresAt,
        onSignOut: () => void signOut(),
        demo: demoEnabled() && demoPreset ? { current: demoPreset, onSwitch: switchDemoRole } : null,
        onShortcuts: () => setShortcutsOpen(true),
      }
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-02">
      {shell ? (
        <>
          <div className="hidden md:block">
            <OperatorTopBar {...shell} />
          </div>
          <div className="md:hidden">
            <OperatorMobileTopBar {...shell} />
          </div>
        </>
      ) : null}

      {/* Same Main as the provider console: gap 16, padding [22, 26] from
          tablet, gap 14 / padding 16 below it. pb-28 keeps the last row clear
          of the bottom tab bar on phones. */}
      <main
        className={
          shell
            ? "mx-auto flex w-full min-w-0 max-w-[1200px] flex-1 flex-col gap-3.5 p-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] md:pb-4 tablet:gap-4 tablet:px-[26px] tablet:py-[22px]"
            : "mx-auto flex w-full min-w-0 max-w-[1200px] flex-1 flex-col gap-3.5 p-4 tablet:gap-4 tablet:px-[26px] tablet:py-[22px]"
        }
      >
        {shell && data ? <OperatorSessionContext.Provider value={data}>{children}</OperatorSessionContext.Provider> : body}
      </main>

      {shell ? (
        <>
          <div className="md:hidden">
            <OperatorBottomTabs identity={shell.identity} pathname={pathname} needsYou={needsYou} />
          </div>
          <ConsoleShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </>
      ) : null}

      <Toaster
        theme={themeType}
        position="top-center"
        icons={{
          success: <CheckCircle className="mt-2 text-xl" />,
          error: <AlertFill className="mt-2 text-danger-500" />,
        }}
      />
    </div>
  );
}
