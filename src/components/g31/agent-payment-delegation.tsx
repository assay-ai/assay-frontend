"use client";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert, Wallet } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
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
} from "@/features/delegation/delegation-form";
import {
  type ExpectedDomain,
  submitRelayedDelegation,
} from "@/features/delegation/relayed-delegation";
import { isRelayedRefusal, relayedRefusal } from "@/features/escrow/relayed-refusal";
import { useChains } from "@/hooks/useChains";
import { isUserRejection, type Signer, useSigner } from "@/hooks/useSigner";
import type { BuyerEscrow, EscrowDelegate } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { settlementSymbol } from "@/services/chains.service";
import {
  createDelegateIntent,
  createRevokeDelegateIntent,
  listDelegates,
  submitDelegate,
  submitRevokeDelegate,
} from "@/services/delegation.service";
import { getEscrow } from "@/services/escrow.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

import { MicroLabel, StatusPill } from "./chrome";
import { dateOnly, relativeTime } from "./format";

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
      Your escrow now allows only {parts.join(" and ")}. Its limits keep applying, so this
      agent’s payments above them are refused. Edit the agent’s limits, or raise the
      escrow’s.
    </span>
  );
}

/** Full precision: a cap of 0.005 must not read as 0.01 (review S3-11). */
function exact(
  money: EscrowDelegate["maxVoucherAmount"],
  unit: string,
): string {
  return `${formatMoney(money, { decimals: money.decimals, symbol: "" })} ${unit}`.trim();
}

/** "Who can pay from your escrow" — every on-chain grant of the payer, each revocable. */
export function PayerDelegationsPanel({
  account,
  bindings,
  version,
  onChanged,
}: {
  account: string | undefined;
  bindings: readonly DelegateBinding[];
  version: number;
  onChanged: () => void;
}) {
  const ctx = useDelegationContext(account, version);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<SheetTarget | null>(null);
  if (!ctx.enabled) return null;

  const rows = delegationRows(ctx.delegatesQuery.data?.delegates, bindings);

  const revoke = async (delegate: EscrowDelegate) => {
    setRevoking(delegate.delegate);
    try {
      const intent = await createRevokeDelegateIntent(
        addressOfAccount(delegate.delegate),
      );
      await submitRelayedDelegation(
        intent,
        ctx.signer(),
        {
          domain: ctx.domain(ctx.escrowQuery.data),
          delegate: delegate.delegate,
        },
        submitRevokeDelegate,
      );
      toast.success("Revoked. That key can no longer sign payments.");
    } catch (error) {
      toast.error(explain(error, "The authorisation could not be revoked"));
    } finally {
      setRevoking(null);
      // Refetch whatever happened: a relay that landed and then failed to read back
      // is still a change on chain (review S3-12).
      onChanged();
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 p-3.5 tablet:p-[15px]"
      data-testid="payer-delegations"
    >
      <MicroLabel>KEYS THAT CAN PAY FROM YOUR ESCROW</MicroLabel>
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
          No agent key is authorised to pay from your escrow.
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
                      {b.revokedAt ? " · credential revoked" : ""}
                    </span>
                  ))
                : null}
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
                  Not bound to any live credential — it can still pay until you
                  revoke it.
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusPill
                label={
                  delegation.status === "EXPIRED" ? "EXPIRED" : "AUTHORISED"
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
                Edit limits
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                className="text-danger-600"
                data-testid="revoke-delegate"
                loading={revoking === delegation.delegate}
                onClick={() => void revoke(delegation)}
              >
                Revoke
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
        onClose={() => setEditing(null)}
        onFinished={() => {
          setEditing(null);
          onChanged();
        }}
        signer={ctx.signer}
        domain={ctx.domain}
      />
    </div>
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
  if (!ctx.enabled) return null;

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
                  <StatusPill label="AUTHORISED" tone="teal" />
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
                    Edit limits
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
          Set your escrow limits first — an agent’s caps can only narrow them.
        </p>
      ) : null}

      <AuthorizeSheet
        target={authorizing}
        escrow={ctx.escrowQuery.data}
        escrowReceivedAt={ctx.escrowQuery.dataUpdatedAt}
        unit={ctx.unit}
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

