"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type { ProviderStake } from "@/interfaces";
import { getProviderStake } from "@/services/provider-stake.service";
import { formatMoney } from "@/utils/money";

/**
 * Listing path chooser — route
 * `/provider/listing-path`.
 *
 * The shell (the Sidebar, and `Main` at gap 16 / padding [22, 26]) comes
 * from `(console)/layout.tsx`. Everything below is the frame's `Main` children:
 * Page Header, Choices and Note.
 *
 * ## The FREE path is a first-class route, not a downgrade
 *
 * The design says so structurally, not just in copy: "List FREE first"
 * is the only card with a `$teal-500` 1.5px border, the only one
 * carrying a badge ("START HERE"), and the only one whose button is the
 * PRIMARY tone — the two paid cards get a `$border-01` hairline and a
 * secondary button. That asymmetry is deliberate and is reproduced exactly.
 * It is the answer to "I'm not staking before I see volume", so the paid
 * cards must not be allowed to out-weigh it.
 *
 * ## The one number on this screen comes off the wire
 *
 * The design draws "$50.00 minimum" under "List on verified". That is the
 * platform's stake FLOOR, and **no endpoint returns it as a field** — the only
 * place `50.000000` appears on the wire is inside
 * `requirement[].derivation` ("max(floor 50.000000, 1000 × 0.250000) =
 * 250.000000"), which exists only once the org already has a priced binding.
 *
 * So the figure rendered here is `requirementTotal` from
 * `GET /providers/me/stake` — what this organization would actually have to
 * bond — and the derivation travels with it as the element's `title`. For the
 * seeded registered provider that is **$250.00**, not the design's $50.00,
 * because their `weather` binding is priced at $0.25 and the rule is
 * `max(floor, 1000 × price)`. For an organization that has never registered
 * the response is a legitimate 200 with `requirementTotal: null` — no binding,
 * so nothing to compute a floor against — and there is no figure to show.
 * Neither divergence is silently resolved.
 *
 * The other figures on the cards ("take rate",
 * "Max $5.00 per window, 10% of stake per 24h", "$0.00 per call") have no API
 * counterpart at all — there is no economic-parameter endpoint — so they stay
 * as the design's verbatim copy.
 */

/** One bullet row: gap 9, a 14px lucide `check`, text at 12.5. */
function Bullet({ children, tone }: { children: React.ReactNode; tone: "teal" | "muted" }) {
  return (
    <li className="flex w-full items-start gap-[9px]">
      <Check
        aria-hidden="true"
        className={tone === "teal" ? "mt-px size-3.5 shrink-0 text-teal-500" : "mt-px size-3.5 shrink-0 text-03"}
      />
      <span className="text-body-xs text-02">{children}</span>
    </li>
  );
}

/**
 * The price row: two mono runs at 13, the first
 * at 600 in `$text-01`, the second at 400 in `$text-03`, 16 apart.
 */
function PriceRow({ lead, sub, subTitle }: { lead: string; sub: React.ReactNode; subTitle?: string }) {
  return (
    <div className="flex w-full items-baseline gap-4">
      <span className="font-mono text-mono-13 font-semibold text-01">{lead}</span>
      {sub !== null && (
        <span className="font-mono text-mono-13 text-03" title={subTitle}>
          {sub}
        </span>
      )}
    </div>
  );
}

/**
 * What goes in the "List on verified" sub-slot.
 *
 * `null` while the request is in flight — a placeholder number here would be a
 * number nobody can source, and this is the screen where the stake figure is
 * the whole objection being answered.
 */
function verifiedMinimum(stake: ProviderStake | undefined): React.ReactNode {
  if (!stake) return null;
  if (!stake.requirementTotal) return "minimum not yet determined";
  return `${formatMoney(stake.requirementTotal)} minimum`;
}

