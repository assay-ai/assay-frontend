"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConsentCard } from "@/components/oauth/consent-card";
import { ConsentSetLimits } from "@/components/oauth/consent-set-limits";
import { CONSENT_STRINGS, ContinueUrlRefused, consentFailure, isContinueUrl } from "@/features/oauth/consent";
import { forgetRequestId, takeRequestId } from "@/features/oauth/request-id";
import { ApiError } from "@/libs/ApiClient";
import { loginHref } from "@/libs/login-redirect";
import { approveOAuthRequest, denyOAuthRequest, getOAuthRequest } from "@/services/oauth-consent.service";

/**
 * `{WEB}/connect/authorize`: the OAuth consent page (spec §6.5).
 *
 * The MCP host sends the browser here with the request id in the fragment.
 * `takeRequestId` reads it, keeps it for this tab and strips it from the
 * address bar; a signed-out visitor goes through `/login?next=%2Fconnect%2Fauthorize`
 * and the id is found again on return. The id is used only in the consent
 * API's path: never in a query key, a URL built here, analytics or a log.
 *
 * Approve and Cancel are a person's clicks on this page (the API accepts only
 * a person's session, and the card's guards refuse framed or hurried clicks).
 * Each one then navigates to the API's `redirectTo`, the MCP host's
 * `continue` step, which hands the result to the app.
 *
 * No analytics on this route, and `_headers` gives `/connect/*` a strict CSP,
 * `frame-ancestors 'none'` and `Referrer-Policy: no-referrer`.
 */
export default function ConsentPage() {
  const { ready, authenticated, user, logout } = usePrivy();
  const router = useRouter();
  // undefined: not read yet (before mount); null: there is none.
  const [rid, setRid] = React.useState<string | null | undefined>(undefined);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    setRid(takeRequestId());
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const signedOut = ready && !authenticated;
  React.useEffect(() => {
    if (signedOut && rid) router.replace(loginHref({ next: "/connect/authorize" }));
  }, [signedOut, rid, router]);

  const query = useQuery({
    // The id is deliberately not in the key.
    queryKey: ["oauth", "consent-request"],
    enabled: Boolean(rid) && ready && authenticated,
    queryFn: () => getOAuthRequest(rid!),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const loadFailure = query.error ? consentFailure(query.error instanceof ApiError ? query.error.code : undefined) : null;
  React.useEffect(() => {
    if (loadFailure?.kind === "final") forgetRequestId();
  }, [loadFailure?.kind]);

  const go = (redirectTo: string) => {
    if (!isContinueUrl(redirectTo)) throw new ContinueUrlRefused();
    forgetRequestId();
    window.location.assign(redirectTo);
  };

  const signedInAs = user?.email?.address ?? user?.wallet?.address ?? null;

  let body: React.ReactNode;
  if (rid === null) {
    body = <Notice text={CONSENT_STRINGS.missing} />;
  } else if (rid !== undefined && ready && !signedOut && query.data) {
    body = (
      <ConsentCard
        request={query.data}
        now={now}
        signedInAs={signedInAs}
        onSignOut={() => void logout()}
        onApprove={async (decision) => go((await approveOAuthRequest(rid, decision)).redirectTo)}
        onDeny={async () => go((await denyOAuthRequest(rid)).redirectTo)}
        onFinal={forgetRequestId}
        setLimits={(slot) => <ConsentSetLimits {...slot} />}
      />
    );
  } else if (loadFailure) {
    body =
      loadFailure.kind === "final" ? (
        <Notice text={loadFailure.text} />
      ) : (
        <Notice text={loadFailure.text} retry={() => void query.refetch()} />
      );
  } else {
    body = <Notice text="Loading the request…" busy />;
  }

  return <div className="flex w-full flex-1 justify-center px-4 py-8 tablet:py-12">{body}</div>;
}

function Notice({ text, busy = false, retry }: { text: string; busy?: boolean; retry?: () => void }) {
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-3 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
      <h1 className="text-heading-md text-01">{CONSENT_STRINGS.heading}</h1>
      <p role="status" aria-busy={busy || undefined} className="text-body-sm text-02">
        {text}
      </p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="self-start text-label-13 font-semibold text-primary-600 hover:underline"
        >
          Try again
        </button>
      ) : null}
    </section>
  );
}
