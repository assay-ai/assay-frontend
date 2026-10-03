import { Check, CircleCheck, Info, Lock, Play, ScanSearch, Split, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { MoneyPair } from "@/components/ui/money-pair";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";

/**
 * How it works — route `/how-it-works`.
 *
 * **Why this lives in `(public)` and not in a shell of its own.** The design's
 * first child is the Public Top Bar with no overrides at all — the same shell
 * the other public pages use — so the design puts this
 * page in the provider marketing shell even though its copy addresses the
 * buyer. That is the design's call, not an inference: the frame names the
 * component. This file is therefore the frame's two remaining children only,
 * `Hero` and `Body`.
 *
 * **The nav does not link here, anywhere in the design.** The top bar carries
 * five nav items (Why list here · Calculator · Catalogue · Docs · CLI) and
 * this page overrides none of them; no other screen in the design links to
 * this page either. `public-top-bar.tsx`
 * is deliberately left alone — inventing a sixth nav label would be inventing
 * marketing copy.
 *
 * Static — no service call. Every figure is an illustrative constant drawn in
 * the frame ($0.0100 listed / held / charged), not a measurement.
 *
 * Three things worth knowing before editing:
 *
 * - **The four flow cards are not `Metric Tile` instances.** They
 *   are plain frames with a 26px `$primary-10` numeral disc, a 16px lucide
 *   glyph, a title, a description and a mono footnote. Only the fourth
 *   footnote is teal — it is the one that states the counterfactual.
 * - **The teal note's text binds a raw `#000000`**, which is
 *   near-invisible against `$teal-10` in dark mode. Substituted with
 *   `text-01`, the same substitution the other console screens made for
 *   the same defect.
 * - **The `Money Pair` is a bare ref with no overrides**, so it
 *   renders the design's own defaults — $0.0100 listed, $0.0000 paid, $0.0100
 *   not charged. Those three literals are the component's, transcribed here
 *   because `MoneyPair` requires them as props by design.
 *
 * Responsive behaviour is Foundations > "Breakpoints", not
 * invention: page padding 16/24/28, and a 4-across tile row that becomes 2
 * columns at tablet and 1 at mobile. The two panels stack below desktop
 * because the right one is a fixed 520px in the frame and there is no width
 * left for the other at 834.
 */

interface FlowStep {
  n: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  note: string;
  /** The fourth step's note is `$teal-600`; the first three are `$text-03`. */
  noteTeal?: boolean;
}

const FLOW: FlowStep[] = [
  {
    n: "1",
    icon: Terminal,
    title: "Your agent calls a tool",
    detail: "Through MCP or REST. It sees the price before it calls.",
    note: "$0.0100 listed",
  },
  {
    n: "2",
    icon: Lock,
    title: "We hold, not charge",
    detail: "The amount is reserved from your balance. Nothing has left it yet.",
    note: "$0.0100 held",
  },
  {
    n: "3",
    icon: ScanSearch,
    title: "We check the result",
    detail: "Response shape and the tool's result-quality rules run on every call, at every price.",
    note: "schema · rules · relevance",
  },
  {
    n: "4",
    icon: Split,
    title: "Money moves, or it does not",
    detail: "Passed: the hold is charged. Failed: the hold is released and you keep the money.",
    note: "charged $0.0100  ·  or  ·  $0.0000",
    noteTeal: true,
  },
];

/**
 * The design's seven check rows, in the design's order. Which of them apply is
 * set by each tool's verification policy, and the URL check validates syntax
 * and scheme only — it does not fetch the URL.
 */
const CHECKS = [
  "Empty result sets",
  "Schema-invalid bodies",
  "Missing required fields",
  "Malformed URLs",
  "Duplicated results",
  "Stale data past the freshness bound",
  "200 responses carrying an error envelope",
];

export default function HowItWorksPage() {
  return (
    <>
      {/* Hero */}
      <section className="flex w-full flex-col items-center gap-4 px-4 pb-[34px] pt-[52px] tablet:px-6 desktop:px-7">
        <h1 className="max-w-[940px] text-center text-display-lg text-01">
          {"You don't pay for results you can't use."}
        </h1>
        <p className="max-w-[720px] text-center text-body-md text-02">
          Your agent calls a tool. We check the result before the money moves. If the result is
          unusable, the charge never happens — and we show you the amount we did not take.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          {/*
            This CTA points at the live demo, which is not built — it is
            blocked on the backend. An enabled control that cannot act is the
            same failure as a search box that does nothing, so it ships
            disabled with a reason rather than linking to a 404. Restore it to
            a `<Link href="/demo">` once the demo lands; the copy is already the
            design's.
          */}
          <button
            type="button"
            disabled
            title="The live demo is not available yet."
            className="flex items-center gap-[7px] rounded-md bg-primary-500 px-[18px] py-3 text-label-sm text-on-color shadow-hair disabled:cursor-not-allowed disabled:bg-03 disabled:text-03 disabled:shadow-none"
          >
            <Play aria-hidden="true" className="h-[15px] w-[15px]" />
            Watch it refuse to charge
          </button>
          <Link
            href="/catalogue"
            className="flex items-center rounded-md border border-02 bg-01 px-[18px] py-3 text-label-sm text-01 shadow-hair hover:bg-02"
          >
            See the tools and prices
          </Link>
        </div>
      </section>

      {/* Body */}
      <div className="flex w-full flex-1 flex-col gap-[18px] px-4 pb-4 tablet:px-6 tablet:pb-6 desktop:px-7 desktop:pb-7">
        {/* Flow */}
        <div className="grid w-full grid-cols-1 gap-3.5 tablet:grid-cols-2 desktop:grid-cols-4">
          {FLOW.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.n}
                className="flex flex-col gap-3 rounded-xl border border-01 bg-01 p-[22px]"
              >
                <div className="flex w-full items-center gap-2.5">
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-primary-10 font-mono text-mono-12 font-semibold text-primary-500">
                    {step.n}
                  </span>
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-03" />
                </div>
                <p className="text-label-md text-01">{step.title}</p>
                <p className="text-body-13 text-02">{step.detail}</p>
                <p
                  className={
                    step.noteTeal
                      ? "whitespace-pre-wrap font-mono text-mono-12 text-teal-600"
                      : "whitespace-pre-wrap font-mono text-mono-12 text-03"
                  }
                >
                  {step.note}
                </p>
              </div>
            );
          })}
        </div>

        {/* Row */}
        <div className="flex w-full flex-col items-start gap-4 desktop:flex-row">
          {/* Panel */}
          <Panel className="min-w-0 flex-1">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Why a refund is invisible everywhere else</PanelTitle>
                <PanelDescription>and why this product puts a number on it</PanelDescription>
              </PanelTitles>
            </PanelHeader>

            <PanelBody className="gap-3.5 p-5">
              <p className="text-body-sm text-02">
                A refund here is a released hold. The money was reserved, the call failed our
                checks, and the reservation was lifted — so your balance never moves. A guarantee
                that worked perfectly for a month and one that never fired once produce the same
                balance and the same history.
              </p>

              <MoneyPair listedValue="$0.0100" paidValue="$0.0000" notChargedValue="$0.0100" />

              {/* Note — teal-tinted, not a `Banner` instance. */}
              <div className="flex w-full items-start gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-[15px]">
                <CircleCheck aria-hidden="true" className="h-[15px] w-[15px] shrink-0 text-teal-600" />
                <p className="min-w-0 flex-1 text-body-13 text-01">
                  {
                    "So we render the counterfactual: listed and charged as two numbers on every row, and a running “not charged” total you can reconcile against the ledger."
                  }
                </p>
              </div>
            </PanelBody>
          </Panel>

          {/* Panel — a fixed 520 in the frame. */}
          <Panel className="w-full desktop:w-[520px] desktop:shrink-0">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>What can run on every call</PanelTitle>
                <PanelDescription>deterministic checks, as configured per tool</PanelDescription>
              </PanelTitles>
            </PanelHeader>

            <PanelBody className="gap-3 p-5">
              {CHECKS.map((check) => (
                <div key={check} className="flex w-full items-center gap-2.5">
                  <Check aria-hidden="true" className="h-[15px] w-[15px] shrink-0 text-success-500" />
                  <p className="min-w-0 flex-1 text-body-13 text-01">{check}</p>
                </div>
              ))}

              {/* Note */}
              <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
                <Info aria-hidden="true" className="h-[15px] w-[15px] shrink-0 text-03" />
                <p className="min-w-0 flex-1 text-body-13 text-02">
                  Relevance is judged on a sample, and the rate is published on each tool page
                  before you spend anything.
                </p>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
