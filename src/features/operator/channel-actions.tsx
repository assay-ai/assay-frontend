"use client";

import * as React from "react";

import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type {
  ClaimUnpaidBody,
  ClaimUnpaidResult,
  DrainChannelsBody,
  DrainChannelsResult,
  OperatorRole,
} from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { claimUnpaidChannelPayouts, drainChannels } from "@/services/operator.service";
import { toast } from "@/utils/toast";

import { operatorErrorSentence } from "./operator-errors";
import { SHORT_NOTE_MIN_LENGTH } from "./reason-codes";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "./sheet-footer";

/**
 * The two payment-channel overrides (round-2 W2): `M-2` drain (settle every
 * pending channel now, one asset or all) and `M-3` claim unpaid (claim an
 * address's payouts the token refused, once the issuer's block has lifted).
 * Both are `SRE` or `TRE`, one operator, recorded in the override register,
 * and idempotent; nothing is sent from the API, the scheduler acts on its
 * next tick.
 */
export type ChannelActionKind = "drain" | "claim";

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
};

export interface ChannelActionCopy {
  title: string;
  button: string;
  lines: string[];
  confirm: string;
  submit: string;
}

export function channelActionCopy(kind: ChannelActionKind): ChannelActionCopy {
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
  reasonCode: string;
  note: string;
  ticketRef: string;
}

export interface ChannelActionErrors {
  assetId?: string;
  address?: string;
  reason?: string;
  note?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The form's checks, before anything is sent. Empty when it may be sent. Pure. */
export function channelActionErrors(kind: ChannelActionKind, input: ChannelActionInput): ChannelActionErrors {
  const errors: ChannelActionErrors = {};
  const asset = input.assetId.trim();
  if (kind === "claim" && !asset) errors.assetId = "Name the asset (CAIP-19).";
  if (asset.length > 256) errors.assetId = "The asset id is too long.";
  if (kind === "claim" && !ADDRESS.test(input.address.trim())) errors.address = "Enter the payout address: 0x and 40 hex characters.";
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

/** What the toast says once the backend took it. Pure. */
export function channelActionDone(
  kind: ChannelActionKind,
  result: DrainChannelsResult | ClaimUnpaidResult,
): string {
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
  if (!mayRunChannelActions(roles)) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-01 px-4 py-2.5" data-testid="operator-channel-actions">
      {(["drain", "claim"] as const).map((kind) => (
        <Button key={kind} size="sm" variant="secondary" onClick={() => setOpen(kind)}>
          {channelActionCopy(kind).button}
        </Button>
      ))}
      {open ? (
        <ChannelActionSheet
          kind={open}
          assetId={assetId}
          payoutAddress={payoutAddress}
          open
          onOpenChange={(next) => (next ? undefined : setOpen(null))}
        />
      ) : null}
    </div>
  );
}

function ChannelActionSheet({
  kind,
  assetId,
  payoutAddress,
  open,
  onOpenChange,
}: {
  kind: ChannelActionKind;
  assetId: string | null;
  payoutAddress: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = channelActionCopy(kind);
  const [input, setInput] = React.useState<ChannelActionInput>({
    assetId: assetId ?? "",
    address: payoutAddress ?? "",
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
      const result = kind === "drain" ? await drainChannels(drainBody(input)) : await claimUnpaidChannelPayouts(claimBody(input));
      toast.success(copy.title, { description: channelActionDone(kind, result) });
      onOpenChange(false);
    } catch (error) {
      setFailure({ sentence: operatorErrorSentence(error), code: error instanceof ApiError ? error.code : null });
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
          <Field
            label={kind === "drain" ? "Asset (CAIP-19, empty for every asset)" : "Asset (CAIP-19)"}
            value={input.assetId}
            onChange={(event) => set("assetId")(event.target.value)}
            placeholder="eip155:4663/erc20:0x…"
            maxLength={256}
            error={errors.assetId}
            className="font-mono text-mono-xs"
          />
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
