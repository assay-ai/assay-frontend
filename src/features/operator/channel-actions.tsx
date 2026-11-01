"use client";

import * as React from "react";

import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChainListContext } from "@/hooks/useChainTerms";
import type { Chain } from "@/interfaces/chain";
import type {
  ClaimUnpaidBody,
  ClaimUnpaidResult,
  ClearReconcileBody,
  ClearReconcileResult,
  DrainChannelsBody,
  DrainChannelsResult,
  OperatorRole,
} from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { claimUnpaidChannelPayouts, clearChannelReconcileStop, drainChannels } from "@/services/operator.service";
import { toast } from "@/utils/toast";

import { operatorErrorSentence } from "./operator-errors";
import { SHORT_NOTE_MIN_LENGTH } from "./reason-codes";
import { ResultCard } from "./result-card";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "./sheet-footer";

/**
 * The payment-channel overrides (round-2 W2): `M-2` drain (settle every
 * pending channel now, one asset or all), `M-3` claim unpaid (claim an
 * address's payouts the token refused, once the issuer's block has lifted)
 * and `M-4` clear a reconciler stop on one channel. All are `SRE` or `TRE`,
 * one operator, recorded in the override register; nothing is sent from the
 * API, the scheduler acts on its next tick.
 */
export type ChannelActionKind = "drain" | "claim" | "clear";

/**
 * Where the buttons sit: under one provider's payout runs (a penalty case),
 * or on the platform's Contracts page. Only the drain's wording changes.
 */
export type ChannelActionScope = "provider" | "platform";

const CHANNEL_ROLES: readonly OperatorRole[] = ["SRE", "TRE"];

/** Whether these roles may run the channel overrides (the backend checks again). */
export function mayRunChannelActions(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => CHANNEL_ROLES.includes(role));
}

const REASONS: Record<ChannelActionKind, readonly ReasonOption[]> = {
  drain: [
    { value: "INCIDENT", label: "Incident", hint: "Settle every pending channel before a pause or an upgrade." },
    { value: "OTHER", label: "Other", hint: "Say why in the note." },
  ],
  claim: [
    { value: "ISSUER_FREEZE_LIFTED", label: "Issuer block lifted", hint: "The token issuer no longer blocks the payout address." },
    { value: "OTHER", label: "Other", hint: "Say why in the note." },
  ],
  clear: [
    { value: "INVESTIGATED", label: "Explained", hint: "The settlement the database missed is found, and the chain agrees with it again." },
    { value: "OTHER", label: "Other", hint: "Say why in the note." },
  ],
};

export interface ChannelActionCopy {
  title: string;
  button: string;
  lines: string[];
  confirm: string;
  submit: string;
}

export function channelActionCopy(kind: ChannelActionKind, scope: ChannelActionScope = "provider"): ChannelActionCopy {
  if (kind === "drain" && scope === "platform") {
    return {
      title: "Settle every provider's payment channels now",
      button: "Settle all providers' channels",
      lines: [
        "Every payment channel of every provider with money to settle gets an urgent settle round on the scheduler's next tick, past every rate limit. For an incident: before a pause or an upgrade.",
        "The asset narrows it to one asset (still every provider on it). Leave it empty for every asset. Running it again changes nothing more.",
        "Recorded in the override register (M-2) under your name.",
      ],
      confirm: "I understand every provider's pending channels (of this asset, or of every asset) are settled on chain on the next tick.",
      submit: "Settle channels",
    };
  }
  if (kind === "clear") {
    return {
      title: "Clear a reconciler stop",
      button: "Clear reconcile stop",
      lines: [
        "The reconciler stopped this channel because the chain and the database disagreed on what it settled.",
        "Clear it only once you found the settlement the database missed. The backend reads the chain again first and refuses while they still disagree.",
        "The channel goes back to rotated, not open: it takes no new voucher, and what was already signed on it settles again.",
        "Recorded in the override register (M-4) under your name.",
      ],
      confirm: "I found why the chain and the database disagreed, and they agree again.",
      submit: "Clear the stop",
    };
  }
  if (kind === "drain") {
    return {
      title: "Settle every provider's payment channels now",
      button: "Settle all providers' channels",
      lines: [
        "This is not limited to this provider: every payment channel of EVERY provider with money to settle gets an urgent settle round on the scheduler's next tick, past every rate limit.",
        "The asset narrows it to one asset (still every provider on it). Leave it empty for every asset. Running it again changes nothing more.",
        "Recorded in the override register (M-2) under your name.",
      ],
      confirm:
        "I understand every provider's pending channels (of this asset, or of every asset), not only this provider's, are settled on chain on the next tick.",
      submit: "Settle channels",
    };
  }
  return {
    title: "Claim unpaid channel payouts",
    button: "Claim unpaid payouts",
    lines: [
      "The token refused these payouts (an issuer block on the payout address), so the escrow set them aside as unpaid.",
      "The scheduler claims them for this address on its next tick. If the block still holds, the claim is refused on chain and the money stays unpaid.",
      "Recorded in the override register (M-3) under your name. Running it again changes nothing more.",
    ],
    confirm: "I checked that the token issuer no longer blocks this payout address.",
    submit: "Claim payouts",
  };
}

