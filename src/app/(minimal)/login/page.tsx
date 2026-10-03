"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Lock, ScanSearch, Split } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

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
 * Two panes from `tablet` (834) up: a `$bg-inverse` brand pane carrying the
 * proposition, and a `$bg-01` form pane carrying the single action. Below
 * `tablet` the brand pane is dropped entirely — its content is marketing, and
 * stacking it above the form on a phone puts the one control the screen exists
 * for below the fold.
 *
 * The dark pane's surfaces are `$overlay-light-10` fills with **no borders**:
 * the border ramp (`$border-01..03`) is a light-ground ramp and every step of
 * it reads as a bright line on `$bg-inverse`. Text on that pane is
 * `$text-inverse` and `$text-03` only — `$text-02` (#58616e) sits at ~3:1
 * against #0b0d10 and fails contrast for body copy, which is why it appears
 * nowhere here.
 *
 * ## Route group
 *
 * `(minimal)`, not `(public)` — `(public)/layout.tsx` wraps children in
 * `PublicTopBar`, the marketing nav, which does not belong on a sign-in
 * screen. `(minimal)/layout.tsx` special-cases this route twice: it hides the
 * `MinimalBar` (no signed-in tenant to name) and drops the main element's
 * padding so these two panes can run full-bleed. There is no middleware, so
 * the route is reachable unauthenticated regardless of which group it sits in.
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
    detail: "Passed: the hold is charged. Failed: you keep the money.",
  },
];

function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo.png"
        alt=""
        aria-hidden="true"
        className="h-[22px] w-[22px] shrink-0 rounded-md object-cover"
      />
      <span className="text-mono-sm font-mono font-semibold">GoAssay.AI</span>
    </div>
  );
}

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  // Don't flash a sign-in form at someone who is already signed in.
  const signedIn = ready && authenticated;

  return (
    <div className="flex min-h-full w-full flex-1 flex-col tablet:flex-row">
      {/* Brand pane — marketing only, so it is dropped below tablet rather
          than stacked above the form. */}
      <aside className="hidden flex-col justify-between gap-10 bg-inverse px-10 py-11 tablet:flex tablet:w-[46%] tablet:max-w-[560px] desktop:px-14">
        <BrandLockup className="flex items-center gap-2 text-inverse" />

        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-3.5">
            <h2 className="max-w-[420px] text-heading-lg text-inverse desktop:text-display-md">
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
              <span className="text-mono-13 font-mono font-semibold text-inverse">$0.0100</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-body-13 text-03">You paid</span>
              <span className="text-mono-13 font-mono font-semibold text-inverse">$0.0000</span>
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
                  <Icon aria-hidden="true" className="h-[15px] w-[15px] text-inverse" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-label-13 text-inverse">{point.title}</span>
                  <span className="text-body-xs text-03">{point.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Form pane. */}
      <section className="flex flex-1 flex-col items-center justify-center bg-01 px-6 py-14 tablet:px-10">
        <div className="flex w-full max-w-[368px] flex-col gap-8">
          <BrandLockup className="flex items-center gap-2 text-01 tablet:hidden" />

          <div className="flex flex-col gap-2">
            <h1 className="text-heading-lg text-01">Sign in</h1>
            <p className="text-body-sm text-02">
              Continue to your GoAssay.AI account. Email or wallet — there is no password to remember.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {/* `!ready` is Privy still resolving an existing session, and it is
                the common case on a warm reload. Rendering nothing at all (the
                previous behaviour) showed a blank page for that beat; a
                disabled button in the finished layout keeps the screen from
                moving under the cursor when it resolves. */}
            <Button
              className="w-full py-3"
              disabled={!ready || signedIn}
              loading={!ready || signedIn}
              onClick={() => login()}
            >
              {!ready
                ? "Checking your session"
                : signedIn
                  ? "Signing you in"
                  : "Continue with email or wallet"}
            </Button>
            <p className="text-body-xs text-03">
              A secure window from Privy opens to finish signing in. Allow pop-ups for this site if
              nothing appears.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="h-px w-full bg-03" />
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-1.5 text-label-13 text-02 hover:text-01"
            >
              New to GoAssay.AI? See how it works
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
