"use client";

import { freeFirstHint } from "@/features/provider-binding/free-first";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Minus, Plus, Rocket } from "lucide-react";
import Link from "next/link";
import Decimal from "decimal.js";
import * as React from "react";

import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { WINDOW_WORDS } from "@/features/provider-sla/window";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import type {
  CatalogueSettlementAsset,
  CatalogueTool,
  Money,
  ProviderTermsSummary,
  PublishRequirement,
  ToolBindingDetail,
  UpdateToolBindingBody,
} from "@/interfaces";
import { getPublishCheck } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";

import { BuyerPreview } from "../buyer-preview";
import { minorUnitsFromMajorInput, majorInputFromMoney } from "../chrome";
import { majorChoices, majorTestRows, majorTestText, moveNotice, termsOf } from "../contract-terms";
import { useProviderToolNames } from "../tool-name";
import {
  choiceOfMode,
  DEFAULT_FAILURE_PERCENT,
  DEFAULT_FREE_CALLS_PER_AGENT,
  failureRateFromPercent,
  freeCallsFromInput,
  penaltyExample as penaltyExampleOf,
  modeOfChoice,
  percentText,
  PRICE_CHOICES,
  providerShare,
  stakeNeededFor,
  stakeRuleOf,
  stakeSummary,
  takeRateOf,
  timeoutFromSeconds,
  totalStakeWith,
  type PriceChoice,
} from "../go-live";

/** Why publishing cannot happen yet, in the provider's words. */
export const REQUIREMENT_SENTENCE: Record<PublishRequirement, string> = {
  TESTER_RUN: "Run a test of your current connection.",
  TESTER_PASSED: "Get a passing test.",
  PAYOUT_ACCOUNT: "Add a payout wallet so you can be paid.",
  API_KEY_CREDENTIALS: "Add your API key headers for this address under Authentication.",
  STAKE_AT_MINIMUM_ON_EVERY_CHAIN: "Add stake to cover paid calls.",
};

export interface LiveForm {
  choice: PriceChoice;
  price: string;
  freeCalls: string;
  failurePercent: string;
  timeoutSeconds: string;
}

export function liveFormOf(binding: ToolBindingDetail, priceHint: string | null): LiveForm {
  const fresh = binding.status === "DRAFT" && binding.pricingMode === "FREE";
  const choice: PriceChoice = fresh && priceHint ? "paid" : choiceOfMode(binding.pricingMode);
  return {
    choice,
    price: binding.pricingMode !== "FREE" ? majorInputFromMoney(binding.price) : (priceHint ?? ""),
    freeCalls: String(binding.freeQuotaPerAgent ?? DEFAULT_FREE_CALLS_PER_AGENT),
    failurePercent: binding.slaFailureRate > 0 ? percentText(binding.slaFailureRate) : String(DEFAULT_FAILURE_PERCENT),
    timeoutSeconds: String(binding.timeoutMs / 1000),
  };
}

export interface ParsedLive {
  body: UpdateToolBindingBody | null;
  errors: Partial<Record<keyof LiveForm, string>>;
  price: Money | null;
  freeCalls: number | null;
  failureRate: number | null;
}

