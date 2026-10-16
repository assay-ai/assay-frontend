"use client";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert, Wallet } from "lucide-react";
import * as React from "react";

import { DEMO_SIGNING_NOTE } from "@/components/patterns/sign-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  capsAboveEscrow,
  confirmsDelegateKey,
  type DelegateBinding,
  defaultDelegationForm,
  delegationInvalidText,
  type DelegationFormErrors,
  type DelegationFormInput,
  delegationRows,
  editDelegationForm,
  errorsAfterEdit,
  escrowCanDelegate,
  findDelegation,
  keyFingerprint,
  parseDelegationForm,
  serverNowSeconds,
  supportsDelegation,
  validUntilSeconds,
} from "@/features/delegation/delegation-form";
import {
  type ExpectedDomain,
  submitRelayedDelegation,
} from "@/features/delegation/relayed-delegation";
import {
  editIsUnchanged,
  type HeldStale,
  heldIsStale,
  heldStaleText,
  isUnsettledRefusal,
  loweredDelayNote,
  revokeDelayNote,
  liveDelegation,
  strandReasons,
  UNSETTLED_POLL_MS,
  unsettledLine,
  editedToast,
} from "@/features/delegation/unsettled";
import { isRelayedRefusal, relayedRefusal } from "@/features/escrow/relayed-refusal";
import { useChains } from "@/hooks/useChains";
import { isRailNotOffered, railNotOfferedText, servesPaidCalls } from "@/libs/chains/paid-rails";
import { isUserRejection, type Signer, useSigner } from "@/hooks/useSigner";
import type { BuyerEscrow, DelegateIntent, EscrowDelegate } from "@/interfaces";
import { isTypedDataRequest } from "@/interfaces/chain-transaction";
import { ApiError } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { rememberDemoDelegateCaps } from "@/libs/demo/demo-stage";
import { chainDisplayName, settlementSymbol } from "@/services/chains.service";
import {
  createDelegateIntent,
  createRevokeDelegateIntent,
  listDelegates,
  submitDelegate,
  submitRevokeDelegate,
} from "@/services/delegation.service";
import { getEscrow } from "@/services/escrow.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatLocalDate } from "@/libs/local-time";
import { type BudgetBootstrap, BudgetFields, useBudgetDraft } from "@/components/buyer-money/budget-fields";
import type { SpendPolicy } from "@/services/limits.service";
import { toast } from "@/utils/toast";

import { MicroLabel, StatusPill } from "./chrome";
import { dateOnly, formatLimit, relativeTime } from "./format";
import { UnsettledPayments, useSettleWait } from "./unsettled-payments";

/** The credential fields this section reads. */
export interface DelegationCredential {
  id: string;
  name: string;
  revokedAt: string | null;
  /** CAIP-10 of the delegate key the agent proved it holds, or null. */
  delegateAccount?: string | null;
  delegateBoundAt?: string | null;
}

/**
 * Agent payment delegation on `/agents`.
 *
 * The agent holds a key of its own (a Privy embedded wallet's key never leaves
 * Privy) and has proved, with its credential, that it holds it — that is the
 * credential's bound DELEGATE. The person, with their own wallet, signs one
 * EIP-712 `AuthorizeDelegate` granting that key the right to sign payments from
 * their escrow, within caps no higher than the escrow's own limits, until an
 * expiry. The platform relays it, so no gas is needed. The grant lives on chain,
 * is listed from the chain, and is revoked the same way. The delegate can sign
 * payments and nothing else.
 *
 * Two pieces:
 * - {@link PayerDelegationsPanel}, once per page: EVERY on-chain grant of the
 *   payer, with the credentials bound to it joined on, each revocable — a grant
 *   whose credential was revoked or rebound must never disappear (review S2-5);
 * - {@link AgentPaymentDelegation}, per agent: its credentials' bound keys and
 *   "Authorize agent to pay" for those not authorised yet.
 */

/** Everything both pieces need to read and sign, for one payer account. */
function useDelegationContext(account: string | undefined, version: number) {
  const chainId = chainIdOfAccount(account);
  const enabled = supportsDelegation(account);
  const signerState = useSigner({
    chainId,
    address: addressOfAccount(account),
  });
  const { chains } = useChains();
  const unit = (chainId && settlementSymbol(chains, chainId)) || "";

  const escrowQuery = useQuery({
    queryKey: ["escrow", chainId],
    enabled,
    retry: 0,
    queryFn: () => getEscrow(chainId),
  });
  const delegatesQuery = useQuery({
    queryKey: ["escrow-delegates", version],
    enabled,
    retry: 0,
    queryFn: () => listDelegates(version),
  });

  const signer = (): Signer => {
    if (signerState.status === "ready") return signerState.signer;
    if (signerState.status === "address-not-connected") {
      throw new Error(
        `Connect the wallet ${addressOfAccount(account)} — only it can sign for this escrow.`,
      );
    }
    throw new Error("Connect your wallet to sign.");
  };

  /** The escrow's EIP-712 domain as this app knows it — never taken from the request (review S3-10). */
  const domain = (escrow: BuyerEscrow | undefined): ExpectedDomain => {
    const contract = escrow?.escrowPda
      ? addressOfAccount(escrow.escrowPda)
      : "";
    if (!chainId || !contract) {
      throw new Error(
        "The escrow could not be read, so there is nothing to check a signature request against.",
      );
    }
    return { chainId: chainId.split(":")[1], verifyingContract: contract };
  };

  return {
    chainId,
    chains,
    enabled,
    unit,
    escrowQuery,
    delegatesQuery,
    signer,
    domain,
  };
}

