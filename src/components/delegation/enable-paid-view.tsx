"use client";

import * as React from "react";

import { SignAction, type WalletStep } from "@/components/patterns/sign-action";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CAP_PRESETS } from "@/features/buyer-money/caps";
import {
  ENABLE_PAID_STRINGS,
  amountLabel,
  boundLine,
  walletCheckCopy,
  type CapsDraft,
  type EnablePaidState,
  type ParsedEnablePaidCaps,
} from "@/features/delegation/enable-paid";
import { isTopLevel as defaultIsTopLevel } from "@/features/oauth/frame-guard";
import { cn } from "@/utils";

export const FRAMED_TEXT = "This page is shown inside another site. Open the link from your app directly.";
export const TICK_FIRST_TEXT = "Tick the box once the fingerprint matches what your app showed.";

export interface EnablePaidViewProps {
  state: Extract<EnablePaidState, { kind: "ready" }>;
  draft: CapsDraft;
  onDraftChange: (next: CapsDraft) => void;
  parsed: ParsedEnablePaidCaps;
  /** The chain the wallet signs for: its name and CAIP-2 id. */
  chainName: string;
  /** ISO: when the grant would end, on the chain's clock. */
  validUntil: string | null;
  /** The escrow's balance, formatted, or null when unknown. */
  balance: string | null;
  /** The balance is below the per-24-hours cap (or there is no escrow yet). */
  fundsShort: boolean;
  onAddFunds?: () => void;
  /** How many wallet signatures Approve asks for (1 or 2). */
  signatures: number;
  blocked: boolean;
  /** Why the wallet cannot sign yet, or null. */
  walletBlocker: React.ReactNode | null;
  steps: WalletStep[];
  describeError: (error: unknown) => string;
  /** Injected for tests. */
  isTopLevel?: () => boolean;
}

/**
 * "Turn on paid calls" (spec F4 step 5): the key check, funds, caps, exactly
 * what the wallet will sign, and one Approve that runs at most `SetLimits` and
 * `AuthorizeDelegate`. Approve stays off until the fingerprint box is ticked,
 * and never arms inside a frame (R-PAY-2, R-WEB-4).
 */