/** The form → the PATCH body (only what changed), or the errors. */
export function parseLiveForm(form: LiveForm, binding: ToolBindingDetail, asset: CatalogueSettlementAsset): ParsedLive {
  const errors: ParsedLive["errors"] = {};
  const mode = modeOfChoice(form.choice);
  let price: Money | null = null;
  let priceAmount = "0";
  if (mode !== "FREE") {
    const minor = minorUnitsFromMajorInput(form.price.replace(/^\$/, ""), asset.decimals);
    if (form.price.trim() === "") errors.price = "Enter a price per call, like 0.10.";
    else if (minor.error) errors.price = minor.error;
    else if (!minor.amount || /^0*$/.test(minor.amount)) errors.price = "More than $0. Choose Free for no charge.";
    else {
      priceAmount = minor.amount;
      price = { amount: minor.amount, asset: asset.assetId, decimals: asset.decimals };
    }
  }
  let freeCalls: number | null = null;
  if (mode === "FREEMIUM") {
    const parsed = freeCallsFromInput(form.freeCalls);
    if (parsed.error) errors.freeCalls = parsed.error;
    freeCalls = parsed.value;
  }
  const failure = failureRateFromPercent(form.failurePercent);
  if (failure.error) errors.failurePercent = failure.error;
  const timeout = timeoutFromSeconds(form.timeoutSeconds);
  if (timeout.error) errors.timeoutSeconds = timeout.error;

  if (Object.keys(errors).length > 0) return { body: null, errors, price, freeCalls, failureRate: failure.value };

  const body: UpdateToolBindingBody = {};
  if (mode !== binding.pricingMode) body.pricingMode = mode;
  if (priceAmount !== (binding.pricingMode === "FREE" ? "0" : binding.price.amount) || body.pricingMode) {
    body.priceAmount = priceAmount;
    body.assetId = asset.assetId;
  }
  const quota = mode === "FREEMIUM" ? freeCalls : null;
  if (quota !== binding.freeQuotaPerAgent) body.freeQuotaPerAgent = quota;
  if (failure.value !== binding.slaFailureRate) body.slaFailureRate = failure.value!;
  if (timeout.value !== binding.timeoutMs) body.timeoutMs = timeout.value!;
  return { body, errors, price, freeCalls, failureRate: failure.value };
}

function PercentStepper({
  value,
  onChange,
  error,
  disabled,
  example,
  free,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
  /** A free tool has no stake behind it, so going over the promise costs no money. */
  free?: boolean;
  /** "Example: at 12% failures in a window, …", for a paid tool. */
  example?: string | null;
}) {
  const step = (delta: number) => {
    const current = Number(value.replace("%", ""));
    const next = Math.max(0.5, Math.min(100, (Number.isFinite(current) ? current : DEFAULT_FAILURE_PERCENT) + delta));
    onChange(String(Number(next.toFixed(2))));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label-13 text-01">Failures you promise to stay under</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" aria-label="Lower" disabled={disabled} onClick={() => step(-0.5)} icon={<Minus aria-hidden="true" />} />
        <label className="flex w-28 items-center gap-1 rounded-md border border-02 bg-01 px-3 py-2 focus-within:border-primary-500">
          <span className="sr-only">Failure rate in percent</span>
          <input
            inputMode="decimal"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="w-full min-w-0 bg-transparent text-right font-mono text-mono-sm text-01 outline-none"
          />
          <span className="font-mono text-mono-13 text-03">%</span>
        </label>
        <Button type="button" variant="secondary" size="sm" aria-label="Raise" disabled={disabled} onClick={() => step(0.5)} icon={<Plus aria-hidden="true" />} />
      </div>
      <p className={cn("text-body-xs", error ? "text-danger-500" : "text-03")}>
        {error ??
          (free ? (
            `Out of every 100 checked calls in a window (${WINDOW_WORDS}). A free tool has no stake, so going over it costs you no money; buyers see the promise and how you do against it.`
          ) : (
            <>
              {`Out of every 100 checked calls in a window (${WINDOW_WORDS}). Go over it and part of your stake can be taken as a penalty, by the `}
              <Term k="stake-rule">stake rule</Term>
              {". A higher number is safer for you but looks weaker to buyers."}
            </>
          ))}
      </p>
      {!error && example ? <p className="text-body-xs text-02">{example}</p> : null}
    </div>
  );
}

/**
 * Stage 3: the price, the promise, and one Publish. A live summary says what a
 * buyer pays, what the provider receives and what stake it needs; when the
 * stake falls short the button becomes "Add $X stake and publish" and opens
 * the Stake sheet, publishing as soon as the stake lands.
 */
