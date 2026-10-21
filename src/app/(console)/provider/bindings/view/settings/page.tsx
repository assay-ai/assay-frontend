"use client";

import { freeFirstHint } from "@/features/provider-binding/free-first";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { AuthenticationPanel } from "@/features/provider-binding/authentication/authentication-panel";
import { noteSaved } from "@/features/provider-binding/after-publish";
import { BindingHeader, bindingQueryKey, useBinding } from "@/features/provider-binding/binding-header";
import { integerFromInput } from "@/features/provider-binding/chrome";
import {
  freeBudgetFromInput,
  freeBudgetHint,
  freeBudgetWarning,
  freeCallsFromInput,
  freeTermsChangeRows,
  modeOfChoice,
  onlyChanged,
  penaltyExample,
  percentText,
  PRICE_CHOICES,
  stakeEffectOf,
  type PriceChoice,
} from "@/features/provider-binding/go-live";
import { useProviderCatalogue } from "@/features/provider-binding/tool-name";
import { liveFormOf, parseLiveForm, type LiveForm } from "@/features/provider-binding/wizard/live-stage";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import type { BindingAuthMode, ToolBindingDetail, UpdateToolBindingBody } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { updateToolBinding } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * A listing's Settings: price, free calls, the promise, limits and timeout in
 * one form with one Save. Replaces four pages (configuration, pricing, free
 * tier, declared SLA). The connection (address and mapping) is changed in the
 * wizard's "Connect & test" step, because a change there needs a new test
 * before it can go live — that is where the test runs.
 *
 * Changing the price or how agents pay on a live tool, or making the promise
 * stricter, asks first: buyers see the price at once, a higher price can need
 * more stake (the confirm shows needed before → after and offers to add the
 * missing stake), and a stricter promise raises the penalty risk.
 *
 * Two free limits, both call counts: `freeQuotaPerAgent` is what one agent
 * gets per day; `freeDailyBudget` is the most free calls this listing serves
 * per day across all agents (a whole number, not money — BUG-R17g-01). It is
 * sent only when the box changed; emptying it sends `null` (platform default).
 */

interface ExtraForm {
  freeBudget: string;
  maxRps: string;
  maxDailyCalls: string;
}

function extraOf(binding: ToolBindingDetail): ExtraForm {
  return {
    freeBudget: binding.freeDailyBudget == null ? "" : String(binding.freeDailyBudget),
    maxRps: binding.maxRps == null ? "" : String(binding.maxRps),
    maxDailyCalls: binding.maxDailyCalls == null ? "" : String(binding.maxDailyCalls),
  };
}