function AuthorizeSheet({
  target,
  escrow,
  escrowReceivedAt,
  unit,
  onClose,
  onFinished,
  signer,
  domain,
}: {
  target: SheetTarget | null;
  escrow: BuyerEscrow | undefined;
  /** When `escrow` (and its `serverTime`) arrived, in epoch ms. */
  escrowReceivedAt: number;
  unit: string;
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
  // The server's clock, carried forward from the escrow read by the time elapsed
  // since (BUG-D1-05; review S3-11: the chain checks `validUntil` against its own).
  const nowSeconds = serverNowSeconds(escrow?.serverTime, escrowReceivedAt, Date.now());

  // Seeded when the sheet opens for a target — not on every escrow refetch, which
  // would wipe what the person typed.
  const seededFor = React.useRef<SheetTarget | null>(null);
  React.useEffect(() => {
    if (seededFor.current === target) return;
    seededFor.current = target;
    setForm(
      target === null
        ? null
        : target.current
          ? editDelegationForm(target.current, nowSeconds)
          : defaultDelegationForm(escrow ?? null),
    );
    setErrors({});
    setConfirm("");
  }, [target, escrow, nowSeconds]);
  React.useEffect(() => {
    // An escrow read that arrives after the sheet opened can seed a fresh form.
    if (target && !target.current && form === null && escrow) {
      setForm(defaultDelegationForm(escrow));
    }
  }, [target, escrow, form]);

  const delegate = target?.delegateAccount ?? "";
  const preview =
    form && escrow
      ? parseDelegationForm(form, escrow, addressOfAccount(delegate), nowSeconds)
      : null;
  // Editing re-authorises the very key the grant already names, so there is no
  // key to confirm; a NEW grant still needs the last four characters (review S3-9).
  const keyConfirmed = editing || confirmsDelegateKey(confirm, delegate);

  const change = (field: keyof DelegationFormInput, value: string) => {
    if (!form) return;
    setForm({ ...form, [field]: value });
    setErrors((previous) => errorsAfterEdit(previous, field));
  };

  const authorize = async () => {
    if (!form || !escrow || !preview) return;
    if (!preview.ok) {
      setErrors(preview.errors);
      return;
    }
    if (!keyConfirmed) return;
    // Exactly what the sheet shows this second, computed on the server's clock.
    const body = preview.body;
    setBusy(true);
    try {
      const intent = await createDelegateIntent(body);
      await submitRelayedDelegation(
        intent,
        signer(),
        { ...body, delegate, domain: domain(escrow) },
        submitDelegate,
      );
      toast.success(
        editing
          ? "Updated. The new caps apply from the agent’s next payment."
          : "Authorised. The agent can now pay within these caps.",
      );
    } catch (error) {
      toast.error(
        explain(error, editing ? "The limits could not be updated" : "The agent could not be authorised"),
      );
    } finally {
      setBusy(false);
      onFinished();
    }
  };

  const decimals = escrow?.maxVoucherAmount?.decimals ?? 6;
  const asMoney = (atomic: string) => ({
    amount: atomic,
    asset: escrow?.maxVoucherAmount?.asset ?? "",
    decimals,
  });
  const isoSeconds = (seconds: number) =>
    new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent data-testid="authorize-delegate-sheet">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit agent limits" : "Authorize agent to pay"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "One signature from your wallet replaces this key’s caps and expiry. What it has already spent this window still counts. No gas is needed."
              : "One signature from your wallet lets this agent’s key sign payments from your escrow, within these caps, until the expiry. It cannot withdraw, change your limits or authorise anyone. Your escrow limits keep applying. No gas is needed."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          <div className="flex flex-col gap-1">
            <span className="text-label-sm text-02">Agent key</span>
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
                Now: up to {exact(current.maxVoucherAmount, unit)} a payment and{" "}
                {exact(current.maxPerWindow, unit)} per 24 hours, until{" "}
                {current.validUntil.replace(".000Z", "Z")}.
              </span>
            ) : null}
          </div>
          {form ? (
            <>
              <Field
                label="Most per payment"
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
                inputMode="decimal"
                onChange={(e) => change("maxPerWindow", e.target.value)}
              />
              <Field
                label={editing ? "Expires after (from now)" : "Expires after"}
                id="delegate-valid-days"
                suffix="days"
                value={form.validDays}
                error={errors.validDays}
                inputMode="numeric"
                onChange={(e) => change("validDays", e.target.value)}
              />
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
              {preview?.ok ? (
                <p className="text-body-13 text-02" data-testid="authorize-delegate-summary">
                  You will sign: up to {exact(asMoney(preview.body.maxVoucherAmount), unit)} a
                  payment and {exact(asMoney(preview.body.maxPerWindow), unit)} per 24 hours, until{" "}
                  {isoSeconds(Number(preview.body.validUntil))}.
                </p>
              ) : null}
              <Button
                type="button"
                data-testid="sign-authorize-delegate"
                loading={busy}
                disabled={!keyConfirmed}
                onClick={() => void authorize()}
              >
                {editing ? "Sign and update" : "Sign and authorise"}
              </Button>
            </>
          ) : (
            <p className="text-body-13 text-02">
              Set your escrow limits first — an agent’s caps can only narrow them.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