export function LiveStage({
  tool,
  binding,
  asset,
  terms,
  priceHint,
  readOnly,
  onSave,
  onPublish,
  onBackToTest,
}: {
  tool: CatalogueTool;
  binding: ToolBindingDetail;
  asset: CatalogueSettlementAsset;
  terms: ProviderTermsSummary | null;
  priceHint: string | null;
  readOnly: boolean;
  onSave: (body: UpdateToolBindingBody) => Promise<ToolBindingDetail>;
  onPublish: () => Promise<void>;
  onBackToTest: () => void;
}) {
  const [form, setForm] = React.useState<LiveForm>(() => liveFormOf(binding, priceHint));
  const [advanced, setAdvanced] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [stakeOpen, setStakeOpen] = React.useState(false);

  const stake = useStakeStatus();
  const names = useProviderToolNames();
  const check = useQuery({
    queryKey: ["provider", "tool-binding", binding.id, "publish-check"],
    queryFn: () => getPublishCheck(binding.id),
    retry: 0,
  });

  const parsed = parseLiveForm(form, binding, asset);
  const mode = modeOfChoice(form.choice);
  const set = (patch: Partial<LiveForm>) => setForm((current) => ({ ...current, ...patch }));

  // Autosave: a valid change is saved a moment after the provider stops typing.
  const pendingBody = parsed.body && Object.keys(parsed.body).length > 0 ? parsed.body : null;
  const bodyKey = pendingBody ? JSON.stringify(pendingBody) : "";
  const save = React.useCallback(async () => {
    if (!pendingBody || readOnly) return;
    setSaveState("saving");
    try {
      await onSave(pendingBody);
      setSaveState("saved");
      void check.refetch();
    } catch {
      setSaveState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, readOnly]);
  React.useEffect(() => {
    if (!pendingBody) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  // The arithmetic for the summary.
  const take = takeRateOf(terms);
  const rule = stakeRuleOf(stake.stake);
  const needed = stakeNeededFor(parsed.price, mode, rule);
  const totalNeeded = totalStakeWith(needed, stake.stake, binding.id);
  const have = stake.staked;
  const shortfall: Money | null =
    needed && totalNeeded
      ? (() => {
          const gap = toDecimal(totalNeeded).minus(have ? toDecimal(have) : 0);
          return gap.gt(0)
            ? { amount: gap.mul(10 ** totalNeeded.decimals).toFixed(0), asset: totalNeeded.asset, decimals: totalNeeded.decimals }
            : null;
        })()
      : null;
  const currentTerms = !take.fromServer || !rule.fromServer;
  const largestOther = (stake.stake?.requirement ?? [])
    .filter((item) => item.bindingId !== binding.id && item.minimum)
    .reduce<{ toolId: string; amount: Decimal } | null>((best, item) => {
      const amount = toDecimal(item.minimum!);
      return !best || amount.gt(best.amount) ? { toolId: item.toolId, amount } : best;
    }, null);
  const summary =
    needed && parsed.price
      ? stakeSummary({
          needed,
          total: totalNeeded,
          have,
          price: parsed.price,
          rule,
          largestToolName: largestOther ? (names.tool(largestOther.toolId)?.name ?? null) : null,
        })
      : null;
  const penaltyExample = penaltyExampleOf(parsed.price, mode, parsed.failureRate);

  const unmet = (check.data?.requirements ?? []).filter((requirement) => !requirement.met);
  const testMissing = unmet.find((r) => r.requirement === "TESTER_RUN" || r.requirement === "TESTER_PASSED");
  const credentialsMissing = unmet.find((r) => r.requirement === "API_KEY_CREDENTIALS");
  const payoutMissing = unmet.find((r) => r.requirement === "PAYOUT_ACCOUNT");
  // T3: one tester row per contract major the listing serves.
  const versioned = (tool.versions?.length ?? 0) > 0;
  const testRows = versioned && check.data ? majorTestRows(check.data, termsOf(binding).majors) : [];
  const untested = testRows.filter((row) => !row.met).map((row) => `v${row.major}`);
  const move = versioned ? moveNotice(termsOf(binding), majorChoices(tool)) : null;
  const hasErrors = Object.keys(parsed.errors).length > 0;
  // An empty price is not marked red before anything was typed; the button says what is missing instead.
  const priceEmpty = form.price.trim() === "";
  const onlyPriceMissing = priceEmpty && Object.keys(parsed.errors).every((key) => key === "price");

  let blockReason: React.ReactNode = null;
  if (readOnly) blockReason = "Your account is blocked, so publishing is paused.";
  else if (hasErrors && onlyPriceMissing) blockReason = "Enter a price per call, like 0.10.";
  else if (hasErrors) blockReason = "Fix the fields marked above.";
  else if (testMissing)
    blockReason = (
      <>
        {untested.length > 0 ? `Get a passing test for ${untested.join(" and ")}.` : REQUIREMENT_SENTENCE[testMissing.requirement]}{" "}
        <button type="button" className="text-primary-600 underline" onClick={onBackToTest}>
          Back to Connect &amp; test
        </button>
      </>
    );
  else if (credentialsMissing)
    blockReason = (
      <>
        {REQUIREMENT_SENTENCE.API_KEY_CREDENTIALS}{" "}
        <button type="button" className="text-primary-600 underline" onClick={onBackToTest}>
          Back to Connect &amp; test
        </button>
      </>
    );
  else if (payoutMissing)
    blockReason = (
      <>
        {REQUIREMENT_SENTENCE.PAYOUT_ACCOUNT}{" "}
        <Link href="/provider/setup" className="text-primary-600 underline">
          Add it in setup
        </Link>
      </>
    );

  const needsStake = mode !== "FREE" && shortfall !== null && stake.stake !== null;

  const publish = async () => {
    setPublishError(null);
    setPublishing(true);
    try {
      if (pendingBody) await onSave(pendingBody);
      await onPublish();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Publishing did not work. Try again.");
      void check.refetch();
    } finally {
      setPublishing(false);
    }
  };

  const priceMoney = parsed.price;
  const youGet = priceMoney ? providerShare(priceMoney, take) : null;

  return (
    <section aria-labelledby="live-stage-title" className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="live-stage-title" className="text-label-md text-01">
          Set your price and go live
        </h2>
        <p className="text-body-13 text-02">Changes save as you go. Nothing is public until you publish.</p>
      </div>

      <div className="flex w-full flex-col gap-5 tablet:flex-row tablet:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5 rounded-lg border border-01 bg-01 p-4">
          <div className="flex flex-col gap-2">
            <span className="text-label-13 text-01">How agents pay</span>
            <Segmented value={form.choice} onValueChange={(value) => set({ choice: value as PriceChoice })} aria-label="How agents pay">
              {PRICE_CHOICES.map((choice) => (
                <SegmentedItem key={choice.value} value={choice.value} disabled={readOnly}>
                  {choice.label}
                </SegmentedItem>
              ))}
            </Segmented>
            {/* What the choice means, then (free tiers) that free calls come before any paid provider. */}
            <p className="text-body-xs text-03">
              {[PRICE_CHOICES.find((c) => c.value === form.choice)?.hint, freeFirstHint(mode)].filter(Boolean).join(" ")}
            </p>
          </div>

          {mode !== "FREE" ? (
            <Field
              label="Price per call"
              inputMode="decimal"
              suffix="$ a call"
              value={form.price}
              disabled={readOnly}
              onChange={(event) => set({ price: event.target.value })}
              error={priceEmpty ? undefined : parsed.errors.price}
              placeholder="0.10"
            />
          ) : null}

          {mode === "FREEMIUM" ? (
            <Field
              label="Free calls per agent per day"
              inputMode="numeric"
              value={form.freeCalls}
              disabled={readOnly}
              onChange={(event) => set({ freeCalls: event.target.value })}
              error={parsed.errors.freeCalls}
              hint="Each agent gets this many free calls a day on this tool, then pays the price above."
            />
          ) : null}

          <PercentStepper
            value={form.failurePercent}
            onChange={(next) => set({ failurePercent: next })}
            error={parsed.errors.failurePercent}
            disabled={readOnly}
            example={mode === "FREE" ? null : penaltyExample}
            free={mode === "FREE"}
          />

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced((open) => !open)}
              className="flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01"
            >
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", advanced && "rotate-180")} />
              Advanced
            </button>
            {advanced ? (
              <Field
                label="Time we wait for your API"
                inputMode="decimal"
                suffix="seconds"
                value={form.timeoutSeconds}
                disabled={readOnly}
                onChange={(event) => set({ timeoutSeconds: event.target.value })}
                error={parsed.errors.timeoutSeconds}
                hint="A call that takes longer counts as a failure and is not paid."
              />
            ) : null}
          </div>
          <p aria-live="polite" className="min-h-4 text-body-xs text-03">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : saveState === "error" ? "Could not save. We will try again when you publish." : null}
          </p>
        </div>

        <div className="flex w-full flex-col gap-4 tablet:w-[360px] tablet:shrink-0">
          <div className="flex flex-col gap-2 rounded-lg border border-01 bg-01 p-4" aria-live="polite">
            <span className="text-label-13 text-01">Summary</span>
            {mode === "FREE" ? (
              <p className="text-body-13 text-02">Free for every agent. No revenue, no stake needed, no penalty risk on money.</p>
            ) : priceMoney && youGet ? (
              <p className="text-body-13 text-01">
                Buyers pay {formatMoney(priceMoney, { decimals: 6 })} → you get {formatMoney(youGet, { decimals: 6 })} a call
                {mode === "FREEMIUM" && parsed.freeCalls ? ` after ${parsed.freeCalls.toLocaleString("en-US")} free calls per agent a day` : ""}.
              </p>
            ) : (
              <p className="text-body-13 text-03">Enter a price to see what you earn.</p>
            )}
            {mode !== "FREE" && summary ? (
              <>
                <p className="text-body-13 text-01">{summary.perTool}</p>
                {stake.isLoading ? null : (
                  <p
                    className={cn(
                      "text-body-13",
                      summary.tone === "ok" ? "text-success-700" : summary.tone === "short" ? "text-warning-700" : "text-02",
                    )}
                  >
                    {summary.total}
                  </p>
                )}
                <p className="text-body-xs text-03">
                  {summary.exposure}
                  {` ${summary.recommended}`}
                  {currentTerms ? " Figures use the current published terms." : null}
                </p>
              </>
            ) : null}
          </div>

          <BuyerPreview
            toolName={tool.name}
            description={tool.description}
            mode={mode}
            price={priceMoney}
            freeCalls={parsed.freeCalls}
            failureRate={parsed.failureRate}
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label-sm text-01">Publish {tool.name}</span>
          {move ? (
            <span role="status" className="text-body-xs text-warning-700">
              {move}{" "}
              <button type="button" className="text-primary-600 underline" onClick={onBackToTest}>
                Back to Connect &amp; test
              </button>
            </span>
          ) : null}
          {testRows.length > 0 ? (
            <ul aria-label="Tests per version" className="flex flex-col gap-0.5 py-1">
              {testRows.map((row) => (
                <li key={row.major} className={row.met ? "text-body-xs text-success-700" : "text-body-xs text-warning-700"}>
                  {row.met ? "✓ " : "• "}
                  {majorTestText(row)}
                </li>
              ))}
            </ul>
          ) : null}
          <span className="text-body-xs text-03">
            {blockReason ??
              (needsStake
                ? `Your stake is ${formatMoney(shortfall)} short. Add it in one sheet; we publish as soon as it lands.`
                : "Agents can call it as soon as you publish. You can pause it any time.")}
          </span>
          {publishError ? (
            <span role="alert" className="text-body-xs text-danger-600">
              {publishError}
            </span>
          ) : null}
        </div>
        <Button
          icon={<Rocket aria-hidden="true" />}
          loading={publishing}
          disabled={Boolean(blockReason) || check.isLoading || publishing}
          onClick={() => (needsStake ? setStakeOpen(true) : void publish())}
          className="w-full tablet:w-auto"
        >
          {needsStake ? `Add ${formatMoney(shortfall)} stake and publish` : "Publish"}
        </Button>
      </div>

      <StakeSheet
        open={stakeOpen}
        onOpenChange={setStakeOpen}
        amount={shortfall}
        reason={`${tool.name} needs ${formatMoney(totalNeeded)} of stake to take paid calls.`}
        onStaked={() => {
          setStakeOpen(false);
          void stake.refetch();
          void publish();
        }}
      />
    </section>
  );
}
