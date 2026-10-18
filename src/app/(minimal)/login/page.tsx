"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Coins, Lock, ScanSearch, ShieldCheck, Split, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { TestnetChip } from "@/components/patterns/testnet-chip";
import { Button } from "@/components/ui/button";
import { GLOSSARY } from "@/libs/glossary";
import { isStrictPagePath, loadPage } from "@/features/oauth/strict-pages";
import { safeNextPath } from "@/libs/login-redirect";
import { cn } from "@/utils";

import { startReadyTimeout } from "./ready-timeout";

/**
 * Login — the only sign-in screen the product has.
 *
 * **No design frame exists for it.** The product went from "no login" straight
 * to Privy, and nothing in the design file draws a login page. So
 * this screen is composed from Foundations tokens and the marketing
 * surface's own copy rather than from a frame: the headline and the three
 * value lines are lifted verbatim from "How it works", and the
 * money figures are that frame's illustrative constants ($0.0100 listed /
 * $0.0000 paid), not a measurement. Do not re-word them here — change them in
 * `/how-it-works` and mirror, or the two surfaces start making different
 * promises.
 *
 * ## Layout
 *
 * Two panes from `tablet` (834) up: a dark-scoped `$bg-02` brand pane carrying the
 * proposition, and a `$bg-01` form pane carrying the single action. Below
 * `tablet` the brand pane is dropped entirely — its content is marketing, and
 * stacking it above the form on a phone puts the one control the screen exists
 * for below the fold.
 *
 * The brand pane carries `data-theme="dark"`, so every token inside it
 * resolves to the dark (landing) palette in both app themes: `$text-01` and
 * `$text-03` on `$bg-02`, `$overlay-light-10` fills for its surfaces.
 *
 * ## Route group
 *
 * `(minimal)`, not `(public)` — `(public)/layout.tsx` wraps children in
 * `PublicTopBar`, the marketing nav, which does not belong on a sign-in
 * screen. `(minimal)/layout.tsx` special-cases this route twice: it hides the
 * `MinimalBar` (no signed-in tenant to name) and drops the main element's
 * padding so these two panes can run full-bleed. There is no middleware, so
 * the route is reachable unauthenticated regardless of which group it sits in.
 *
 * ## Two pitches
 *
 * Sent here from a provider page (`next` under `/provider`), the brand pane
 * carries the provider's pitch instead (paid per call, payouts never clawed
 * back, what the stake risks) and the newcomer link goes to Why list here; the
 * buyer's "we hold, not charge" would read to an API owner as "the platform
 * keeps money from my calls". Those lines follow `/why-list-here`.
 */

/** Verbatim from the how-it-works design's flow steps 2–4. */
const PROOF_POINTS = [
  {
    icon: Lock,
    title: "We hold, not charge",
    detail: "The amount is reserved from your balance. Nothing has left it yet.",
  },
  {
    icon: ScanSearch,
    title: "We check the result",
    detail: "Response shape and result-quality rules run on every call, at every price.",
  },
  {
    icon: Split,
    title: "Money moves, or it does not",
    detail: "Passed: you pay the serving provider's price, never more than the hold. Failed: you keep the money.",
  },
];

/**
 * The provider's pitch, from `/why-list-here`: what you earn, when a payment
 * is final, what the stake risks. The last two are the glossary's sentences.
 */
const PROVIDER_POINTS = [
  {
    icon: Coins,
    title: "Paid per call, on chain",
    detail: "Buyers pay your price for each call whose result passes the check; you are paid on chain, to your own wallet, after Assay's fee.",
  },
  {
    icon: Wallet,
    title: "Payouts are never clawed back",
    detail: GLOSSARY["payout-final"].definition,
  },
  {
    icon: ShieldCheck,
    title: "What your stake risks",
    detail: GLOSSARY["stake-rule"].definition,
  },
];

