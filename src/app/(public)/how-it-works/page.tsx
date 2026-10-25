import { ArrowRight, Bot, Check, CircleCheck, Info, Lock, Plug, ScanSearch, Split, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import * as React from "react";

import { BuyerCosts } from "@/components/explorer/buyer-costs";
import { Term } from "@/components/patterns/term";
import { MoneyPair } from "@/components/ui/money-pair";
import { StakeRuleText } from "@/components/explorer/stake-rule-text";
import { pageMetadata } from "@/libs/page-metadata";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";

import { HeroCtas } from "./demo-cta";

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

const DESC =
  "A marketplace where AI agents pay per call for MCP tools, only when the result passes the check. Free calls need no deposit.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "How it works", description: DESC, url: "/how-it-works" }),
};

interface FlowStep {
  n: string;
  icon: LucideIcon;
  title: string;
  detail: React.ReactNode;
  note: string;
  /** The fourth step's note is `$teal-600`; the first three are `$text-03`. */
  noteTeal?: boolean;
}

const FLOW: FlowStep[] = [
  {
    n: "1",
    icon: Terminal,
    title: "Your agent calls a tool",
    detail: "Through MCP or REST. It sees the most a call can cost before it calls.",
    note: "$0.0100 listed",
  },
  {
    n: "2",
    icon: Lock,
    title: "We hold, not charge",
    detail: (
      <>
        The amount is <Term k="hold">held</Term> from your balance, which sits in{" "}
        <Term k="escrow">escrow</Term>: money you set aside on chain for your agents. Nothing has left it yet.
      </>
    ),
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
    detail: (
      <>
        Passed: you pay the price of the provider that served, never more than the hold, and the rest is
        released. Failed: the hold is released and the amount is <Term k="not-charged">not charged</Term>.
      </>
    ),
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

/** The product in one line: what it is, for whom, and on what terms. */
const DEFINITION =
  "Assay is a marketplace and payment layer where AI agents pay per call for MCP tools, only when the result passes the check. Buyers connect their agent with one MCP URL. Providers list their APIs, put up a stake, and get paid per call.";

const FORK = [
  {
    id: "agent",
    icon: Bot,
    title: "I have an agent",
    detail: "Find tools, see what a call costs, and connect your agent. Free calls need no deposit.",
    href: "/catalogue",
    action: "Find tools",
  },
  {
    id: "api",
    icon: Plug,
    title: "I have an API",
    detail: "List it, set your price, and get paid on chain for every call that passes.",
    href: "/why-list-here",
    action: "Earn per call",
  },
] as const;

/**
 * The two ways in, side by side: a buyer with an agent and a provider with an
 * API. Under the hero and again at the bottom of the page, so neither side has
 * to scroll back up to find its path.
 */
function Fork({ id, showHeading = false }: { id: string; showHeading?: boolean }) {
  return (
    <nav aria-labelledby={id} className="grid w-full max-w-[720px] grid-cols-1 gap-3 tablet:grid-cols-2">
      <h2 id={id} className={showHeading ? "text-center text-heading-sm text-01 tablet:col-span-2" : "sr-only"}>
        Where to start
      </h2>
      {FORK.map((path) => {
        const Icon = path.icon;
        return (
          <Link
            key={path.id}
            href={path.href}
            className="group flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4 text-left shadow-hair hover:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-primary-500" />
              <span className="text-label-md text-01">{path.title}</span>
            </span>
            <span className="text-body-13 text-02">{path.detail}</span>
            <span className="inline-flex items-center gap-1 text-label-13 text-primary-600">
              {path.action}
              <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      {/* Hero */}
      <section className="flex w-full flex-col items-center gap-4 px-4 pb-[34px] pt-[52px] tablet:px-6 desktop:px-7">
        <h1 className="max-w-[940px] text-center text-display-lg text-01">
          {"You don't pay for results you can't use."}
        </h1>
        <p className="max-w-[760px] text-center text-body-md text-01" data-testid="product-definition">
          {DEFINITION}
        </p>
        <p className="max-w-[720px] text-center text-body-md text-02">
          Your agent calls a tool. We check the result before the money moves. If the result is
          unusable, the charge never happens — and we show you the amount we did not take.
        </p>

        <Fork id="fork-top" />

        {/* CTAs: the demo leads only where it is configured; otherwise the tools do. */}
        <HeroCtas />
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

        {/* What a buyer pays besides the price, before anyone signs up. */}
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>What it costs you</PanelTitle>
              <PanelDescription>the price, and what you need before your agent can pay</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-5">
            <BuyerCosts />
          </PanelBody>
        </Panel>

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
                  Some tools also check relevance — does the answer fit the question — on every call
                  or on a sample. Each tool&apos;s page says which, before you spend anything.
                </p>
              </div>
              <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
                <Info aria-hidden="true" className="h-[15px] w-[15px] shrink-0 text-03" />
                <p className="min-w-0 flex-1 text-body-13 text-02">
                  Providers put up a <Term k="stake">stake</Term>, and a <Term k="slash">penalty</Term> can take
                  part of it. <StakeRuleText />
                </p>
              </div>
            </PanelBody>
          </Panel>
        </div>

        {/* The same two ways in, so the page does not end at the footer. */}
        <div className="flex w-full justify-center pt-4">
          <Fork id="fork-bottom" showHeading />
        </div>
      </div>
    </>
  );
}