export interface ChannelActionInput {
  assetId: string;
  address: string;
  channelRowId: string;
  reasonCode: string;
  note: string;
  ticketRef: string;
}

export interface ChannelActionErrors {
  assetId?: string;
  address?: string;
  channelRowId?: string;
  reason?: string;
  note?: string;
}

/** The asset field's example when no chain is known: never a guess at another network's id. */
export const NEUTRAL_ASSET_PLACEHOLDER = "CAIP-19 asset id";

/**
 * The asset field's example, from this console's own chains (`GET /chains`):
 * the first settlement asset, its token shortened (`eip155:46630/erc20:0xDbbC…`),
 * so a testnet console never shows a mainnet id. Pure.
 */
export function assetPlaceholder(chains: readonly Pick<Chain, "settlementAsset">[]): string {
  const asset = chains.find((chain) => chain.settlementAsset)?.settlementAsset;
  if (!asset) return NEUTRAL_ASSET_PLACEHOLDER;
  const slash = asset.lastIndexOf(":");
  const token = asset.slice(slash + 1);
  return token.length > 8 ? `${asset.slice(0, slash + 1)}${token.slice(0, 6)}…` : asset;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this is a channel row id the clear can be sent for (a UUID). Pure. */
export function isChannelRowId(value: string): boolean {
  return UUID.test(value.trim());
}

/** The form's checks, before anything is sent. Empty when it may be sent. Pure. */
export function channelActionErrors(kind: ChannelActionKind, input: ChannelActionInput): ChannelActionErrors {
  const errors: ChannelActionErrors = {};
  const asset = input.assetId.trim();
  if (kind === "claim" && !asset) errors.assetId = "Name the asset (CAIP-19).";
  if (asset.length > 256) errors.assetId = "The asset id is too long.";
  if (kind === "claim" && !ADDRESS.test(input.address.trim())) errors.address = "Enter the payout address: 0x and 40 hex characters.";
  if (kind === "clear" && !isChannelRowId(input.channelRowId)) errors.channelRowId = "Enter the channel's row id (a UUID).";
  if (!input.reasonCode) errors.reason = "Pick a reason.";
  if (input.note.trim().length < SHORT_NOTE_MIN_LENGTH) errors.note = `Write at least ${SHORT_NOTE_MIN_LENGTH} characters: why, and what you checked.`;
  return errors;
}

/** The request body, trimmed. Pure. */
export function drainBody(input: ChannelActionInput): DrainChannelsBody {
  const asset = input.assetId.trim();
  const ticket = input.ticketRef.trim();
  return {
    ...(asset ? { assetId: asset } : {}),
    reasonCode: input.reasonCode,
    note: input.note.trim(),
    ...(ticket ? { ticketRef: ticket } : {}),
  };
}

export function claimBody(input: ChannelActionInput): ClaimUnpaidBody {
  const ticket = input.ticketRef.trim();
  return {
    assetId: input.assetId.trim(),
    address: input.address.trim(),
    reasonCode: input.reasonCode,
    note: input.note.trim(),
    ...(ticket ? { ticketRef: ticket } : {}),
  };
}

export function clearBody(input: ChannelActionInput): ClearReconcileBody {
  const ticket = input.ticketRef.trim();
  return {
    channelRowId: input.channelRowId.trim(),
    reasonCode: input.reasonCode,
    note: input.note.trim(),
    ...(ticket ? { ticketRef: ticket } : {}),
  };
}

/** What the toast says once the backend took it. Pure. */
export function channelActionDone(
  kind: ChannelActionKind,
  result: DrainChannelsResult | ClaimUnpaidResult | ClearReconcileResult,
): string {
  if (kind === "clear") {
    return "The stop is cleared. The channel is rotated: it takes no new voucher, and what was signed on it settles again.";
  }
  if (kind === "drain") {
    const { channels } = result as DrainChannelsResult;
    return channels === 0
      ? "Nothing to settle: no channel has money waiting."
      : `${channels} ${channels === 1 ? "channel is" : "channels are"} settled on the scheduler's next tick.`;
  }
  const { payouts } = result as ClaimUnpaidResult;
  return payouts === 0
    ? "Nothing to claim for this address: no unpaid payout is recorded."
    : `${payouts} unpaid ${payouts === 1 ? "payout is" : "payouts are"} claimed on the scheduler's next tick.`;
}

/** What the sheet hands back once the backend took it: the result card's two lines. */
export interface ChannelActionOutcome {
  title: string;
  next: string;
}

/** The result card's title, per action. Pure. */
export function channelActionDoneTitle(kind: ChannelActionKind): string {
  if (kind === "clear") return "Reconciler stop cleared";
  if (kind === "drain") return "Channel settle round requested";
  return "Unpaid payout claim requested";
}

/** The refusal in words; a refused clear says why (the backend's detail). Pure. */
export function channelActionErrorSentence(error: unknown): string {
  if (error instanceof ApiError && error.code === "OPERATOR_CHANNEL_CLEAR_REFUSED") {
    const detail = typeof error.context?.detail === "string" ? error.context.detail : null;
    return detail ? `The stop was not cleared: ${detail}.` : "The stop was not cleared. Nothing changed.";
  }
  return operatorErrorSentence(error);
}

/**
 * The two channel buttons, for `SRE` and `TRE` only, under the provider's
 * payout runs. `assetId` prefills the asset (the provider's pending asset).
 */
export function ChannelActions({
  roles,
  assetId,
  payoutAddress = null,
}: {
  roles: readonly OperatorRole[];
  assetId: string | null;
  /** Prefills the claim's payout address: the one this provider's channels pay. */
  payoutAddress?: string | null;
}) {
  const [open, setOpen] = React.useState<ChannelActionKind | null>(null);
  const [outcome, setOutcome] = React.useState<ChannelActionOutcome | null>(null);
  if (!mayRunChannelActions(roles)) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-01 px-4 py-2.5" data-testid="operator-channel-actions">
      <div className="flex flex-wrap gap-2">
        {(["drain", "claim"] as const).map((kind) => (
          <Button key={kind} size="sm" variant="secondary" onClick={() => setOpen(kind)}>
            {channelActionCopy(kind).button}
          </Button>
        ))}
      </div>
      {outcome ? <ResultCard title={outcome.title} next={outcome.next} onDismiss={() => setOutcome(null)} /> : null}
      {open ? (
        <ChannelActionSheet
          kind={open}
          assetId={assetId}
          payoutAddress={payoutAddress}
          open
          onOpenChange={(next) => (next ? undefined : setOpen(null))}
          onDone={setOutcome}
        />
      ) : null}
    </div>
  );
}

