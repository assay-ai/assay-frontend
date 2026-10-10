"use client";

import Decimal from "decimal.js";
import { CircleCheck, Rocket } from "lucide-react";
import * as React from "react";

import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import type { Money } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * Economics calculator — route `/calculator`.
 *
 * Public and pre-registration: it calls no API, because a visitor here has no
 * session and is not a provider yet. Every figure below is computed in the
 * browser from the three fields the visitor types, using the same constants the
 * backend uses.
 *
 * The shell (the Public Top Bar) comes from `(public)/layout.tsx`; this
 * file is the frame's `Body` only — vertical, gap 18, padding
 * [22, 28] on `$bg-02`.
 *
 * **Why the table is laid out here and not with `Table`.** The
 * design does not draw a `Table` ref in this frame — it draws raw frames —
 * and it needs three things `Table` cannot express: a fill on one row only
 * (`net / month` is `$bg-02`), a per-cell weight/tone (that same row is
 * `$text-01`/600 while every other value is `$text-02`/400), and a coloured
 * column header (`verified · 10% take` is `$primary-500`). `src/components/ui/*`
 * is owned by the parent and off-limits, so the geometry is transcribed here
 * cell for cell instead of widening a shared component.
 *
 * **Why `Arithmetic` is not used.** It was read first, as required.
 * This frame contains no ref to it: the design's device for making the sums
 * auditable is the derivation printed inside the cell — `$5.00  = max($5,
 * 100×price)` and `$5.00  = 10% of total stake` — and those two strings are
 * price-symbolic, so they stay verbatim at every input. Adding an `Arithmetic`
 * block would be a section the design does not draw and copy nobody wrote.
 */

/** USDC. Six decimals everywhere money is built here. */
const DECIMALS = 6;
const SCALE = new Decimal(10).pow(DECIMALS);

/**
 * The asset id is never shown (`money.ts`), and the calculator settles nothing
 * — it exists only so the figures travel as `Money` rather than as floats.
 */
const CALCULATOR_ASSET = "calculator:usd";

function usd(major: Decimal): Money {
  return {
    amount: major.mul(SCALE).toFixed(0, Decimal.ROUND_DOWN),
    asset: CALCULATOR_ASSET,
    decimals: DECIMALS,
  };
}

const ZERO = new Decimal(0);

// --- Illustrative published constants. The on-chain values are configurable. ---

/**
 * The platform's take rate. One rate for every tier — the backend charges a
 * single `PLATFORM_FEE_BPS` (10% by default) whatever the tier — so the tiers
 * differ by stake and slashability here, not by take.
 */
const UNVERIFIED_TAKE = new Decimal("0.10");
const VERIFIED_TAKE = new Decimal("0.10");

/**
 * `max(floor, priceMultiple × price)`, per binding —
 * assay-backend `src/modules/provider/dto/get-provider-stake.dto.ts`, whose own
 * example reads `max(floor 50.000000, 1000 × 0.001000) = 50.000000`.
 */
const STAKE_FLOOR = new Decimal("50");
const STAKE_PRICE_MULTIPLE = new Decimal("1000");

/** `max($5, 100 × price)` per window — the published per-window cap. */
const WINDOW_CAP_FLOOR = new Decimal("5");
const WINDOW_CAP_PRICE_MULTIPLE = new Decimal("100");

/** 10% of total stake per provider per 24h — the published daily cap. */
const DAILY_CAP_SHARE = new Decimal("0.10");

/** The month the "days to earn the stake" row divides by. */
const DAYS_PER_MONTH = new Decimal("30");

/**
 * The sampling budget, assay-backend `src/modules/verification/domain/sampling.ts`:
 * `budget = 0.2 × platformFee`, `rate = min(1, budget / 0.0025)`. At $0.001 and
 * a 10% fee that is 0.008 — 1 in 125, which is the figure the design prints.
 */
const VERIFICATION_RATIO_OF_FEE = new Decimal("0.2");
const SEMANTIC_COST_USD = new Decimal("0.0025");
/** Above a half, "1 in N" collapses to "1 in 1" and stops being honest. */
const ONE_IN_N_CEILING = new Decimal("0.5");

const EM_DASH = "—";

type PricingMode = "Free" | "Freemium" | "Paid";

const PRICING_MODES: PricingMode[] = ["Free", "Freemium", "Paid"];

interface Tier {
  /** The take rate, 0.10. */
  take: Decimal;
  /** Whether a listing on this tier has to post stake at all. */
  stakes: boolean;
}

