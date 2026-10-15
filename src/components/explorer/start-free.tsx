"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { loginHref } from "@/libs/login-redirect";
import { cn } from "@/utils";

/** The promise under every "Start free": what it costs and what comes next. */
export const START_FREE_PROMISE = "Free: no card. Add funds only when you want paid calls.";

/** Whether this browser has a signed-in person (Privy has settled and says so). */
export function useSignedIn(): boolean {
  const { ready, authenticated } = usePrivy();
  return ready && authenticated;
}

/**
 * The newcomer's call to action on the public pages. Signed out: "Start free"
 * with the one-line promise under it. Signed in: "Open app" straight to `next`,
 * because sending a signed-in person to a sign-in page is a dead step.
 */
export function StartFreeCta({
  next = "/",
  label = "Start free",
  className,
  promiseClassName,
}: {
  next?: string;
  label?: string;
  className?: string;
  promiseClassName?: string;
}) {
  const signedIn = useSignedIn();
  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <Button asChild>
        <Link href={signedIn ? next : loginHref({ next })}>
          {signedIn ? "Open app" : label}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      {signedIn ? null : <p className={cn("text-body-xs text-03", promiseClassName)}>{START_FREE_PROMISE}</p>}
    </div>
  );
}
