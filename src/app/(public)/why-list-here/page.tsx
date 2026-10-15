"use client";

import { ArrowRight, CircleAlert, CircleCheck, Rocket } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { MoneyFlow } from "@/components/patterns/money-flow";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
  DAILY_CAP_PERCENT,
  economics,
  FEE_RATE,
  parseCalls,
  parsePrice,
  setupHref,
  type ListingMode,
} from "@/features/explorer/provider-economics";
import { MIN_CHECKED_CALLS } from "@/features/provider-sla/reading";

/**
 * For providers — route `/why-list-here`, with the earnings calculator
 * embedded (`/calculator` redirects here). One page answers "what would I
 * earn, what do I put at risk, and what am I agreeing to", and one button,
 * "Start listing", carries the visitor's price and volume into setup.
 *
 * Terms follow the owner decisions: paid calls go only to staked listings; a
 * free listing needs no stake and cannot be penalised; disputes are on chain
 * and decided by Assay's arbiter (a person, on chain). The only limits on a
 * penalty shown as guarantees are the ones the chain enforces.
 */

const MODES: { value: ListingMode; label: string }[] = [
  { value: "PAID", label: "Paid" },
  { value: "FREEMIUM", label: "Free tier + paid" },
  { value: "FREE", label: "Free" },
];

function Figure({ label, value, sub, strong }: { label: React.ReactNode; value: string; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-01 bg-02 p-3.5">
      <span className="text-body-xs text-03">{label}</span>
      <span className={strong ? "font-mono text-mono-xl font-semibold text-01" : "font-mono text-mono-md font-semibold text-01"}>
        {value}
      </span>
      {sub ? <span className="text-body-xs text-03">{sub}</span> : null}
    </div>
  );
}

function Calculator({
  mode,
  setMode,
  price,
  setPrice,
  calls,
  setCalls,
}: {
  mode: ListingMode;
  setMode: (m: ListingMode) => void;
  price: string;
  setPrice: (v: string) => void;
  calls: string;
  setCalls: (v: string) => void;
}) {
  const parsedPrice = parsePrice(price);
  const parsedCalls = parseCalls(calls);
  const result = economics(mode, parsedPrice.value, parsedCalls.value);
  const feePercent = `${FEE_RATE.mul(100).toFixed(0)}%`;

  return (
    <Panel id="calculator" className="scroll-mt-20">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>What you would earn</PanelTitle>
          <PanelDescription>Your numbers, worked out in the browser — no account needed</PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="gap-5 p-4 tablet:p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-label-13 text-01">How you charge</span>
          <Segmented
            value={mode}
            onValueChange={(v) => setMode(v as ListingMode)}
            aria-label="How you charge"
            className="inline-flex w-fit flex-wrap rounded-md bg-03 p-0.5"
          >
            {MODES.map((m) => (
              <SegmentedItem key={m.value} value={m.value}>
                {m.label}
              </SegmentedItem>
            ))}
          </Segmented>
        </div>

        {mode === "FREE" ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-4">
            <Rocket aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-600" />
            <div className="flex flex-col gap-1">
              <p className="text-label-md text-01">No revenue, no stake, no risk.</p>
              <p className="text-body-13 text-02">
                Serve real traffic for free, build a public quality record, and switch to paid — with a{" "}
                <Term k="stake">stake</Term> — when you see the demand.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
              <Field
                id="calculator-price"
                label="Your price per call"
                suffix="USD"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                error={parsedPrice.error ?? undefined}
                hint="Buyers pay this only when the result passes the check."
              />
              <Field
                id="calculator-calls"
                label={mode === "FREEMIUM" ? "Paid calls per month (after the free ones)" : "Calls per month"}
                inputMode="numeric"
                value={calls}
                onChange={(event) => setCalls(event.target.value)}
                error={parsedCalls.error ?? undefined}
                hint={mode === "FREEMIUM" ? "Free calls earn nothing and are not counted here." : "Your best guess is fine."}
              />
            </div>

            {result?.perCall ? (
              <div className="flex flex-col gap-2">
                <span className="text-label-13 text-01">Each paid call that passes</span>
                <MoneyFlow
                  nodes={[
                    { label: "Buyer pays", amount: result.perCall.price },
                    { label: `Assay fee ${feePercent}`, amount: result.perCall.fee, tone: "neutral" },
                    { label: "You receive", amount: result.perCall.youGet, tone: "success", note: "on chain, as calls settle" },
                  ]}
                />
                <p className="text-body-xs text-03">
                  A call whose result fails the check is not charged to the buyer and not paid to you. Nobody keeps the
                  money.
                </p>
              </div>
            ) : null}

            {result ? (
              <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
                <Figure label="You earn per month" value={result.netPerMonth} sub={`after the ${feePercent} fee`} strong />
                <Figure
                  label={<Term k="stake">Stake to post</Term>}
                  value={result.stake}
                  sub={result.daysToCoverStake ? `≈ ${result.daysToCoverStake} days of earnings` : "returned when you leave"}
                />
                <Figure
                  label="Most penalties can take in 24 hours"
                  value={result.worstPer24h ?? "—"}
                  sub={`${DAILY_CAP_PERCENT}% of your stake, enforced on chain; only if you fail more than you promised`}
                />
              </div>
            ) : (
              <p className="text-body-13 text-03">Fix the numbers above to see your earnings.</p>
            )}
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-01 pt-4 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-body-xs text-03">
            Illustrative terms; the live values are set on chain and shown again before you stake.
          </p>
          <Button asChild>
            <Link href={setupHref(mode, price, calls)}>
              Start listing
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}

export default function WhyListHerePage() {
  const [mode, setMode] = React.useState<ListingMode>("PAID");
  const [price, setPrice] = React.useState("0.001");
  const [calls, setCalls] = React.useState("100000");

  // A direct load of `/why-list-here#calculator` (or the `/calculator`
  // redirect) lands on the calculator. The browser's own jump runs before
  // this client page has laid out, so it is repeated once it has.
  React.useEffect(() => {
    if (window.location.hash !== "#calculator") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("calculator")?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <section className="flex w-full flex-col items-center gap-3.5 px-4 pb-[30px] pt-11 tablet:px-7">
        <h1 className="max-w-[900px] text-center text-heading-lg text-01 tablet:text-display-md">
          List an API. Get paid on chain, per call, never clawed back.
        </h1>
        <p className="max-w-[760px] text-center text-body-md text-02">
          We check the result of every call before money moves. A failed call is not charged to the buyer and not paid
          to you — and you can see the check behind every decision.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 pt-1">
          <Button asChild>
            <Link href={setupHref(mode, price, calls)}>
              Start listing
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <a href="#calculator">Work out your earnings</a>
          </Button>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 px-4 pb-7 tablet:px-7">
        <div className="grid w-full grid-cols-2 gap-3 desktop:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.key} className="flex flex-col gap-1 rounded-lg border border-01 bg-01 p-4 tablet:p-5">
              <p className="font-mono text-mono-xl text-01">{fact.value}</p>
              <p className="text-label-13 text-01">{fact.key}</p>
              <p className="text-body-xs text-03">{fact.sub}</p>
            </div>
          ))}
        </div>

        <Calculator mode={mode} setMode={setMode} price={price} setPrice={setPrice} calls={calls} setCalls={setCalls} />

        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>What you are agreeing to</PanelTitle>
              <PanelDescription>Stated before you register, not in a document you sign later</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-4 pb-[18px] pt-2 tablet:px-5">
            {TERMS.map((term) => {
              const Icon = term.tone === "alert" ? CircleAlert : CircleCheck;
              return (
                <div key={term.title} className="flex w-full items-start gap-3 border-t border-01 py-3 first:border-t-0">
                  <Icon
                    aria-hidden="true"
                    className={term.tone === "alert" ? "mt-0.5 size-4 shrink-0 text-warning-500" : "mt-0.5 size-4 shrink-0 text-success-500"}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <p className="text-label-sm text-01">{term.title}</p>
                    <p className="text-body-13 text-02">{term.detail}</p>
                  </div>
                </div>
              );
            })}
          </PanelBody>
        </Panel>

        <section className="flex flex-col gap-3 rounded-xl border border-primary-20 bg-primary-10 p-4 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-5">
          <div className="flex flex-col gap-1">
            <p className="text-label-md text-01">Ready when you are</p>
            <p className="text-body-13 text-02">
              Setup takes a few minutes: your details, where to get paid, and your API. You choose when to go live.
            </p>
          </div>
          <Button asChild>
            <Link href={setupHref(mode, price, calls)}>Start listing</Link>
          </Button>
        </section>
      </div>
    </>
  );
}