function SettingsForm({ binding }: { binding: ToolBindingDetail }) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const catalogue = useProviderCatalogue();
  const asset = catalogue.data?.settlementAsset ?? null;
  const params = useSearchParams();

  const [form, setForm] = React.useState<LiveForm>(() => liveFormOf(binding, null));
  const [extra, setExtra] = React.useState<ExtraForm>(() => extraOf(binding));
  const [authMode, setAuthMode] = React.useState<BindingAuthMode>(binding.authMode);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [stakeOpen, setStakeOpen] = React.useState(false);
  const stake = useStakeStatus();

  React.useEffect(() => {
    const section = params.get("section");
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [params]);

  if (!asset) return <PageState kind="loading" rows={4} label="Loading settings" />;

  const parsed = parseLiveForm(form, binding, asset);
  const mode = modeOfChoice(form.choice);
  const errors: Partial<Record<keyof ExtraForm, string>> = {};
  const body: UpdateToolBindingBody = { ...(parsed.body ?? {}) };

  const initialExtra = extraOf(binding);
  // Any pricing mode, as main's free-tier screen allowed (the binding-wide cap is its own field).
  const budget = freeBudgetFromInput(extra.freeBudget);
  if (extra.freeBudget !== initialExtra.freeBudget) {
    if (budget.error) errors.freeBudget = budget.error;
    else body.freeDailyBudget = budget.value;
  }
  // Fewer free calls a day in total than one agent is offered: say what agents really get.
  const budgetWarning =
    mode === "FREEMIUM" && !budget.error ? freeBudgetWarning(budget.value, freeCallsFromInput(form.freeCalls).value) : null;
  for (const key of ["maxRps", "maxDailyCalls"] as const) {
    if (extra[key] === initialExtra[key]) continue;
    const parsedInt = integerFromInput(extra[key]);
    if (parsedInt.error) errors[key] = parsedInt.error;
    else if (parsedInt.value === 0) errors[key] = "Leave it empty for no limit; 0 would stop all calls.";
    else body[key] = parsedInt.value;
  }

  if (authMode !== binding.authMode) body.authMode = authMode;

  const hasErrors = Object.keys(parsed.errors).length > 0 || Object.keys(errors).length > 0;
  const changed = Object.keys(body).length > 0;
  const pricingChanged = body.pricingMode !== undefined || body.priceAmount !== undefined || body.freeQuotaPerAgent !== undefined;
  // The free terms changing, for the confirm's rows (the per-day total included once the confirm opens).
  const freeTermsRows = freeTermsChangeRows(binding, body);
  const live = binding.status === "ACTIVE";
  const promiseStricter = body.slaFailureRate !== undefined && body.slaFailureRate < binding.slaFailureRate;
  const effect = stakeEffectOf({ binding, price: parsed.price, mode, stake: stake.stake, staked: stake.staked });
  const stakeRises =
    pricingChanged && effect.after !== null && (effect.before === null || BigInt(effect.after.amount) > BigInt(effect.before.amount));
  const shortAfterSave = pricingChanged ? effect.shortfall : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateToolBinding(binding.id, body);
      noteSaved(saved);
      // Seeded from the answer: a refetch right after a write is served the old body from the HTTP cache.
      queryClient.setQueryData(bindingQueryKey(binding.id), saved);
      void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
      void queryClient.invalidateQueries({ queryKey: ["provider", "stake"] });
      setForm(liveFormOf(saved, null));
      setExtra(extraOf(saved));
      setAuthMode(saved.authMode);
      toast.success(saved.hasUnpublishedChanges ? "Saved. Publish the changes to make them live." : "Saved");
    } catch (caught) {
      setError(caught instanceof ApiError ? plainError(caught.code) : "Your changes could not be saved. Try again.");
      throw caught;
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (live && (pricingChanged || promiseStricter)) setConfirmOpen(true);
    else void save().catch(() => undefined);
  };

  const set = (patch: Partial<LiveForm>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <>
      {binding.hasUnpublishedChanges ? (
        <div className="flex w-full flex-col gap-2 rounded-lg bg-primary-10 px-4 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-body-13 text-primary-700">You have saved changes that are not live yet.</p>
          <Button size="sm" asChild>
            <Link href={routes.bindingWizard(binding.id, "live")}>Review and publish</Link>
          </Button>
        </div>
      ) : null}

      <Panel className="w-full" id="settings-pricing">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Price</PanelTitle>
            <PanelDescription>What agents pay for each call</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
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
          {mode !== "FREE" ? (
            <Field
              label="Price per call"
              inputMode="decimal"
              suffix="$ a call"
              value={form.price}
              disabled={readOnly}
              onChange={(event) => set({ price: event.target.value })}
              error={parsed.errors.price}
              hint={
                effect.after
                  ? `At this price your paid tools need ${formatMoney(effect.after)} of stake; you have ${formatMoney(stake.staked)}.`
                  : "A higher price needs more stake."
              }
            />
          ) : null}
          {/* The binding-wide cap is offered in every mode, as main's free-tier screen did. */}
          <div className="grid w-full grid-cols-1 gap-4 tablet:grid-cols-2">
            {mode === "FREEMIUM" ? (
              <Field
                label="Free calls per agent per day"
                inputMode="numeric"
                suffix="calls"
                hint="What one agent can use from this listing. Resets at 00:00 UTC."
                value={form.freeCalls}
                disabled={readOnly}
                onChange={(event) => set({ freeCalls: event.target.value })}
                error={parsed.errors.freeCalls}
              />
            ) : null}
            <Field
              label="Free calls per day, all agents (optional)"
              inputMode="numeric"
              suffix="calls"
              value={extra.freeBudget}
              disabled={readOnly}
              placeholder="Platform default"
              onChange={(event) => setExtra((current) => ({ ...current, freeBudget: event.target.value }))}
              error={errors.freeBudget}
              hint={freeBudgetHint(mode)}
            />
          </div>
          {budgetWarning ? (
            <p className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="free-budget-warning">
              {budgetWarning}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel className="w-full" id="settings-promise">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Your promise</PanelTitle>
            <PanelDescription>Measured on every call; part of your stake is at risk if you break it</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="grid w-full grid-cols-1 gap-4 p-4 tablet:grid-cols-2 tablet:p-5">
          <Field
            label="Failures you promise to stay under"
            inputMode="decimal"
            suffix="%"
            value={form.failurePercent}
            disabled={readOnly}
            onChange={(event) => set({ failurePercent: event.target.value })}
            error={parsed.errors.failurePercent}
            hint={[
              "Out of every 100 checked calls. A new value applies from the next window.",
              penaltyExample(parsed.price, mode, parsed.failureRate),
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <Field
            label="Time we wait for your API"
            inputMode="decimal"
            suffix="seconds"
            value={form.timeoutSeconds}
            disabled={readOnly}
            onChange={(event) => set({ timeoutSeconds: event.target.value })}
            error={parsed.errors.timeoutSeconds}
            hint="A slower answer counts as a failure and is not paid."
          />
        </PanelBody>
      </Panel>

      <Panel className="w-full" id="settings-limits">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Limits (optional)</PanelTitle>
            <PanelDescription>Above a limit, calls go to another provider. It is not a failure.</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="grid w-full grid-cols-1 gap-4 p-4 tablet:grid-cols-2 tablet:p-5">
          <Field
            label="Most calls per second"
            inputMode="numeric"
            placeholder="No limit"
            value={extra.maxRps}
            disabled={readOnly}
            onChange={(event) => setExtra((current) => ({ ...current, maxRps: event.target.value }))}
            error={errors.maxRps}
          />
          <Field
            label="Most calls per day"
            inputMode="numeric"
            placeholder="No limit"
            value={extra.maxDailyCalls}
            disabled={readOnly}
            onChange={(event) => setExtra((current) => ({ ...current, maxDailyCalls: event.target.value }))}
            error={errors.maxDailyCalls}
          />
        </PanelBody>
      </Panel>

      <Panel className="w-full" id="settings-connection">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Connection</PanelTitle>
            <PanelDescription>Where your API lives and how calls map to it</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-5">
          {/* The full address, here only: lists and headers show a short label (`labelForEndpoint`). */}
          <p className="min-w-0 break-all font-mono text-mono-13 text-01">{binding.endpoint}</p>
          <Button variant="secondary" size="sm" asChild>
            <Link href={routes.bindingWizard(binding.id, "connect")}>
              Change and test again
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </PanelBody>
      </Panel>

      <Panel className="w-full" id="settings-authentication">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Authentication</PanelTitle>
            <PanelDescription>How your API knows a request is from Assay</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          <AuthenticationPanel
            bindingId={binding.id}
            endpoint={binding.endpoint}
            savedEndpoint={binding.endpoint}
            publishedEndpoint={binding.publishedEndpoint}
            mode={authMode}
            onModeChange={setAuthMode}
            readOnly={readOnly}
          />
        </PanelBody>
      </Panel>

      <div className="flex w-full flex-wrap items-center gap-2 px-1 text-body-xs text-03">
        <span>For support: listing id</span>
        <CopyChip value={binding.id} label="listing id" />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-1 border-t border-01 bg-01 px-4 py-3 tablet:-mx-[26px] tablet:flex-row tablet:items-center tablet:justify-between tablet:px-[26px]">
        <span aria-live="polite" className={error ? "text-body-xs text-danger-600" : "text-body-xs text-03"}>
          {error ??
            (readOnly
              ? "Your account is blocked, so changes are paused."
              : hasErrors
                ? "Fix the fields marked above."
                : changed
                  ? "You have unsaved changes."
                  : "No changes.")}
        </span>
        <Button onClick={onSave} loading={saving} disabled={readOnly || hasErrors || !changed} className="w-full tablet:w-auto">
          Save
        </Button>
      </div>

      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="primary"
        title={pricingChanged ? "Change what buyers pay?" : "Make your promise stricter?"}
        description={
          <>
            {pricingChanged ? "Buyers see the new terms once you publish them. Calls already made keep the old price. " : ""}
            {promiseStricter
              ? "A stricter promise raises your penalty risk: from the next window, fewer failed calls are enough to go over it."
              : null}
          </>
        }
        changes={onlyChanged([
          ...(body.priceAmount !== undefined
            ? [
                {
                  label: "Price",
                  before:
                    binding.pricingMode === "FREE" ? "Free" : `${formatMoney(binding.price, { decimals: 6 })} a call`,
                  after: mode === "FREE" || !parsed.price ? "Free" : `${formatMoney(parsed.price, { decimals: 6 })} a call`,
                },
              ]
            : []),
          ...freeTermsRows,
          ...(pricingChanged && (effect.before || effect.after)
            ? [
                {
                  label: `Stake needed (you have ${formatMoney(stake.staked)})`,
                  before: effect.before ? formatMoney(effect.before) : "None",
                  after: effect.after ? formatMoney(effect.after) : "None",
                },
              ]
            : []),
          ...(body.slaFailureRate !== undefined
            ? [
                {
                  label: "Failures you promise to stay under",
                  before: `${percentText(binding.slaFailureRate)}%`,
                  after: `${percentText(body.slaFailureRate)}%`,
                },
              ]
            : []),
        ])}
        confirmLabel={
          shortAfterSave ? `Add ${formatMoney(shortAfterSave)} stake, then save` : pricingChanged ? "Save new price" : "Save new promise"
        }
        onConfirm={shortAfterSave ? () => setStakeOpen(true) : save}
      >
        {shortAfterSave ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700">
            <p>
              Your stake is {formatMoney(shortAfterSave)} short of what the new price needs. Until it covers{" "}
              {formatMoney(effect.after)}, paid tools above your stake stop taking paid calls.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                setConfirmOpen(false);
                void save().catch(() => undefined);
              }}
            >
              Save without adding stake
            </Button>
          </div>
        ) : stakeRises ? (
          <p className="text-body-13 text-02">Your stake already covers the new price.</p>
        ) : null}
      </ConfirmSheet>

      <StakeSheet
        open={stakeOpen}
        onOpenChange={setStakeOpen}
        amount={shortAfterSave}
        reason={`The new price needs ${formatMoney(effect.after)} of stake. Your price is saved once the stake lands.`}
        onStaked={() => {
          setStakeOpen(false);
          void stake.refetch();
          void save().catch(() => undefined);
        }}
      />
    </>
  );
}

function SettingsContent() {
  const bindingId = useSearchParams().get("binding") ?? "";
  const bindingQuery = useBinding(bindingId);
  const binding = bindingQuery.data;

  if (bindingQuery.isError) {
    return (
      <PageState
        kind="error"
        title="This listing could not be opened"
        onRetry={() => void bindingQuery.refetch()}
        code={bindingQuery.error instanceof ApiError ? bindingQuery.error.code : null}
      />
    );
  }

  return (
    <>
      <BindingHeader bindingId={bindingId} binding={binding} active="settings" />
      {!binding ? (
        <PageState kind="loading" rows={5} label="Loading settings" />
      ) : binding.status === "DRAFT" ? (
        <PageState
          kind="empty"
          title="Finish setting up first"
          description="A draft's price and promise are set in the listing wizard, next to the Publish button."
          action={{ label: "Continue setup", href: routes.bindingWizard(binding.id) }}
        />
      ) : (
        <SettingsForm key={`${binding.id}:${binding.version}`} binding={binding} />
      )}
    </>
  );
}

export default function BindingSettingsPage() {
  return <SettingsContent />;
}
