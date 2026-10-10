import { CircleAlert, CircleCheck, Rocket } from "lucide-react";
import * as React from "react";

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";

/**
 * Provider offer and risk disclosure — route `/why-list-here`.
 *
 * The Public Top Bar is applied by `(public)/layout.tsx`; this file
 * is the page's two remaining sections only — `Hero` and `Body`.
 *
 * **The copy is verbatim from `p8rXXX` and the row order is the design's.**
 * This is the page a provider reads once, before they stake money, and it is
 * the only thing standing between "a rule I accepted" and "a bait-and-switch"
 * the first time they are slashed. The three alert rows come BEFORE the two
 * check rows in the design; do not reorder them, do not soften them, and do
 * not add reassurance the design does not contain.
 *
 * Static — no service call. Every figure on the page is a stated term, not a
 * measurement, so there is nothing here to fetch.
 *
 * Two things the design draws that are worth knowing before editing:
 *
 * - The `Facts` tiles are NOT `Metric Tile` instances. They are
 *   plain frames: value first, no shadow, `gap 5`, and the label carries
 *   `$text-01` rather than the tile's `$text-02`. Swapping in `MetricTile`
 *   would reorder them and add an elevation the design does not draw.
 * - The teal `Note` is likewise NOT a `Banner` instance — its text
 *   is 13/400, where every Banner title is 14/600 — so it is built inline.
 */
export default function WhyListHerePage() {
  return (
    <>
      {/* Hero */}
      <section className="flex w-full flex-col items-center gap-3.5 px-7 pb-[30px] pt-11">
        <h1 className="max-w-[900px] text-center text-display-md text-01">
          List an API. Get paid on-chain, per call, and never clawed back.
        </h1>
        <p className="max-w-[760px] text-center text-body-md text-02">
          We verify the outcome of every call before money moves. That is better for you than it
          sounds: a failed call is not charged to the buyer and not credited to you, and you can
          see every verdict that produced that decision.
        </p>
      </section>

      {/* Body */}
      <div className="flex w-full flex-1 flex-col gap-4 px-7 pb-7">
        {/* Facts */}
        <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
          {FACTS.map((fact) => (
            <div
              key={fact.key}
              className="flex flex-1 flex-col gap-1 rounded-lg border border-01 bg-01 p-5"
            >
              <p className="font-mono text-mono-xl text-01">{fact.value}</p>
              <p className="text-label-13 text-01">{fact.key}</p>
              <p className="text-body-xs text-03">{fact.sub}</p>
            </div>
          ))}
        </div>

        {/* "What you are actually agreeing to" — a Panel instance */}
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>What you are actually agreeing to</PanelTitle>
              <PanelDescription>
                stated before you register, not in a document you sign later
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <PanelBody className="px-5 pb-[18px] pt-2">
            {TERMS.map((term) => {
              const Icon = term.tone === "alert" ? CircleAlert : CircleCheck;
              return (
                <div
                  key={term.title}
                  className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 border-t border-01 py-3"
                >
                  <Icon
                    aria-hidden="true"
                    className={
                      term.tone === "alert"
                        ? "h-4 w-4 shrink-0 text-03"
                        : "h-4 w-4 shrink-0 text-success-500"
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <p className="text-label-sm text-01">{term.title}</p>
                    <p className="text-body-xs text-03">{term.detail}</p>
                  </div>
                  <p className="w-full pl-8 font-mono text-mono-12 text-02 tablet:w-[330px] tablet:shrink-0 tablet:pl-0 tablet:text-right">
                    {term.value}
                  </p>
                </div>
              );
            })}
          </PanelBody>
        </Panel>

        {/* Note. Teal-tinted, but not a Banner instance; see above. */}
        <div className="flex w-full items-start gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-[15px]">
          <Rocket aria-hidden="true" className="h-[15px] w-[15px] shrink-0 text-teal-600" />
          <p className="min-w-0 flex-1 text-body-13 text-01">
            Or start with no capital at all: list FREE, serve real traffic, build a published
            quality record, and stake only when you decide to charge.
          </p>
        </div>
      </div>
    </>
  );
}

/** The design's facts, in the design's order. Value first, then key, then sub. */
const FACTS: ReadonlyArray<{ value: string; key: string; sub: string }> = [
  { value: "Per call", key: "paid on-chain", sub: "to your own token account" },
  { value: "0%", key: "reserve held", sub: "we hold nothing back" },
  { value: "Never", key: "clawed back", sub: "a paid payout stays paid" },
  { value: "Capped", key: "worst case per window", sub: "per judgement, and again per 24h" },
];

/**
 * The five rows of the design, verbatim and IN THE DESIGN'S ORDER: the three
 * things that can cost you money first, the two that protect you after.
 * Moving a `check` row above an `alert` row changes what this page promises.
 */
const TERMS: ReadonlyArray<{
  tone: "alert" | "check";
  title: string;
  detail: string;
  value: string;
}> = [
  {
    tone: "alert",
    title: "Stake is mandatory on paid tiers",
    detail: "unverified tier requires no stake and cannot be slashed",
    value: "a configurable minimum per paid binding",
  },
  {
    tone: "alert",
    title: "You can be slashed",
    detail:
      "only above a 400-verified-call minimum sample, and only past a statistical tolerance",
    value: "capped per window and per 24h, as set on chain",
  },
  {
    tone: "alert",
    title: "A failed verification is not paid",
    detail: "we do not keep the money — it is never taken from either side",
    value: "the buyer is not charged either",
  },
  {
    tone: "check",
    title: "You write the binding",
    detail:
      "A binding editor and a tester that runs against your real endpoint. We do not author it for you and we do not gate publishing behind a human.",
    value: "no clawback, no reserve, no hold period",
  },
  {
    tone: "check",
    title: "Verification decides, settlement executes",
    detail:
      "A verdict is a signed attestation. The settlement program checks the signature and the verifier registry, and a slash executes only after a fixed 72-hour on-chain delay, during which it can be cancelled.",
    value: "not demanded from you",
  },
];