interface Column {
  takeRate: string;
  netPerMonth: string;
  stakeRequired: string;
  canBeSlashed: string;
  worstCasePerWindow: string;
  worstCasePer24h: string;
  qualityRecord: string;
  daysToEarnStake: string;
  semanticSampleRate: string;
}

/**
 * The sample-rate sentence.
 *
 * The design supplies copy for one case only — `1 in 125 at this price`, which
 * is the shape used whenever "1 in N" holds. The other three wordings are taken
 * from `describeSampleRate()` in the backend's `sampling.ts`, the one function
 * that is allowed to word a rate, rather than invented here.
 */
function describeSampleRate(price: Decimal, take: Decimal): string {
  const platformFee = price.mul(take);
  const budget = platformFee.mul(VERIFICATION_RATIO_OF_FEE);
  const rate = Decimal.min(1, budget.div(SEMANTIC_COST_USD));

  if (rate.gte(1)) return "every call";
  if (rate.lte(0)) return "no calls at this price";
  if (rate.gt(ONE_IN_N_CEILING)) {
    return `${rate.mul(100).toFixed(0, Decimal.ROUND_HALF_UP)}% of calls at this price`;
  }
  return `1 in ${new Decimal(1).div(rate).toFixed(0, Decimal.ROUND_UP)} at this price`;
}

function derive(price: Decimal, calls: Decimal, mode: PricingMode, tier: Tier): Column {
  // A FREE listing charges nothing, so it earns nothing and — per
  // `stake-gate.ts`, where `PricingMode.FREE` returns before the floor is even
  // read — posts no stake. FREEMIUM is gated exactly like PAID there, and the
  // frame has no free-quota field, so the two compute alike on the calls typed.
  const charging = mode !== "Free";

  const gross = charging ? price.mul(calls) : ZERO;
  const net = gross.mul(new Decimal(1).minus(tier.take));

  const stake =
    charging && tier.stakes
      ? Decimal.max(STAKE_FLOOR, STAKE_PRICE_MULTIPLE.mul(price))
      : ZERO;
  const atRisk = stake.gt(0);

  const perDay = net.div(DAYS_PER_MONTH);

  return {
    takeRate: `${tier.take.mul(100).toFixed(0)}%`,
    netPerMonth: formatMoney(usd(net)),
    stakeRequired: formatMoney(usd(stake)),
    canBeSlashed: atRisk ? "yes" : "no",
    worstCasePerWindow: atRisk
      ? `${formatMoney(usd(Decimal.max(WINDOW_CAP_FLOOR, WINDOW_CAP_PRICE_MULTIPLE.mul(price))))}  = max($5, 100×price)`
      : EM_DASH,
    worstCasePer24h: atRisk
      ? `${formatMoney(usd(stake.mul(DAILY_CAP_SHARE)))}  = 10% of total stake`
      : EM_DASH,
    qualityRecord: tier.stakes ? "published, drives routing" : "none",
    daysToEarnStake: atRisk && perDay.gt(0) ? stake.div(perDay).toFixed(1) : EM_DASH,
    semanticSampleRate:
      tier.stakes && charging ? describeSampleRate(price, tier.take) : "not measured",
  };
}

const UNVERIFIED: Tier = { take: UNVERIFIED_TAKE, stakes: false };
const VERIFIED: Tier = { take: VERIFIED_TAKE, stakes: true };

/** `1000000` -> `1,000,000`, the design's own rendering of the volume field. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function parseDecimal(raw: string): Decimal {
  const cleaned = raw.replace(/,/g, "");
  if (cleaned === "" || cleaned === ".") return ZERO;
  try {
    const value = new Decimal(cleaned);
    return value.isFinite() && value.gte(0) ? value : ZERO;
  } catch {
    return ZERO;
  }
}

interface RowSpec {
  key: keyof Column;
  label: string;
  /** `net / month` is the one row the design fills and bolds. */
  emphasised?: boolean;
}

const ROWS: RowSpec[] = [
  { key: "takeRate", label: "take rate" },
  { key: "netPerMonth", label: "net / month", emphasised: true },
  { key: "stakeRequired", label: "stake required" },
  { key: "canBeSlashed", label: "can be slashed" },
  { key: "worstCasePerWindow", label: "worst case / window" },
  { key: "worstCasePer24h", label: "worst case / 24h" },
  { key: "qualityRecord", label: "quality record" },
  { key: "daysToEarnStake", label: "days to earn the stake" },
  { key: "semanticSampleRate", label: "semantic sample rate" },
];