export function ChannelActionSheet({
  kind,
  scope = "provider",
  assetId,
  payoutAddress,
  channelRowId = "",
  open,
  onOpenChange,
  onDone,
}: {
  kind: ChannelActionKind;
  scope?: ChannelActionScope;
  assetId: string | null;
  payoutAddress: string | null;
  channelRowId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * After the backend took it: the caller shows the result card (and, for
   * example, reads a list again). Without it, the outcome is a toast.
   */
  onDone?: (outcome: ChannelActionOutcome) => void;
}) {
  const copy = channelActionCopy(kind, scope);
  const placeholder = assetPlaceholder(React.useContext(ChainListContext));
  const [input, setInput] = React.useState<ChannelActionInput>({
    assetId: assetId ?? "",
    address: payoutAddress ?? "",
    channelRowId,
    reasonCode: REASONS[kind][0]!.value,
    note: "",
    ticketRef: "",
  });
  const [confirmed, setConfirmed] = React.useState(false);
  const [errors, setErrors] = React.useState<ChannelActionErrors>({});
  const [busy, setBusy] = React.useState(false);
  // Set before the first await, so a second click in the same frame sends nothing.
  const sending = React.useRef(false);
  const [failure, setFailure] = React.useState<{ sentence: string; code: string | null } | null>(null);
  const set = (key: keyof ChannelActionInput) => (value: string) => setInput((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (sending.current || busy || !confirmed) return;
    const next = channelActionErrors(kind, input);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result =
        kind === "drain"
          ? await drainChannels(drainBody(input))
          : kind === "claim"
            ? await claimUnpaidChannelPayouts(claimBody(input))
            : await clearChannelReconcileStop(clearBody(input));
      const outcome = { title: channelActionDoneTitle(kind), next: channelActionDone(kind, result) };
      if (onDone) onDone(outcome);
      else toast.success(outcome.title, { description: outcome.next });
      onOpenChange(false);
    } catch (error) {
      setFailure({ sentence: channelActionErrorSentence(error), code: error instanceof ApiError ? error.code : null });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!busy} data-testid={`channel-action-${kind}`}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{copy.title}</SheetTitle>
          <SheetDescription className="sr-only">{copy.lines.join(" ")}</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          <ul className="flex flex-col gap-1.5 text-body-13 text-02">
            {copy.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {kind === "clear" ? (
            <Field
              label="Channel row id"
              value={input.channelRowId}
              onChange={(event) => set("channelRowId")(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              maxLength={36}
              error={errors.channelRowId}
              className="font-mono text-mono-xs"
            />
          ) : (
            <Field
              label={kind === "drain" ? "Asset (CAIP-19, empty for every asset)" : "Asset (CAIP-19)"}
              value={input.assetId}
              onChange={(event) => set("assetId")(event.target.value)}
              placeholder={placeholder}
              maxLength={256}
              error={errors.assetId}
              className="font-mono text-mono-xs"
            />
          )}
          {kind === "claim" ? (
            <Field
              label="Payout address"
              value={input.address}
              onChange={(event) => set("address")(event.target.value)}
              placeholder="0x…"
              maxLength={42}
              error={errors.address}
              className="font-mono text-mono-xs"
            />
          ) : null}
          <ReasonChips
            label="Why"
            options={REASONS[kind]}
            value={input.reasonCode}
            onChange={set("reasonCode")}
            note={input.note}
            onNoteChange={set("note")}
            noteMin={SHORT_NOTE_MIN_LENGTH}
            noteMax={2048}
            notePlaceholder="Why now, and what you checked."
            errors={errors}
          />
          <Field label="Ticket (optional)" value={input.ticketRef} onChange={(event) => set("ticketRef")(event.target.value)} placeholder="OPS-1187" maxLength={128} className="font-sans text-body-sm" />
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} label={copy.confirm} />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <div role="alert" className={failure ? "text-body-xs text-danger-600" : "sr-only"}>
            {failure?.sentence ?? ""}
            {failure?.code ? (
              <details className="mt-1 text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="font-mono text-mono-xs">{failure.code}</span>
              </details>
            ) : null}
          </div>
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={busy}>
                Not now
              </Button>
            </SheetClose>
            <Button variant="danger" loading={busy} disabled={!confirmed} onClick={() => void submit()}>
              {copy.submit}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
