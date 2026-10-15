"use client";

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
import { BindingHeader, bindingQueryKey, useBinding } from "@/features/provider-binding/binding-header";
import { integerFromInput, majorInputFromMoney, minorUnitsFromMajorInput } from "@/features/provider-binding/chrome";
import { modeOfChoice, PRICE_CHOICES, type PriceChoice } from "@/features/provider-binding/go-live";
import { useProviderCatalogue } from "@/features/provider-binding/tool-name";
import { liveFormOf, parseLiveForm, type LiveForm } from "@/features/provider-binding/wizard/live-stage";
import type { ToolBindingDetail, UpdateToolBindingBody } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { updateToolBinding } from "@/services/provider-tool-bindings.service";
import { labelForEndpoint } from "@/utils/provider-label";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * A listing's Settings: price, free calls, the promise, limits and timeout in
 * one form with one Save. Replaces four pages (configuration, pricing, free
 * tier, declared SLA). The connection (address and mapping) is changed in the
 * wizard's "Connect & test" step, because a change there needs a new test
 * before it can go live — that is where the test runs.
 *
 * Changing the price or how agents pay on a live tool asks first, because
 * buyers see it at once. `freeDailyBudget` reads as a number and writes as a
 * digits string (minor units): it is sent only when the box changed.
 */

interface ExtraForm {
  freeBudget: string;
  maxRps: string;
  maxDailyCalls: string;
}

function extraOf(binding: ToolBindingDetail, decimals: number): ExtraForm {
  return {
    freeBudget:
      binding.freeDailyBudget == null
        ? ""
        : majorInputFromMoney({ amount: String(binding.freeDailyBudget), asset: "", decimals }),
    maxRps: binding.maxRps == null ? "" : String(binding.maxRps),
    maxDailyCalls: binding.maxDailyCalls == null ? "" : String(binding.maxDailyCalls),
  };
}

function SettingsForm({ binding }: { binding: ToolBindingDetail }) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const catalogue = useProviderCatalogue();
  const asset = catalogue.data?.settlementAsset ?? null;
  const decimals = asset?.decimals ?? binding.price.decimals;
  const params = useSearchParams();

  const [form, setForm] = React.useState<LiveForm>(() => liveFormOf(binding, null));
  const [extra, setExtra] = React.useState<ExtraForm>(() => extraOf(binding, decimals));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    const section = params.get("section");
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [params]);

  if (!asset) return <PageState kind="loading" rows={4} label="Loading settings" />;

  const parsed = parseLiveForm(form, binding, asset);
  const mode = modeOfChoice(form.choice);
  const errors: Partial<Record<keyof ExtraForm, string>> = {};
  const body: UpdateToolBindingBody = { ...(parsed.body ?? {}) };

  const initialExtra = extraOf(binding, decimals);
  if (extra.freeBudget !== initialExtra.freeBudget && mode === "FREEMIUM") {
    if (extra.freeBudget.trim() === "") body.freeDailyBudget = null;
    else {
      const minor = minorUnitsFromMajorInput(extra.freeBudget, decimals);
      if (minor.error) errors.freeBudget = minor.error;
      else body.freeDailyBudget = minor.amount;
    }
  }
  for (const key of ["maxRps", "maxDailyCalls"] as const) {
    if (extra[key] === initialExtra[key]) continue;
    const parsedInt = integerFromInput(extra[key]);
    if (parsedInt.error) errors[key] = parsedInt.error;
    else if (parsedInt.value === 0) errors[key] = "Leave it empty for no limit; 0 would stop all calls.";
    else body[key] = parsedInt.value;
  }

  const hasErrors = Object.keys(parsed.errors).length > 0 || Object.keys(errors).length > 0;
  const changed = Object.keys(body).length > 0;
  const pricingChanged = body.pricingMode !== undefined || body.priceAmount !== undefined || body.freeQuotaPerAgent !== undefined;
  const live = binding.status === "ACTIVE";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateToolBinding(binding.id, body);
      // Seeded from the answer: a refetch right after a write is served the old body from the HTTP cache.
      queryClient.setQueryData(bindingQueryKey(binding.id), saved);
      void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
      void queryClient.invalidateQueries({ queryKey: ["provider", "stake"] });
      setForm(liveFormOf(saved, null));
      setExtra(extraOf(saved, decimals));
      toast.success(saved.hasUnpublishedChanges ? "Saved. Publish the changes to make them live." : "Saved");
    } catch (caught) {
      setError(caught instanceof ApiError ? plainError(caught.code) : "Your changes could not be saved. Try again.");
      throw caught;
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (live && pricingChanged) setConfirmOpen(true);
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
          <p className="text-body-xs text-03">{PRICE_CHOICES.find((c) => c.value === form.choice)?.hint}</p>
          {mode !== "FREE" ? (
            <Field
              label="Price per call"
              inputMode="decimal"
              suffix={asset.symbol}
              value={form.price}
              disabled={readOnly}
              onChange={(event) => set({ price: event.target.value })}
              error={parsed.errors.price}
              hint="A higher price needs more stake. The Stake page shows how much."
            />
          ) : null}
          {mode === "FREEMIUM" ? (
            <div className="grid w-full grid-cols-1 gap-4 tablet:grid-cols-2">
              <Field
                label="Free calls per agent per day"
                inputMode="numeric"
                value={form.freeCalls}
                disabled={readOnly}
                onChange={(event) => set({ freeCalls: event.target.value })}
                error={parsed.errors.freeCalls}
              />
              <Field
                label="Most you give away free per day (optional)"
                inputMode="decimal"
                suffix={asset.symbol}
                value={extra.freeBudget}
                disabled={readOnly}
                placeholder="No limit"
                onChange={(event) => setExtra((current) => ({ ...current, freeBudget: event.target.value }))}
                error={errors.freeBudget}
                hint="Counted at your price. Once reached, free calls stop until tomorrow."
              />
            </div>
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
            hint="Out of every 100 checked calls. A new value applies from the next window."
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
          <p className="min-w-0 break-all font-mono text-mono-13 text-01">{labelForEndpoint(binding.endpoint)}</p>
          <Button variant="secondary" size="sm" asChild>
            <Link href={routes.bindingWizard(binding.id, "connect")}>
              Change and test again
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
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
        title="Change what buyers pay?"
        description="Buyers see the new terms once you publish them. Calls already made keep the old price."
        changes={[
          {
            label: "Price",
            before:
              binding.pricingMode === "FREE" ? "Free" : `${formatMoney(binding.price, { decimals: 6 })} a call`,
            after: mode === "FREE" || !parsed.price ? "Free" : `${formatMoney(parsed.price, { decimals: 6 })} a call`,
          },
        ]}
        confirmLabel="Save new price"
        onConfirm={save}
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
