"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";
import { OperatorRefusal, SuspendedBanner } from "@/features/operator/operator-refusal";
import { OperatorSessionContext } from "@/features/operator/session-context";
import { ApiError } from "@/libs/ApiClient";
import {
  clearOperatorToken,
  getOperatorToken,
  setOperatorToken,
} from "@/libs/operator-session";
import { getOperatorIdentity } from "@/services/operator.service";

/**
 * The operator console shell.
 *
 * ## This route group authenticates by itself
 *
 * Every other group in this app is behind Privy. This one is not: the operator
 * pastes a bearer token that `OperatorAuthGuard` validates, held in its own
 * `localStorage` key so that neither session can clear or impersonate the
 * other (`src/libs/operator-session.ts`).
 *
 * The consequence lands here. `operatorApi` is built with
 * `triggerGlobalUnauthorized: false` precisely so an expired operator token
 * cannot sign a buyer out — which means **nothing else in the app catches a
 * 401 from these endpoints**. The 401 effect and the `isError` branch below are
 * the only places a refused operator token is ever handled; without them the
 * console would sit on an error state forever with a dead token still in
 * storage.
 *
 * ## Why the token is read in an effect
 *
 * `getOperatorToken()` touches `localStorage`, which does not exist during the
 * server render. Reading it during render would either throw or produce markup
 * that disagrees with the client's. So the first paint is always the
 * unauthenticated one and the token arrives on the first commit.
 *
 * ## The Toaster
 *
 * `(main)/layout.tsx` is the only other layout that mounts one, and a `toast()`
 * with no `<Toaster />` anywhere in the tree is a silent no-op — not an error.
 * Every operator action reports its result by toast, so the mount below is
 * load-bearing, not decoration.
 */

/** The console's screens. Case pages are reached from the queue. */
const CONSOLE_NAV: readonly { href: string; label: string }[] = [
  { href: "/operator", label: "Queue" },
  { href: "/operator/blocks", label: "Blocks" },
  { href: "/operator/arbiter", label: "Arbiter" },
  { href: "/operator/override-log", label: "Override log" },
];

const TOKEN_COPY =
  "This surface authenticates separately from the platform login — paste an " +
  "operator credential to continue. It is not a Privy account.";

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  /** `null` = no token. `undefined` = storage not read yet (first render / SSR). */
  const [token, setToken] = React.useState<string | null | undefined>(undefined);
  const [draft, setDraft] = React.useState("");
  const [refused, setRefused] = React.useState(false);

  React.useEffect(() => {
    setToken(getOperatorToken());
  }, []);

  const identityQuery = useQuery({
    queryKey: ["operator", "me"],
    queryFn: getOperatorIdentity,
    retry: 0,
    // Without this the shell would fire a request it knows will 401 on every
    // visit that has no token yet, including the very first one.
    enabled: Boolean(token),
  });

  const { data, error, isError, isLoading } = identityQuery;

  /*
    The 401 path. Handled in an effect rather than in the render branch below
    because it writes: it drops the dead token so the next load prompts instead
    of failing, and returns the shell to the form.
  */
  React.useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearOperatorToken();
      setToken(null);
      setRefused(true);
    }
  }, [error]);

  function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setOperatorToken(value);
    setRefused(false);
    setDraft("");
    // The identity query may be sitting in an error state under the same key;
    // dropping it makes the new token a fresh fetch rather than a retry of a
    // query React Query already considers settled.
    queryClient.removeQueries({ queryKey: ["operator", "me"] });
    setToken(value);
  }

  function signOut() {
    clearOperatorToken();
    queryClient.removeQueries({ queryKey: ["operator", "me"] });
    setRefused(false);
    setToken(null);
  }

  let body: React.ReactNode;

  if (token === undefined) {
    // Pre-hydration and the single commit before the effect runs.
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (token === null) {
    body = (
      <form onSubmit={signIn} className="flex w-full max-w-[420px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-heading-md text-01">Operator console.</h1>
          <p className="text-body-13 text-02">{TOKEN_COPY}</p>
        </div>

        <Field
          label="Operator credential"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={refused ? "That token was refused." : undefined}
        />

        <Button type="submit" disabled={draft.trim().length === 0}>
          Continue
        </Button>
      </form>
    );
  } else if (isLoading) {
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (isError) {
    // A 401 has already been turned into the form above by the effect. What
    // reaches here is a different refusal — a suspended operator's 403 among
    // them — and the token is still stored, so each one offers Sign out.
    body = <OperatorRefusal error={error} onSignOut={signOut} />;
  } else if (!data) {
    body = <p className="text-body-13 text-03">Loading…</p>;
  } else if (data.status === "SUSPENDED") {
    /*
      Not what the backend does today: it refuses `/operator/me` for a
      suspended operator, which is the branch above. Kept so that an identity
      that ever does arrive as suspended draws the same banner and never the
      queue of decide, second and compensate buttons.
    */
    body = (
      <SuspendedBanner
        detail={`Operator is suspended: ${data.subject}`}
        onSignOut={signOut}
      />
    );
  } else {
    body = (
      <OperatorSessionContext.Provider value={data}>
        <header className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-01 pb-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-heading-md text-01">{data.displayName}</p>
            <p className="truncate font-mono text-mono-13 text-03">{data.subject}</p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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
                      ? "text-label-13 text-01 underline underline-offset-4"
                      : "text-label-13 text-02 hover:text-01 hover:underline"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={signOut}
          >
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