const FACTS: ReadonlyArray<{ value: string; key: string; sub: string }> = [
  { value: "Per call", key: "paid on chain", sub: "to your own wallet" },
  { value: "0%", key: "reserve held", sub: "we hold nothing back" },
  { value: "Never", key: "clawed back", sub: "a payout stays paid" },
  { value: `${DAILY_CAP_PERCENT}%`, key: "most taken per 24 h", sub: "of your stake, enforced on chain" },
];

/** The things that can cost you money come first, then the protections. */
const TERMS: ReadonlyArray<{ tone: "alert" | "check"; title: string; detail: React.ReactNode }> = [
  {
    tone: "alert",
    title: "Paid listings need a stake",
    detail: (
      <>
        Buyers&apos; paid calls go only to listings backed by a <Term k="stake">stake</Term>. A free listing needs none
        and cannot be penalised.
      </>
    ),
  },
  {
    tone: "alert",
    title: "You can get a penalty",
    detail: (
      <>
        Only after at least {MIN_CHECKED_CALLS} checked calls in a <Term k="window">window</Term>, and only when you
        fail more often than you promised. The chain never lets penalties take more than {DAILY_CAP_PERCENT}% of your
        stake in any 24 hours, and each penalty is limited to a maximum set on chain.
      </>
    ),
  },
  {
    tone: "alert",
    title: "A result that fails the check is not paid",
    detail: "The buyer is not charged either. Nobody keeps the money.",
  },
  {
    tone: "check",
    title: "You set up your listing yourself",
    detail: "A tester runs against your real API before you publish. No human gate, no hold period.",
  },
  {
    tone: "check",
    title: "You can dispute a penalty, on chain",
    detail: (
      <>
        A penalty waits 72 hours before it can be taken. During that time you can{" "}
        <Term k="dispute">dispute</Term> it on chain: Assay&apos;s <Term k="arbiter">arbiter</Term>, a person, rules on
        it on chain, and if nobody rules in time it expires and nothing is taken.
      </>
    ),
  },
];