export function EnablePaidView({
  state,
  draft,
  onDraftChange,
  parsed,
  chainName,
  validUntil,
  balance,
  fundsShort,
  onAddFunds,
  signatures,
  blocked,
  walletBlocker,
  steps,
  describeError,
  isTopLevel = defaultIsTopLevel,
}: EnablePaidViewProps) {
  // Unknown until mounted: framed until shown otherwise.
  const [framed, setFramed] = React.useState(true);
  React.useEffect(() => setFramed(!isTopLevel()), [isTopLevel]);
  const [ticked, setTicked] = React.useState(false);

  const bound = boundLine(draft.perDay, draft.days);
  const set = (patch: Partial<CapsDraft>) => onDraftChange({ ...draft, ...patch });
  const fieldError = parsed.ok ? null : (parsed.perCall ?? parsed.perDay ?? parsed.days);

  const disabledReason: React.ReactNode | null = framed
    ? FRAMED_TEXT
    : blocked
      ? ENABLE_PAID_STRINGS.blocked
      : fieldError
        ? fieldError
        : !ticked
          ? TICK_FIRST_TEXT
          : walletBlocker;

  return (
    <section className="flex w-full max-w-[600px] flex-col gap-5 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
      {framed ? (
        <p role="alert" className="rounded-lg bg-danger-10 px-3 py-2 text-body-13 text-danger-700">
          {FRAMED_TEXT}
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
          {ENABLE_PAID_STRINGS.blocked}
        </p>
      ) : null}

      <header className="flex flex-col gap-1">
        <h1 className="text-heading-md text-01 [overflow-wrap:anywhere]">{state.title}</h1>
        <p className="text-body-sm text-02">{state.registeredBy}</p>
        <p className="text-body-xs text-03">Agent: {state.agentLabel}</p>
      </header>

      {state.notice ? (
        <p role="status" className="rounded-lg bg-success-10 px-3 py-2 text-body-13 text-success-700">
          {state.notice}
          {state.grant.kind !== "none" ? (
            <>
              {" "}
              until <UtcTime value={state.grant.delegation.validUntil} midSentence />.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-label-13 text-01">Payment key</span>
        <span className="font-mono text-heading-lg tracking-wider text-01" data-testid="fingerprint">
          {state.fingerprint}
        </span>
        <span className="text-body-sm text-02">{state.keyCheck}</span>
        <Checkbox
          checked={ticked}
          onChange={(event) => setTicked(event.currentTarget.checked)}
          disabled={framed}
          label="It matches what my app showed."
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label-13 text-01">Funds</span>
        <span className="text-body-sm text-02">Escrow balance: {balance ?? "unknown"}</span>
        {fundsShort ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-xs text-03">Below what this key may spend in 24 hours.</span>
            {onAddFunds ? (
              <Button type="button" variant="secondary" size="sm" onClick={onAddFunds}>
                Add funds
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label-13 text-01">Limits</span>
        <div className="flex flex-wrap gap-2">
          {CAP_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={draft.perCall === preset.perCall && draft.perDay === preset.perDay ? "primary" : "secondary"}
              onClick={() => set({ perCall: preset.perCall, perDay: preset.perDay })}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-body-sm text-01">
          Up to
          <CapInput label="Per call" prefix="$" value={draft.perCall} onChange={(perCall) => set({ perCall })} />
          a call ·
          <CapInput label="Per 24 hours" prefix="$" value={draft.perDay} onChange={(perDay) => set({ perDay })} />
          per 24 hours · for
          <CapInput label="Days" value={draft.days} onChange={(days) => set({ days })} />
          days.
        </p>
        {fieldError ? <p className="text-body-xs text-danger-600">{fieldError}</p> : null}
        {bound ? (
          <p className="text-body-xs text-02" data-testid="loss-bound">
            {bound}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3" data-testid="will-sign">
        <span className="text-label-13 text-01">What your wallet will sign</span>
        <SignRow label="Payment key">
          <span className="break-all font-mono text-mono-sm">{state.address}</span>
        </SignRow>
        <SignRow label="Limits">
          {amountLabel(draft.perCall)} a call · {amountLabel(draft.perDay)} per 24 hours
        </SignRow>
        <SignRow label="Valid until">{validUntil ? <UtcTime value={validUntil} /> : "—"}</SignRow>
        <SignRow label="Chain">
          {chainName} ({state.chainId})
        </SignRow>
        <span className="text-body-xs text-03">
          {signatures > 1
            ? "Two signatures: your account ceiling is raised to fit, then this key's limits."
            : "One signature."}
        </span>
      </div>

      <p className="text-body-sm text-01" data-testid="wallet-copy">
        {walletCheckCopy(state.delegateAccount, draft.perCall, draft.perDay)}
      </p>

      <SignAction
        steps={steps}
        label={state.actionLabel}
        disabled={Boolean(disabledReason)}
        disabledReason={disabledReason}
        resetKey={`${draft.perCall}|${draft.perDay}|${draft.days}`}
        describeError={describeError}
        successTitle={ENABLE_PAID_STRINGS.done}
      />
    </section>
  );
}

function SignRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 tablet:flex-row tablet:gap-3">
      <span className="w-28 shrink-0 text-body-xs text-03">{label}</span>
      <span className="min-w-0 text-body-13 text-01">{children}</span>
    </div>
  );
}

function CapInput({
  label,
  prefix,
  value,
  onChange,
}: {
  label: string;
  prefix?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-md border border-02 bg-01 px-2 py-0.5")}>
      {prefix ? <span className="text-02">{prefix}</span> : null}
      <input
        aria-label={label}
        inputMode="decimal"
        className="w-14 bg-transparent text-body-sm text-01 outline-none"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </span>
  );
}