function explain(error: unknown, fallback: string): string {
  if (isUserRejection(error))
    return "Nothing was signed — the wallet prompt was closed or declined.";
  // A relay refusal in words, with when to retry (BUG-D1-06) — never a raw account string.
  if (isRelayedRefusal(error)) return relayedRefusal(error).text;
  // A rejected sign-in (401) is never shown as the server's own words
  // ("MCP credential is missing or invalid" reached a buyer this way).
  if (error instanceof ApiError && error.status === 401) {
    return "Your session has ended, so nothing was changed. Sign in again, then try once more.";
  }
  // 409 CHAIN_RAIL_NOT_OFFERED: the chain serves free calls only.
  if (isRailNotOffered(error)) return railNotOfferedText(null);
  // 400 SETTLEMENT_DELEGATION_INVALID: an expiry too soon (D-21) or caps the escrow refuses.
  const invalid = delegationInvalidText(error);
  if (invalid) return invalid;
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

/** Who the authorise / edit sheet is for. `current` set means editing that standing grant. */
interface SheetTarget {
  delegateAccount: string;
  boundAt?: string | null;
  current?: EscrowDelegate | null;
}

/** "The escrow's own limit is lower" — a grant whose caps the escrow no longer allows (BUG-D1-03). */
function EscrowLimitWarning({
  delegation,
  escrow,
  unit,
}: {
  delegation: EscrowDelegate;
  escrow: BuyerEscrow | undefined;
  unit: string;
}) {
  const above = capsAboveEscrow(delegation, escrow);
  if (!above.maxVoucherAmount && !above.maxPerWindow) return null;
  const parts = [
    above.maxVoucherAmount ? `${exact(above.maxVoucherAmount, unit)} a payment` : null,
    above.maxPerWindow ? `${exact(above.maxPerWindow, unit)} per 24 hours` : null,
  ].filter(Boolean);
  return (
    <span
      className="flex items-start gap-1 text-body-xs text-warning-700"
      data-testid="delegate-above-escrow-limits"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      Your account ceiling now allows only {parts.join(" and ")}. It keeps applying, so this
      agent’s payments above it are refused. Lower this agent’s spending limits, or raise
      your account ceiling.
    </span>
  );
}

/** Full precision: a cap of 0.005 must not read as 0.01 (review S3-11). */
function exact(
  money: EscrowDelegate["maxVoucherAmount"],
  _unit?: string,
): string {
  // Dollars at two decimals (sub-cent amounts keep their digits), never 6-decimal token units.
  return formatLimit(money);
}

/** "Who can pay from your escrow" — every on-chain grant of the payer, each revocable. */
export function PayerDelegationsPanel({
  account,
  bindings,
  version,
  onChanged,
  onlyUnbound = false,
}: {
  account: string | undefined;
  bindings: readonly DelegateBinding[];
  version: number;
  onChanged: () => void;
  /** Only keys not bound to a live credential (the per-agent cards show the rest). Hidden when there are none. */
  onlyUnbound?: boolean;
}) {
  const ctx = useDelegationContext(account, version);
  const [revoking, setRevoking] = React.useState<EscrowDelegate | null>(null);
  const [editing, setEditing] = React.useState<SheetTarget | null>(null);
  if (!ctx.enabled) return null;

  const all = delegationRows(ctx.delegatesQuery.data?.delegates, bindings);
  const rows = onlyUnbound ? all.filter((row) => !row.bound) : all;
  if (onlyUnbound && rows.length === 0 && !ctx.delegatesQuery.isError) return null;

  return (
    <div
      className="flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 p-3.5 tablet:p-[15px]"
      data-testid="payer-delegations"
    >
      <MicroLabel>{onlyUnbound ? "OTHER KEYS THAT CAN STILL PAY" : "KEYS THAT CAN PAY FROM YOUR ESCROW"}</MicroLabel>
      {ctx.delegatesQuery.isError ? (
        <p className="text-body-xs text-danger-600">
          The authorisations could not be read from the chain:{" "}
          {ctx.delegatesQuery.error instanceof Error
            ? ctx.delegatesQuery.error.message
            : "unknown error"}
          . This is not a statement that none exist.
        </p>
      ) : ctx.delegatesQuery.isPending ? (
        <p className="font-mono text-mono-13 text-03">Reading the chain…</p>
      ) : rows.length === 0 ? (
        <p className="text-body-13 text-02">
          No agent key is allowed to pay from your escrow.
        </p>
      ) : (
        rows.map(({ delegation, bindings: matched, bound }) => (
          <div
            key={delegation.delegate}
            data-testid="payer-delegation-row"
            className="flex w-full flex-col gap-2 rounded-lg border border-01 p-3 tablet:flex-row tablet:items-center"
          >
            <Wallet aria-hidden="true" className="size-4 shrink-0 text-02" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="break-all font-mono text-mono-xs text-01">
                {addressOfAccount(delegation.delegate)}
              </span>
              <span className="text-body-xs text-03">
                up to {exact(delegation.maxVoucherAmount, ctx.unit)} a payment ·{" "}
                {exact(delegation.spentInWindow, ctx.unit)} of{" "}
                {exact(delegation.maxPerWindow, ctx.unit)} used this window ·{" "}
                {delegation.status === "EXPIRED" ? "expired" : "until"}{" "}
                {dateOnly(delegation.validUntil)}
              </span>
              {matched.length > 0
                ? matched.map((b) => (
                    <span key={b.credentialId} className="text-body-xs text-03">
                      {b.agentLabel} · {b.credentialName}
                      {b.delegateBoundAt
                        ? ` · bound ${relativeTime(b.delegateBoundAt)}`
                        : ""}
                      {b.revokedAt ? " · API key revoked" : ""}
                    </span>
                  ))
                : null}
              {unsettledLine(delegation.unsettled, ctx.unit) ? (
                <span className="text-body-xs text-03" data-testid="delegate-unsettled">
                  {unsettledLine(delegation.unsettled, ctx.unit)}
                </span>
              ) : null}
              <EscrowLimitWarning
                delegation={delegation}
                escrow={ctx.escrowQuery.data}
                unit={ctx.unit}
              />
              {!bound ? (
                <span
                  className="flex items-center gap-1 text-body-xs text-warning-700"
                  data-testid="unbound-delegate"
                >
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  Its API key is gone, but this payment key can still pay until you
                  stop it paying.
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusPill
                label={
                  delegation.status === "EXPIRED" ? "EXPIRED" : "CAN PAY"
                }
                tone={delegation.status === "EXPIRED" ? "danger" : "teal"}
              />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                data-testid="edit-delegate"
                disabled={!escrowCanDelegate(ctx.escrowQuery.data)}
                onClick={() =>
                  setEditing({
                    delegateAccount: delegation.delegate,
                    boundAt: matched.find((b) => !b.revokedAt)?.delegateBoundAt ?? null,
                    current: delegation,
                  })
                }
              >
                Change spending limits
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                className="text-danger-600"
                data-testid="revoke-delegate"
                onClick={() => setRevoking(delegation)}
              >
                Stop it paying
              </Button>
            </div>
          </div>
        ))
      )}
      <AuthorizeSheet
        target={editing}
        escrow={ctx.escrowQuery.data}
        escrowReceivedAt={ctx.escrowQuery.dataUpdatedAt}
        unit={ctx.unit}
        tightenDelaySeconds={ctx.delegatesQuery.data?.tightenDelaySeconds}
        onClose={() => setEditing(null)}
        onFinished={() => {
          setEditing(null);
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
      <RevokeSheet
        target={revoking}
        escrow={ctx.escrowQuery.data}
        unit={ctx.unit}
        tightenDelaySeconds={ctx.delegatesQuery.data?.tightenDelaySeconds}
        onClose={() => setRevoking(null)}
        onFinished={() => {
          setRevoking(null);
          // Refetch whatever happened: a relay that landed and then failed to read
          // back is still a change on chain (review S3-12).
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
    </div>
  );
}

/**
 * The delegate's grant as the chain shows it NOW, for a sheet about to change
 * it (BUG-D1-07, BUG-D1-08): the list is read again, past the browser's cache,
 * every time the sheet opens — the page's list can predate a payment made
 * since — and on every `refresh` while waiting. One query key per delegate, so
 * polling adds no cache entries, and a refetch already in flight is joined
 * rather than restarted (review finding 10). See `liveDelegation`.
 */
function useLiveDelegation(
  delegate: string,
  opened: EscrowDelegate | null,
  open: boolean,
) {
  const read = useQuery({
    queryKey: ["escrow-delegates-live", delegate],
    enabled: open && delegate !== "",
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => listDelegates(Date.now()),
  });
  // What the cache held when this opening began: only a read answered after it
  // counts (a previous opening's read can predate a payment made since).
  const [opening, setOpening] = React.useState({ open: false, baseline: 0 });
  if (opening.open !== open) setOpening({ open, baseline: read.dataUpdatedAt });
  const { refetch } = read;
  const refresh = React.useCallback(() => {
    void refetch({ cancelRefetch: false });
  }, [refetch]);
  const openedAt = opening.open ? opening.baseline : read.dataUpdatedAt;
  const state = liveDelegation({
    opened,
    delegate,
    list: read.data?.delegates,
    readAt: read.dataUpdatedAt,
    openedAt,
    // Only this opening's failure: an earlier one says nothing about now.
    failed: read.isError && read.errorUpdatedAt > openedAt,
  });
  return {
    ...state,
    readAt: read.dataUpdatedAt,
    refresh,
    tightenDelaySeconds: read.data?.tightenDelaySeconds,
  };
}

/** The atomic caps of a standing grant, as `strandReasons` compares them. */
function capsOf(grant: EscrowDelegate) {
  return {
    maxVoucherAmount: grant.maxVoucherAmount.amount,
    maxPerWindow: grant.maxPerWindow.amount,
    validUntil: String(Math.floor(Date.parse(grant.validUntil) / 1000)),
  };
}

/** While the sheet's own read of the grant is pending, or when the grant is gone (BUG-D1-08). */
function LiveReadNote({ ready, gone }: { ready: boolean; gone: boolean }) {
  if (gone) {
    return (
      <p className="text-body-13 text-warning-700" data-testid="delegate-gone">
        This key is no longer authorised on chain: it was revoked or replaced elsewhere. Close
        this and check the list.
      </p>
    );
  }
  if (!ready) {
    return (
      <p className="font-mono text-mono-13 text-03" data-testid="delegate-reading">
        Checking for payments still being settled…
      </p>
    );
  }
  return null;
}

/**
 * "Stop it paying": one signature removes the payment key's on-chain
 * permission, and it signs no payment from then on. The agent's API key is
 * untouched, so free calls keep working ("Revoke key" is the other action: it
 * ends the API key for every call). Payments it
 * signed that are still being settled become unredeemable the moment the
 * revocation lands — an accepted risk of the brake (risk register §14), so it
 * is never refused, but the sheet says so first and offers to wait (BUG-D1-07).
 * On an escrow with the tighten delay (D-21) they stay collectable for that
 * long instead, so the sheet says that and offers no wait.
 */
function RevokeSheet({
  target,
  agentName,
  escrow,
  unit,
  tightenDelaySeconds: listedDelay,
  onClose,
  onFinished,
  signer,
  domain,
}: {
  target: EscrowDelegate | null;
  /** Whose permission this is, for the title; unbound keys have none. */
  agentName?: string;
  escrow: BuyerEscrow | undefined;
  unit: string;
  /** From the page's list; the sheet's own read wins once it answers. */
  tightenDelaySeconds?: number;
  onClose: () => void;
  onFinished: () => void;
  signer: () => Signer;
  domain: (escrow: BuyerEscrow | undefined) => ExpectedDomain;
}) {
  const open = target !== null;
  const delegate = target?.delegate ?? "";
  const { live, ready, gone, readAt, refresh, tightenDelaySeconds: liveDelay } =
    useLiveDelegation(delegate, target, open);
  const delay = liveDelay ?? listedDelay;
  const delayNote = revokeDelayNote(delay);
  const unsettled = live?.unsettled;
  const reasons = live ? strandReasons(unsettled, capsOf(live), "revoke", delay) : [];
  const settle = useSettleWait(
    { count: gone ? 0 : unsettled?.count, strands: reasons.length > 0, readAt },
    refresh,
    UNSETTLED_POLL_MS,
  );
  const [busy, setBusy] = React.useState(false);
  const { reset } = settle;
  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const atRisk = reasons.length > 0;
  const [revokeNote, setRevokeNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) setRevokeNote(null);
  }, [open]);

  const revoke = async () => {
    if (!target) return;
    setBusy(true);
    setRevokeNote(null);
    try {
      const intent = await createRevokeDelegateIntent(addressOfAccount(target.delegate));
      await submitRelayedDelegation(
        intent,
        signer(),
        { domain: domain(escrow), delegate: target.delegate },
        submitRevokeDelegate,
      );
      toast.success(
        `${agentName ?? "That key"} can no longer pay. ${agentName ? "Its API key still works for free calls." : ""}`.trim(),
      );
      onFinished();
    } catch (error) {
      // Declining in the wallet is a decision, not a failure: the sheet stays as it was.
      setRevokeNote(explain(error, "Paying could not be stopped"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <SheetContent data-testid="revoke-delegate-sheet" showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{agentName ? `Stop ${agentName} paying?` : "Stop this key paying?"}</SheetTitle>
          <SheetDescription>
            One free signature from your wallet removes {agentName ? "this agent’s" : "this key’s"} permission
            to pay from your escrow, from its next payment on.{" "}
            {agentName
              ? "Its API key keeps working, so free calls still go through. You can let it pay again later."
              : "No gas is needed."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          <span className="break-all font-mono text-mono-xs text-01">
            {addressOfAccount(delegate)}
          </span>
          <p className="rounded-lg bg-02 px-3 py-2 text-body-13 text-02" data-testid="revoke-debt-note">
            Calls already made are still settled and paid for.
          </p>
          <LiveReadNote ready={ready} gone={gone} />
          {delayNote ? (
            <p className="text-body-13 text-02" data-testid="revoke-tighten-delay">
              {delayNote}
            </p>
          ) : null}
          <UnsettledPayments
            unsettled={unsettled}
            unit={unit}
            atRisk={atRisk}
            reasons={reasons}
            waiting={settle.waiting}
            settled={settle.settled}
            stalled={settle.stalled}
            onWait={settle.wait}
            onProceed={() => void revoke()}
            proceedLabel="Stop it paying now anyway"
            busy={busy || !ready}
          />
          <Button
            type="button"
            className="text-danger-600"
            variant="secondary"
            data-testid="sign-revoke-delegate"
            loading={busy}
            disabled={atRisk || !ready || gone}
            onClick={() => void revoke()}
          >
            Sign to stop paying (free)
          </Button>
          {revokeNote ? (
            <p role="status" className="text-body-13 text-warning-700" data-testid="revoke-note">
              {revokeNote}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Per agent: its credentials' bound keys, and "Authorize agent to pay" for those not yet authorised. */
export function AgentPaymentDelegation({
  agentAccount,
  credentials,
  version,
  onChanged,
}: {
  agentAccount: string | undefined;
  credentials: readonly DelegationCredential[];
  version: number;
  onChanged: () => void;
}) {
  const ctx = useDelegationContext(agentAccount, version);
  const [authorizing, setAuthorizing] = React.useState<SheetTarget | null>(null);
  if (!ctx.enabled) {
    // Solana serves free calls only (paid rails A and B are off): say so, offer nothing to sign.
    if (ctx.chainId && !servesPaidCalls(ctx.chainId)) {
      return (
        <div className="flex w-full flex-col gap-2.5 pt-2" data-testid="agent-payment-free-only">
          <MicroLabel>AGENT PAYMENTS</MicroLabel>
          <p className="text-body-13 text-02">
            {chainDisplayName(ctx.chains, ctx.chainId)} currently serves free calls only, so this
            agent makes free calls there and pays for none. Paid calls are not offered on it.
          </p>
        </div>
      );
    }
    return null;
  }

  const bound = credentials.filter((c) => !c.revokedAt && c.delegateAccount);
  const delegates = ctx.delegatesQuery.data?.delegates;

  return (
    <div
      className="flex w-full flex-col gap-2.5 pt-2"
      data-testid="agent-payment-delegation"
    >
      <MicroLabel>AGENT PAYMENTS</MicroLabel>
      {bound.length === 0 ? (
        <p className="text-body-13 text-02">
          No credential of this agent has a key bound yet. The agent generates
          its own key and proves it holds it with its credential (
          <span className="font-mono">agent-cli keygen</span>, then{" "}
          <span className="font-mono">agent-cli bind</span>); the key then
          appears here to authorise.
        </p>
      ) : (
        bound.map((credential) => {
          const delegation = findDelegation(
            delegates,
            credential.delegateAccount as string,
          );
          return (
            <div
              key={credential.id}
              data-testid="delegate-row"
              className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-3.5 tablet:flex-row tablet:items-center"
            >
              <Wallet aria-hidden="true" className="size-4 shrink-0 text-02" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="break-all font-mono text-mono-xs text-01">
                  {addressOfAccount(credential.delegateAccount)}
                </span>
                <span className="text-body-xs text-03">
                  {credential.name} · key …
                  {keyFingerprint(credential.delegateAccount)}
                  {credential.delegateBoundAt
                    ? ` · bound ${relativeTime(credential.delegateBoundAt)}`
                    : ""}{" "}
                  ·{" "}
                  {delegation
                    ? delegation.status === "EXPIRED"
                      ? "authorisation expired"
                      : "authorised to pay"
                    : ctx.delegatesQuery.isPending
                      ? "reading the chain…"
                      : "not authorised to pay"}
                </span>
              </div>
              {!delegation || delegation.status === "EXPIRED" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  data-testid="authorize-delegate"
                  disabled={!escrowCanDelegate(ctx.escrowQuery.data)}
                  onClick={() =>
                    setAuthorizing({
                      delegateAccount: credential.delegateAccount as string,
                      boundAt: credential.delegateBoundAt ?? null,
                    })
                  }
                >
                  Authorize agent to pay
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <StatusPill label="CAN PAY" tone="teal" />
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    data-testid="edit-agent-delegate"
                    disabled={!escrowCanDelegate(ctx.escrowQuery.data)}
                    onClick={() =>
                      setAuthorizing({
                        delegateAccount: credential.delegateAccount as string,
                        boundAt: credential.delegateBoundAt ?? null,
                        current: delegation,
                      })
                    }
                  >
                    Change spending limits
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
      {bound.length > 0 &&
      ctx.escrowQuery.data &&
      !escrowCanDelegate(ctx.escrowQuery.data) ? (
        <p className="text-body-xs text-03">
          Set your account ceiling first — an agent’s spending limits sit under it.
        </p>
      ) : null}

      <AuthorizeSheet
        target={authorizing}
        escrow={ctx.escrowQuery.data}
        escrowReceivedAt={ctx.escrowQuery.dataUpdatedAt}
        unit={ctx.unit}
        tightenDelaySeconds={ctx.delegatesQuery.data?.tightenDelaySeconds}
        onClose={() => setAuthorizing(null)}
        onFinished={() => {
          setAuthorizing(null);
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
    </div>
  );
}

/**
 * The Assay-checked half of an agent's spending limits (monthly, rate limits,
 * tools), carried by the same sheet so the person edits one set of numbers per
 * agent. Saved after the on-chain change, or on its own (no signature) when
 * only it changed.
 */
export interface SheetExtra {
  node: React.ReactNode;
  /** Something in it differs from what is saved. */
  dirty: boolean;
  /** Shows its errors; false stops the save before anything is signed. */
  validate: () => boolean;
  save: () => Promise<void>;
}

function AuthorizeSheet({
  target,
  agentName,
  extra,
  escrow,
  escrowReceivedAt,
  unit,
  tightenDelaySeconds: listedDelay,
  onClose,
  onFinished,
  signer,
  domain,
}: {
  target: SheetTarget | null;
  agentName?: string;
  extra?: SheetExtra;
  escrow: BuyerEscrow | undefined;
  /** When `escrow` (and its `serverTime`) arrived, in epoch ms. */
  escrowReceivedAt: number;
  unit: string;
  /** From the page's list; the sheet's own read wins once it answers. */
  tightenDelaySeconds?: number;
  onClose: () => void;
  onFinished: () => void;
  signer: () => Signer;
  domain: (escrow: BuyerEscrow | undefined) => ExpectedDomain;
}) {
  const [form, setForm] = React.useState<DelegationFormInput | null>(null);
  const [errors, setErrors] = React.useState<DelegationFormErrors>({});
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Re-rendered every second while open, so the expiry shown — and signed — is
  // "N days from now" on the server's clock, never from when the page loaded
  // (BUG-D1-05).
  const [, setTick] = React.useState(0);
  const open = target !== null;
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const current = target?.current ?? null;
  const editing = current !== null;
  const live = useLiveDelegation(target?.delegateAccount ?? "", current, open && editing);
  const grant = editing ? live.live : null;
  const delay = live.tightenDelaySeconds ?? listedDelay;
  const unsettled = grant?.unsettled;
  // A signed request the backend held back because payments were still being
  // settled (BUG-D1-07): submitted again — not signed again — once they have,
  // or with the acknowledgement. It carries its own deadline and nonce, so it is
  // dropped (and the sheet says so) once either has gone stale (review finding 8).
  const [held, setHeld] = React.useState<Record<string, unknown> | null>(null);
  const [heldNote, setHeldNote] = React.useState<string | null>(null);
  // The server's clock, carried forward from the escrow read by the time elapsed
  // since (BUG-D1-05; review S3-11: the chain checks `validUntil` against its own).
  const nowSeconds = serverNowSeconds(escrow?.serverTime, escrowReceivedAt, Date.now());
  // DEMO ONLY: the sheet works through to its result; nothing is signed or sent.
  const demo = demoEnabled();

  // Seeded when the sheet opens for a target — not on every escrow refetch, which
  // would wipe what the person typed.
  const seededFor = React.useRef<SheetTarget | null>(null);
  // What an edit form opened with: signing it unchanged would only re-grant the
  // standing caps with a later expiry, so the button waits for a change.
  const seededForm = React.useRef<DelegationFormInput | null>(null);
  React.useEffect(() => {
    // An escrow read that arrives after the sheet opened can seed a fresh form.
    if (target && !target.current && form === null && escrow) {
      setForm(defaultDelegationForm(escrow));
    }
  }, [target, escrow, form]);

  const delegate = target?.delegateAccount ?? "";
  const preview =
    form && escrow
      ? parseDelegationForm(
          form,
          escrow,
          addressOfAccount(delegate),
          nowSeconds,
          current ? validUntilSeconds(current.validUntil) : undefined,
        )
      : null;
  // Editing re-authorises the very key the grant already names, so there is no
  // key to confirm; a NEW grant still needs the last four characters (review S3-9).
  const keyConfirmed = editing || confirmsDelegateKey(confirm, delegate);
  const unchanged =
    editing &&
    editIsUnchanged(seededForm.current, form, { expired: current?.status === "EXPIRED" });
  const reasons =
    current && preview?.ok
      ? strandReasons(unsettled, capsOf(grant ?? current), preview.body, delay)
      : [];
  const loweredNote =
    current && preview?.ok
      ? loweredDelayNote(delay, capsOf(grant ?? current), preview.body)
      : null;
  const settle = useSettleWait(
    { count: live.gone ? 0 : unsettled?.count, strands: reasons.length > 0, readAt: live.readAt },
    live.refresh,
    UNSETTLED_POLL_MS,
  );
  const { reset: resetWait } = settle;
  React.useEffect(() => {
    if (seededFor.current === target) return;
    seededFor.current = target;
    const seeded =
      target === null
        ? null
        : target.current
          ? editDelegationForm(target.current, nowSeconds)
          : defaultDelegationForm(escrow ?? null);
    seededForm.current = target?.current ? seeded : null;
    setForm(seeded);
    setErrors({});
    setConfirm("");
    setHeld(null);
    setHeldNote(null);
    resetWait();
  }, [target, escrow, nowSeconds, resetWait]);
  const atRisk = reasons.length > 0 || settle.refused;
  // Signing waits for the sheet's own read of the grant (BUG-D1-08).
  const readyToSign = !editing || (live.ready && !live.gone);
  const heldStale = held ? heldIsStale(held, nowSeconds) : null;
  const heldUsable = held !== null && heldStale === null;

  const change = (
    field: "maxVoucherAmount" | "maxPerWindow" | "validDays" | "keepExpiry",
    value: string | boolean,
  ) => {
    if (!form) return;
    setForm({ ...form, [field]: value });
    // The days error is about whichever expiry is signed, so a toggle clears it too.
    setErrors((previous) =>
      errorsAfterEdit(previous, field === "keepExpiry" ? "validDays" : field),
    );
    // A request signed for other values is not what the form now says.
    setHeld(null);
    setHeldNote(null);
  };

  const finish = async (success: boolean) => {
    if (success && extra?.dirty) {
      try {
        await extra.save();
      } catch (error) {
        toast.error(
          `${explain(error, "The monthly and Advanced limits could not be saved")}. Your on-chain limits did change; open Change spending limits to save the rest again.`,
        );
      }
    }
    if (success) {
      toast.success(
        editing
          ? `${editedToast(
              current ? capsOf(grant ?? current) : null,
              preview?.ok ? preview.body : capsOf(grant ?? current!),
              delay,
            )}`
          : "Done. The agent can now pay within these limits.",
      );
    }
    onFinished();
  };

  /** A refusal for payments still being settled keeps the sheet open on its warning. */
  const failed = (error: unknown, resubmitted: boolean) => {
    if (isUnsettledRefusal(error)) {
      settle.markRefused();
      toast.error(explain(error, "Payments are still being settled"));
      return;
    }
    if (resubmitted && isRelayedRefusal(error)) {
      // The held signature was refused (expired, or its nonce was used up):
      // nothing changed, so stay open and sign again rather than close.
      setHeld(null);
      setHeldNote(`${explain(error, "The signed change was refused")} Sign it again to apply it.`);
      return;
    }
    // Declined or failed: keep the sheet and every value; say what happened inside it.
    setHeldNote(explain(error, editing ? "The limits could not be updated" : "The agent could not be authorised"));
  };

  /** The nonce a request built now would be signed at. */
  const nonceOf = (intent: DelegateIntent): string | null =>
    isTypedDataRequest(intent.transaction) ? String(intent.transaction.message.nonce) : null;

  const authorize = async (acknowledgeUnsettled = false) => {
    if (!form || !escrow || !preview) return;
    if (!preview.ok) {
      setErrors(preview.errors);
      return;
    }
    if (!keyConfirmed) return;
    if (extra && !extra.validate()) return;
    if (demo) {
      // DEMO ONLY: the same walk as a live signature, with nothing built,
      // signed or sent (no intent request, no wallet, no relay).
      setBusy(true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      setBusy(false);
      // Shown until reload, so the new limits can be seen on the card.
      rememberDemoDelegateCaps(delegate, {
        maxVoucherAmount: String(preview.body.maxVoucherAmount),
        maxPerWindow: String(preview.body.maxPerWindow),
        validUntil: new Date(Number(preview.body.validUntil) * 1000).toISOString(),
      });
      toast.success("Demo: nothing was signed. On a live site these limits would now apply.");
      onFinished();
      return;
    }
    // Exactly what the sheet shows this second, computed on the server's clock.
    const body = preview.body;
    const acknowledged = acknowledgeUnsettled ? { acknowledgeUnsettled: true } : {};
    const sign = (intent: DelegateIntent) =>
      submitRelayedDelegation(
        intent,
        signer(),
        { ...body, delegate, domain: domain(escrow) },
        (signed) => {
          setHeld(signed);
          return submitDelegate({ ...signed, ...acknowledged });
        },
      );
    setBusy(true);
    let resubmitted = false;
    try {
      if (held) {
        // Already signed. Hand the same request over again — unless it went
        // stale while it was held: then build and sign afresh, and say why.
        let stale: HeldStale | null = heldIsStale(held, nowSeconds);
        let fresh: DelegateIntent | null = null;
        if (stale === null) {
          fresh = await createDelegateIntent({ ...body, ...acknowledged });
          stale = heldIsStale(held, nowSeconds, nonceOf(fresh));
        }
        if (stale === null) {
          resubmitted = true;
          await submitDelegate({ ...held, ...acknowledged });
        } else {
          setHeld(null);
          setHeldNote(heldStaleText(stale));
          await sign(fresh ?? (await createDelegateIntent({ ...body, ...acknowledged })));
        }
      } else {
        await sign(await createDelegateIntent({ ...body, ...acknowledged }));
      }
      await finish(true);
    } catch (error) {
      failed(error, resubmitted);
    } finally {
      setBusy(false);
    }
  };

  /** Only the Assay-checked limits changed: saved without a signature. */
  const saveOnly = async () => {
    if (!extra || !extra.validate()) return;
    setBusy(true);
    try {
      await extra.save();
      toast.success("Saved. The new limits apply from the next call.");
      onFinished();
    } catch (error) {
      setHeldNote(explain(error, "The limits could not be saved"));
    } finally {
      setBusy(false);
    }
  };
  const extraOnly = Boolean(editing && unchanged && extra?.dirty);

  const decimals = escrow?.maxVoucherAmount?.decimals ?? 6;
  const asMoney = (atomic: string) => ({
    amount: atomic,
    asset: escrow?.maxVoucherAmount?.asset ?? "",
    decimals,
  });
  const isoSeconds = (seconds: number) => formatLocalDate(seconds * 1000);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <SheetContent data-testid="authorize-delegate-sheet" showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>
            {editing
              ? `Spending limits${agentName ? ` for ${agentName}` : ""}`
              : `Let ${agentName ?? "this agent"} pay`}
          </SheetTitle>
          <SheetDescription>
            {editing
              ? extra
                ? "One set of numbers for this agent. Per call and per 24 hours are enforced on chain: changing them takes one free signature from your wallet. The monthly limit and Advanced are checked by Assay and save without one. Your account ceiling keeps applying."
                : "One free signature from your wallet replaces this key’s limits and expiry. What it already spent in the last 24 hours still counts. Your account ceiling keeps applying."
              : "One free signature from your wallet lets this agent’s key pay from your escrow, within these limits, until the expiry. It cannot withdraw, change your limits or let anyone else pay. Your account ceiling keeps applying."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          {demo ? (
            <p className="rounded-lg bg-info-10 px-3 py-2 text-body-13 text-01" data-testid="demo-signing-note">
              {DEMO_SIGNING_NOTE}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-label-sm text-02">Payment key</span>
            <span
              className="break-all font-mono text-mono-xs text-01"
              data-testid="authorize-delegate-address"
            >
              {addressOfAccount(delegate)}
            </span>
            {target?.boundAt ? (
              <span className="text-body-xs text-03">bound {relativeTime(target.boundAt)}</span>
            ) : null}
            {current ? (
              <span className="text-body-xs text-03" data-testid="edit-delegate-current">
                Now: up to {exact(current.maxVoucherAmount, unit)} a call and{" "}
                {exact(current.maxPerWindow, unit)} per 24 hours, until{" "}
                {formatLocalDate(current.validUntil)}.
              </span>
            ) : null}
          </div>
          {form ? (
            <>
              <Field
                label="Most per call"
                id="delegate-max-voucher"
                suffix={unit}
                value={form.maxVoucherAmount}
                error={errors.maxVoucherAmount}
                inputMode="decimal"
                onChange={(e) => change("maxVoucherAmount", e.target.value)}
              />
              <Field
                label="Most per 24 hours"
                id="delegate-max-window"
                suffix={unit}
                value={form.maxPerWindow}
                error={errors.maxPerWindow}
                hint="Counts the last 24 hours, not the calendar day."
                inputMode="decimal"
                onChange={(e) => change("maxPerWindow", e.target.value)}
              />
              {current ? (
                // A cap edit keeps the grant's own expiry unless the person
                // picks a new one (BUG-J-POST-01).
                <div className="flex flex-col gap-1">
                  <Checkbox
                    data-testid="edit-delegate-keep-expiry"
                    checked={form.keepExpiry === true}
                    onChange={(e) => change("keepExpiry", e.target.checked)}
                    label={`Keep the current expiry (${formatLocalDate(current.validUntil)})`}
                  />
                  {form.keepExpiry && errors.validDays ? (
                    <span className="text-body-xs text-danger-500">{errors.validDays}</span>
                  ) : null}
                </div>
              ) : null}
              {current && form.keepExpiry ? null : (
                <Field
                  label={editing ? "Expires after (from now)" : "Expires after"}
                  id="delegate-valid-days"
                  suffix="days"
                  value={form.validDays}
                  error={errors.validDays}
                  inputMode="numeric"
                  onChange={(e) => change("validDays", e.target.value)}
                />
              )}
              {editing ? null : (
                <Field
                  label="Last 4 characters of the agent’s key"
                  id="delegate-confirm-key"
                  value={confirm}
                  hint="As `agent-cli address` prints it on the agent’s machine. This is what proves the key is yours."
                  error={
                    confirm.length >= 4 && !confirmsDelegateKey(confirm, delegate)
                      ? "That is not this key."
                      : undefined
                  }
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
              {editing ? <LiveReadNote ready={live.ready} gone={live.gone} /> : null}
              {loweredNote ? (
                <p className="text-body-13 text-02" data-testid="edit-tighten-delay">
                  {loweredNote}
                </p>
              ) : null}
              {editing ? (
                <UnsettledPayments
                  unsettled={unsettled}
                  unit={unit}
                  atRisk={atRisk}
                  reasons={reasons}
                  waiting={settle.waiting}
                  settled={settle.settled}
                  stalled={settle.stalled}
                  onWait={settle.wait}
                  onProceed={() => void authorize(true)}
                  proceedLabel={heldUsable ? "Submit anyway" : "Sign anyway"}
                  busy={busy || !readyToSign}
                />
              ) : null}
              {heldNote || heldStale ? (
                <p className="text-body-13 text-warning-700" data-testid="held-request-stale">
                  {heldNote ?? heldStaleText(heldStale as HeldStale)}
                </p>
              ) : null}
              {heldUsable && held ? (
                <p className="text-body-13 text-02" data-testid="authorize-delegate-summary">
                  Signed, waiting to be submitted: up to{" "}
                  {exact(asMoney(String(held.maxVoucherAmount)), unit)} a call and{" "}
                  {exact(asMoney(String(held.maxPerWindow)), unit)} per 24 hours, until{" "}
                  {isoSeconds(Number(held.validUntil))}.
                </p>
              ) : preview?.ok && !unchanged ? (
                <p className="text-body-13 text-02" data-testid="authorize-delegate-summary">
                  You will sign: up to {exact(asMoney(preview.body.maxVoucherAmount), unit)} a
                  call and {exact(asMoney(preview.body.maxPerWindow), unit)} per 24 hours, until{" "}
                  {isoSeconds(Number(preview.body.validUntil))}.
                </p>
              ) : null}
              {extra ? extra.node : null}
              {unchanged && !extra?.dirty ? (
                <p className="text-body-xs text-03" data-testid="edit-delegate-unchanged">
                  Change a limit or the expiry to save.
                </p>
              ) : null}
              <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
                <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                  Cancel
                </Button>
                {extraOnly ? (
                  <Button type="button" data-testid="save-spending-limits" loading={busy} onClick={() => void saveOnly()}>
                    Save
                  </Button>
                ) : (
                  <Button
                    type="button"
                    data-testid="sign-authorize-delegate"
                    loading={busy}
                    disabled={!keyConfirmed || unchanged || atRisk || !readyToSign}
                    onClick={() => void authorize()}
                  >
                    {heldUsable
                      ? "Submit the signed change"
                      : editing
                        ? "Sign and save (free)"
                        : "Sign to allow (free)"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-body-13 text-02">
              Set your account ceiling first — an agent’s spending limits sit under it.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "Change spending limits" and "Stop it paying" for one agent's on-chain
 * permission, as two buttons with their sheets — for the per-agent cards on
 * Agents & keys and Spending limits. With `budget`, the limits sheet also
 * carries the agent's Assay-checked limits (monthly, Advanced), so the person
 * edits one set of numbers per agent.
 */
export function GrantActions({
  account,
  delegation,
  boundAt,
  onChanged,
  agentName,
  budget,
  budgetNote,
  showStop = true,
}: {
  account: string | undefined;
  delegation: EscrowDelegate;
  boundAt?: string | null;
  onChanged: () => void;
  agentName?: string;
  /** The Assay-checked half; leave out when it cannot be edited for this agent. */
  budget?: { policy: SpendPolicy | null; bootstrap: BudgetBootstrap | null };
  /** Shown in the limits sheet when `budget` is left out: why the monthly part is not here. */
  budgetNote?: React.ReactNode;
  showStop?: boolean;
}) {
  const ctx = useDelegationContext(account, 0);
  const [editing, setEditing] = React.useState<SheetTarget | null>(null);
  const [revoking, setRevoking] = React.useState<EscrowDelegate | null>(null);
  const draft = useBudgetDraft({
    policy: budget?.policy ?? null,
    bootstrap: budget?.bootstrap ?? null,
    open: editing !== null,
    mode: "chain",
  });
  if (!ctx.enabled) return null;
  const extra: SheetExtra | undefined = budget
    ? { node: <BudgetFields draft={draft} unit={ctx.unit || draft.unit} />, dirty: draft.dirty, validate: draft.validate, save: draft.save }
    : budgetNote
      ? { node: budgetNote, dirty: false, validate: () => true, save: async () => undefined }
      : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        type="button"
        data-testid="edit-agent-delegate"
        disabled={!escrowCanDelegate(ctx.escrowQuery.data)}
        onClick={() => setEditing({ delegateAccount: delegation.delegate, boundAt, current: delegation })}
      >
        Change spending limits
      </Button>
      {showStop ? (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="text-danger-600"
          data-testid="revoke-agent-delegate"
          onClick={() => setRevoking(delegation)}
        >
          Stop it paying
        </Button>
      ) : null}
      <AuthorizeSheet
        target={editing}
        agentName={agentName}
        extra={extra}
        escrow={ctx.escrowQuery.data}
        escrowReceivedAt={ctx.escrowQuery.dataUpdatedAt}
        unit={ctx.unit}
        tightenDelaySeconds={ctx.delegatesQuery.data?.tightenDelaySeconds}
        onClose={() => setEditing(null)}
        onFinished={() => {
          setEditing(null);
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
      <RevokeSheet
        target={revoking}
        agentName={agentName}
        escrow={ctx.escrowQuery.data}
        unit={ctx.unit}
        tightenDelaySeconds={ctx.delegatesQuery.data?.tightenDelaySeconds}
        onClose={() => setRevoking(null)}
        onFinished={() => {
          setRevoking(null);
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
    </div>
  );
}