export default function ListingPathChooserPage() {
  /*
    `GET /providers/me/stake` answers 200 for an organization that has never
    registered (`hasKnownStake: false`, `requirement: []`), so this screen needs
    no registration call and has no 404 branch — the same three cards render in
    both states and only the verified card's figure differs.
  */
  const { data: stake } = useQuery({
    queryKey: ["provider", "stake"],
    queryFn: getProviderStake,
  });

  const derivation = stake?.requirement[0]?.derivation;

  return (
    <>
      {/* Page Header the design */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex w-full flex-col gap-0.5">
          <h1 className="text-heading-md text-01">How do you want to start?</h1>
          <p className="w-full font-mono text-mono-12 text-03">
            the free path is a first-class choice, not a fallback offered after a stake table
          </p>
        </div>
      </header>

      {/* Choices — three cards, equal width, gap 16. */}
      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-start">
        {/* The design — the recommended path. Teal 1.5px border, badge, primary button. */}
        <section
          aria-labelledby="path-free"
          className="flex flex-1 flex-col gap-3.5 rounded-xl border-[1.5px] border-teal-500 bg-01 p-[22px]"
        >
          {/*
            The design is a `ref` to Badge whose text is overridden to
            "START HERE". `ui/badge.tsx` has a CLOSED variant vocabulary and no
            `label` prop — deliberately, so a raw verdict can never be passed
            through — and `src/components/ui/*` is not mine to edit. The teal
            geometry below is byte-for-byte the component's `not-charged`
            variant with this design's copy.
          */}
          <span className="inline-flex w-fit items-center gap-[5px] whitespace-nowrap rounded-full bg-teal-10 px-[9px] py-1 font-mono text-mono-xs font-semibold text-teal-600">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
            START HERE
          </span>

          <h2 id="path-free" className="w-full text-heading-sm text-01">
            List FREE first
          </h2>

          <PriceRow lead="$0.00 per call" sub="no stake" />

          <p className="w-full text-body-13 text-02">
            Serve real traffic for free, build a published quality record, and stake only
            when you decide to charge.
          </p>

          <ul className="flex w-full flex-col gap-2">
            <Bullet tone="teal">No capital at risk, ever</Bullet>
            <Bullet tone="teal">Quality is measured and published</Bullet>
            <Bullet tone="teal">Convert to paid in one change</Bullet>
            <Bullet tone="teal">Platform-funded, subject to a daily free budget</Bullet>
          </ul>

          <Button variant="primary" className="w-full py-[11px]">
            Choose this path
          </Button>
        </section>

        {/* The design */}
        <section
          aria-labelledby="path-unverified"
          className="flex flex-1 flex-col gap-3.5 rounded-xl border border-01 bg-01 p-[22px]"
        >
          <h2 id="path-unverified" className="w-full text-heading-sm text-01">
            List on unverified
          </h2>

          <PriceRow lead="your price" sub="no stake" />

          <p className="w-full text-body-13 text-02">
            Charge from day one at the platform take rate. Quality is not measured, no guarantee applies,
            and agents see that on the row.
          </p>

          <ul className="flex w-full flex-col gap-2">
            <Bullet tone="muted">Configurable platform take rate</Bullet>
            <Bullet tone="muted">Cannot be slashed</Bullet>
            <Bullet tone="muted">No published quality record</Bullet>
            <Bullet tone="muted">Lower routing weight than verified</Bullet>
          </ul>

          <Button variant="secondary" className="w-full py-[11px]">
            Choose this path
          </Button>
        </section>

        {/* The design */}
        <section
          aria-labelledby="path-verified"
          className="flex flex-1 flex-col gap-3.5 rounded-xl border border-01 bg-01 p-[22px]"
        >
          <h2 id="path-verified" className="w-full text-heading-sm text-01">
            List on verified
          </h2>

          <PriceRow lead="your price" sub={verifiedMinimum(stake)} subTitle={derivation} />

          <p className="w-full text-body-13 text-02">
            Charge at the platform take rate with a published quality record that drives routing — and a
            capped, evidenced slashing exposure.
          </p>

          <ul className="flex w-full flex-col gap-2">
            <Bullet tone="muted">Configurable platform take rate</Bullet>
            <Bullet tone="muted">Max $5.00 per window, 10% of stake per 24h</Bullet>
            <Bullet tone="muted">Published quality record drives routing</Bullet>
          </ul>

          <Button variant="secondary" className="w-full py-[11px]">
            Choose this path
          </Button>
        </section>
      </div>

      {/* Note the design */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
        <Info aria-hidden="true" className="mt-px size-[15px] shrink-0 text-03" />
        <p className="w-full text-body-13 text-02">
          You can move between paths later. Loosening a declared SLA is shown on your public listing
          for 90 days; changing tier is not.
        </p>
      </div>
    </>
  );
}