export default function EconomicsCalculatorPage() {
  const [price, setPrice] = React.useState("0.001");
  const [callsDigits, setCallsDigits] = React.useState("1000000");
  const [mode, setMode] = React.useState<PricingMode>("Paid");

  const priceValue = parseDecimal(price);
  const callsValue = parseDecimal(callsDigits);

  const unverified = derive(priceValue, callsValue, mode, UNVERIFIED);
  const verified = derive(priceValue, callsValue, mode, VERIFIED);

  return (
    <div className="flex w-full flex-1 flex-col gap-[18px] px-7 py-[22px]">
      {/* Page Header */}
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">What listing here would look like</h1>
          <p className="font-mono text-mono-12 text-03">
            no account required — the two decisive numbers should not be behind registration
          </p>
        </div>
      </div>

      {/* Your numbers */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Your numbers</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-5 pb-5 pt-4">
          <div className="flex w-full items-end gap-4">
            <Field
              id="calculator-price"
              label="Your price per call"
              suffix="USD"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))}
            />
            <Field
              id="calculator-calls"
              label="Expected calls / month"
              inputMode="numeric"
              value={group(callsDigits)}
              onChange={(event) => setCallsDigits(event.target.value.replace(/[^0-9]/g, ""))}
            />
            <Select
              id="calculator-mode"
              label="Pricing mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as PricingMode)}
            >
              {PRICING_MODES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
        </PanelBody>
      </Panel>

      {/* unverified vs verified */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>unverified vs verified</PanelTitle>
            <PanelDescription>
              the comparison is the screen — a single column hides the trade
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          <div className="flex w-full flex-col" role="table">
            {/* Head */}
            <div role="row" className="flex w-full gap-3 border-b border-02 px-3 pb-[9px]">
              <div className="flex flex-1" role="columnheader" />
              <div className="flex w-[300px] justify-end" role="columnheader">
                <span className="font-mono text-mono-2xs tracking-[1.1px] text-03">
                  unverified · {UNVERIFIED_TAKE.mul(100).toString()}% take
                </span>
              </div>
              <div className="flex w-[300px] justify-end" role="columnheader">
                <span className="font-mono text-mono-2xs tracking-[1.1px] text-primary-500">
                  verified · {VERIFIED_TAKE.mul(100).toString()}% take
                </span>
              </div>
            </div>

            {ROWS.map((row) => (
              <div
                key={row.key}
                role="row"
                className={`flex w-full items-center gap-3 border-b border-01 px-3 py-[11px] ${
                  row.emphasised ? "bg-02" : ""
                }`}
              >
                <div className="flex flex-1 min-w-0" role="rowheader">
                  <span className="text-label-13 text-01">{row.label}</span>
                </div>
                <div className="flex w-[300px] justify-end" role="cell">
                  <span
                    className={`whitespace-pre text-right font-mono text-mono-13 ${
                      row.emphasised ? "font-semibold text-01" : "text-02"
                    }`}
                  >
                    {unverified[row.key]}
                  </span>
                </div>
                <div className="flex w-[300px] justify-end" role="cell">
                  <span
                    className={`whitespace-pre text-right font-mono text-mono-13 ${
                      row.emphasised ? "font-semibold text-01" : "text-02"
                    }`}
                  >
                    {verified[row.key]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* Note */}
      <div className="flex w-full gap-2.5 rounded-lg border border-success-20 bg-success-10 p-[15px]">
        <CircleCheck
          aria-hidden="true"
          width={15}
          height={15}
          className="mt-0.5 shrink-0 text-success-600"
        />
        <p className="flex-1 text-body-13 leading-[1.6] text-success-700">
          Payouts go on-chain to your own token account as calls settle, and are final. We never
          claw back a payout. There is no reserve and no hold period.
        </p>
      </div>

      {/* Note */}
      <div className="flex w-full gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-[15px]">
        <Rocket aria-hidden="true" width={15} height={15} className="mt-0.5 shrink-0 text-teal-600" />
        <p className="flex-1 text-body-13 leading-[1.6] text-01">
          Or start with no capital at all: list FREE, serve real traffic, build a published quality
          record, and stake only when you decide to charge. This is on the screen rather than behind
          it, because “I will not stake before I see volume” is one of the two objections that lose
          providers.
        </p>
      </div>
    </div>
  );
}