/** The logo, as a link back to the public site (How it works). */
function BrandLockup({ className }: { className?: string }) {
  return (
    <Link
      href="/how-it-works"
      aria-label="Assay: back to the site"
      className={cn(
        "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo.png"
        alt=""
        aria-hidden="true"
        className="h-[22px] w-[22px] shrink-0 rounded-md object-cover"
      />
      <span className="text-[17px] font-medium leading-none tracking-[-0.025em]">Assay</span>
    </Link>
  );
}

/** The buyer's pitch, verbatim from How it works. */
function BuyerPitch() {
  return (
    <>
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3.5">
          <h2 className="max-w-[420px] text-heading-lg text-01 desktop:text-display-md">
            {"You don't pay for results you can't use."}
          </h2>
          <p className="max-w-[420px] text-body-sm text-03">
            Your agent calls a tool. We check the result before the money moves — and we show you
            the amount we did not take.
          </p>
        </div>

        {/* The counterfactual, in the shape `MoneyPair` renders it on the
            light surfaces. Hand-rolled rather than reused because that
            component is built for `$bg-01` and binds `$text-01`/`$teal-600`,
            both of which are wrong on this ground. */}
        <div className="flex max-w-[420px] flex-col gap-2.5 rounded-xl bg-overlay-light px-5 py-[18px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-body-13 text-03">Listed price</span>
            <span className="text-mono-13 font-mono font-semibold text-01">$0.0100</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-body-13 text-03">You paid</span>
            <span className="text-mono-13 font-mono font-semibold text-01">$0.0000</span>
          </div>
          <div className="flex items-center justify-between gap-4 pt-2.5">
            <span className="text-label-13 text-teal-400">Not charged</span>
            <span className="text-mono-13 font-mono font-semibold text-teal-400">$0.0100</span>
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-4">
        {PROOF_POINTS.map((point) => {
          const Icon = point.icon;
          return (
            <li key={point.title} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-overlay-light">
                <Icon aria-hidden="true" className="h-[15px] w-[15px] text-01" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-label-13 text-01">{point.title}</span>
                <span className="text-body-xs text-03">{point.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The provider's pitch, from Why list here, and the way to read the whole offer. */
function ProviderPitch() {
  return (
    <>
      <div className="flex flex-col gap-3.5">
        <h2 className="max-w-[420px] text-heading-lg text-01 desktop:text-display-md">List an API. Get paid per call.</h2>
        <p className="max-w-[420px] text-body-sm text-03">
          Agents pay for your tool through Assay, per call. We check each result before the money moves, so buyers
          pay only for results they can use.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-4">
          {PROVIDER_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <li key={point.title} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-overlay-light">
                  <Icon aria-hidden="true" className="h-[15px] w-[15px] text-01" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-label-13 text-01">{point.title}</span>
                  <span className="text-body-xs text-03">{point.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <Link
          href="/why-list-here"
          className="group inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-01 underline-offset-2 hover:underline"
        >
          Why list here: earnings, stake and terms
          <ArrowRight aria-hidden="true" className="h-[13px] w-[13px] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </>
  );
}

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to go after signing in: the page a 401 sent us from, or Overview
  // (where a brand-new account finds its Get started checklist).
  const next = safeNextPath(searchParams.get("next"));
  const expired = searchParams.get("reason") === "expired";
  // Sent here from a provider page (List a tool, Start listing): say so.
  const listing = next.startsWith("/provider");

  useEffect(() => {
    if (!ready || !authenticated) return;
    // Back to a strict page (the consent page): a full load, so it gets its own headers.
    if (isStrictPagePath(next)) loadPage(next);
    else router.replace(next);
  }, [ready, authenticated, router, next]);

  // Don't flash a sign-in form at someone who is already signed in.
  const signedIn = ready && authenticated;

  // Privy that never becomes ready (origin refused, outage) would otherwise
  // leave the spinner up forever (BUG-R8-L-01). `ready` arriving late still
  // wins: `stuck` is false again and the normal button returns.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return;
    return startReadyTimeout(() => setTimedOut(true));
  }, [ready]);
  const stuck = !ready && timedOut;

  return (
    <div className="flex min-h-full w-full flex-1 flex-col tablet:flex-row">
      {/* Brand pane — marketing only, so it is dropped below tablet rather
          than stacked above the form. */}
      {/* Always the landing's dark ground, whatever the app theme: the
          pane scopes the dark tokens to itself. */}
      <aside
        data-theme="dark"
        className="hidden flex-col justify-between gap-10 border-r border-01 bg-02 px-10 py-11 tablet:flex tablet:w-[46%] tablet:max-w-[560px] desktop:px-14"
      >
        <BrandLockup className="flex items-center gap-2 text-01" />

        {listing ? <ProviderPitch /> : <BuyerPitch />}
      </aside>

      {/* Form pane. */}
      <section className="flex flex-1 flex-col items-center justify-center bg-01 px-6 py-14 tablet:px-10">
        <div className="flex w-full max-w-[368px] flex-col gap-8">
          <div className="flex flex-col gap-4">
            <Link
              href="/how-it-works"
              className="inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-02 hover:text-01"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Back to the site
            </Link>
            <div className="flex items-center justify-between gap-3">
              <BrandLockup className="flex items-center gap-2 text-01 tablet:hidden" />
              <TestnetChip className="ml-auto" />
            </div>
          </div>

          {expired ? (
            <p
              role="status"
              className="rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700"
            >
              Your session expired. Sign in again.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <h1 className="text-heading-lg text-01">{listing ? "Sign in to start listing" : "Sign in"}</h1>
            <p className="text-body-sm text-02">
              Continue to your Assay account. Email or wallet — there is no password to remember.
            </p>
            <p className="text-body-sm text-02">One account for using and listing tools.</p>
          </div>

          <div className="flex flex-col gap-3">
            {/* `!ready` is Privy still resolving an existing session, and it is
                the common case on a warm reload. Rendering nothing at all (the
                previous behaviour) showed a blank page for that beat; a
                disabled button in the finished layout keeps the screen from
                moving under the cursor when it resolves. */}
            {stuck ? (
              <>
                <p role="alert" className="text-body-sm text-01">
                  Sign-in is taking longer than expected.
                </p>
                <Button className="w-full py-3" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              </>
            ) : (
              <Button
                className="w-full py-3"
                disabled={!ready || signedIn}
                loading={!ready || signedIn}
                onClick={() => login()}
              >
                {!ready
                  ? "Loading sign-in…"
                  : signedIn
                    ? "Signing you in"
                    : "Continue with email or wallet"}
              </Button>
            )}
            <p className="text-body-xs text-03">A sign-in window opens here: email code or wallet.</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="h-px w-full bg-03" />
            <Link
              href={listing ? "/why-list-here" : "/how-it-works"}
              className="group inline-flex items-center gap-1.5 text-label-13 text-02 hover:text-01"
            >
              {listing ? "New to listing? See why to list here" : "New to Assay? See how it works"}
              <ArrowRight
                aria-hidden="true"
                className="h-[13px] w-[13px] transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
