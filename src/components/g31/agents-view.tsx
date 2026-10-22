"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, TriangleAlert } from "lucide-react";
import * as React from "react";

import { AgentHealthLine, ReadinessChip } from "@/components/buyer-money/agent-health";
import { CreateKeySheet, invalidateAfterKeyWrite, payingKeyName } from "@/components/buyer-money/create-key";
import { PaidByInvitation } from "@/components/buyer-money/get-started";
import { LetAgentPaySheet } from "@/components/buyer-money/let-agent-pay-sheet";
import { EffectiveLimitLines, type LimitsContext, rowsFor, SpendingLimitsActions, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { type AgentRow, type KeyRow } from "@/components/buyer-money/use-agents";
import { ApiErrorSentence } from "@/components/patterns/api-error-sentence";
import { limitLines } from "@/features/buyer-money/spending-limits";
import { CapMeter } from "@/components/patterns/cap-meter";
import { CopyChip } from "@/components/patterns/copy-chip";
import { Skeleton } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { AGENT_LABEL_MAX, agentLabelError } from "@/features/buyer-money/agent-label";
import { type AgentReadiness, credentialIsLive } from "@/features/buyer-money/agent-readiness";
import { capsToForm } from "@/features/buyer-money/caps";
import { keyExpiry, keyMayPay, type KeyExpiryView, scopesText } from "@/features/buyer-money/key-scopes";
import { credentialLabel } from "@/features/buyer-money/mcp-config";
import { permissionExpiry } from "@/features/buyer-money/permission-expiry";
import { type DelegateBinding, findDelegation, supportsDelegation } from "@/features/delegation/delegation-form";
import { dollars, fingerprint } from "@/features/delegation/enable-paid";
import { displayClientName } from "@/features/oauth/consent";
import { ME_STATUS_KEY } from "@/features/me-status/use-me-status";
import type { EscrowDelegate } from "@/interfaces";
import { formatDate } from "@/libs/utc-time";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { shortAddress } from "@/libs/chains/format";
import { firstDepositOpensEscrow } from "@/libs/chains/registry";
import { renameAgent, revokeCredential } from "@/services/account.service";
import { cn } from "@/utils";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { AgentAccessCard } from "@/components/toolsets/agent-access-card";
import { ServersInUse } from "@/components/toolsets/servers-in-use";
import { UpdateFromAlert } from "@/components/toolsets/update-sheet";

import { DiscardPendingKey } from "./discard-pending-key";
import { explainStopFailure, PayerDelegationsPanel, StopPaymentKeySheet, useStopPaymentKey } from "./agent-payment-delegation";
import { relativeTime } from "./format";
import {
  MAY_BE_ACTIVE_TEXT,
  RevokeCredentialDialog,
  type RevokeKeyState,
  revokedToast,
  STILL_ACTIVE_TEXT,
} from "./revoke-credential-dialog";

/**
 * Controls › Agents & keys: one card per agent, answering "is it working?"
 * and "how do I stop it?" without leaving the card.
 *
 *   1. Keys — one row per credential, OAuth grants and API keys together
 *      (spec §9.2, R-UI-7): where it was signed in from, when it was last
 *      used, its payment key (fingerprint, on-chain state, caps, expiry), and
 *      Edit access, Payment limits, Revoke. Revoke can also stop the payment
 *      key on chain with one signature (F3). A revoked or expired row whose
 *      key is still active on chain keeps "Stop it" in view (IM-11).
 *   2. Servers in use — the MCP URLs it was handed or called through, and
 *      Connect (the Connect sheet).
 *   3. Payment key — made by `npx -y @goassay-ai/mcp@<V> enable-paid`, detected automatically.
 *      Without one, paid calls are by invitation during testnet (D14).
 *   4. Spending limits — the effective limit and what binds it, what it spent
 *      in the last 24 hours, and Change spending limits / Stop it paying.
 *   5. What this agent can use — its access and provider limits. The fix
 *      links of refused calls open it: `/agents?agent={id}#access`.
 *
 * The agent's name is renamed in place (`PATCH /agents/:id`); Connect,
 * Overview and Explore read the same label. A skeleton stands in for the
 * card while its keys load: it never says "No key" from a loading state.
 *
 * Whether a payment key is active is read from the chain (`GET
 * /escrow/delegates`), never from the credential: a revoked credential's key
 * stays authorised until it is stopped on chain.
 */
const POLL_MS = 5_000;

/** A credential's payment key as the chain shows it. */
export type PaymentKeyOnChain =
  | { kind: "no-key" }
  /** The chain list is not read yet, or could not be read: unknown, never "none". */
  | { kind: "checking" }
  | { kind: "unreadable" }
  | { kind: "off" }
  /** The agent's account is not an EVM account: paid calls are on EVM only, so nothing is to be read. */
  | { kind: "not-evm" }
  | { kind: "expired"; delegation: EscrowDelegate }
  | { kind: "active"; delegation: EscrowDelegate };

export interface CredentialRowView {
  /** Not revoked and not expired. */
  live: boolean;
  /** "Signed in from Assay app (assay-mcp)", "Signed in from {app} ({domain}) · free tools only", "API key {prefix}…". */
  source: string;
  /** The payment-key line, or null when the source line already says "free tools only". */
  paymentLine: string | null;
  /** An API key, or a grant of a client that may hold a payment key. Every other app is free-only (H2). */
  paymentClient: boolean;
  chain: PaymentKeyOnChain;
  activeOnChain: boolean;
  /** A revoked or expired row whose key is active on chain and held by no live row: offer Stop it. */
  stopIt: EscrowDelegate | null;
  /**
   * The key as Revoke treats it: "active" (on chain), "unknown" (the chain
   * read is pending or failed: it may still be active), or "none" (no key,
   * the chain proves it cannot pay, or another live row holds the same key).
   */
  keyState: RevokeKeyState;
  /** A revoked or expired row whose key may still be active (chain unknown): kept in view, never folded away. */
  mayBeActive: boolean;
  /** What the key may do, in plain words ("Calls tools · pays · reads activity"). */
  scopes: string;
  /** When it ends ("Expires Jan 20, 2027"), or null when it has no end date. */
  expiry: KeyExpiryView | null;
  /** A new payment key waiting for the person's approval, or null. */
  pending: { text: string; note: string } | null;
}

export interface CredentialRowContext {
  /** `GET /escrow/delegates`; undefined while it loads or when it failed. */
  delegates: readonly EscrowDelegate[] | undefined;
  delegatesUnreadable: boolean;
  /** False when the agent's account is not an EVM account (paid calls are on EVM only); the default is true. */
  evmAccount?: boolean;
  /** Every credential of the agent, to see whether a live one holds the same key. */
  keys: readonly KeyRow[];
  nowMs: number;
}

export const NO_PAYMENT_KEY = "Payment key: none — free tools only";
const FREE_ONLY = " · free tools only";

const isLive = credentialIsLive;

/**
 * The chain list's state is unknown: its read failed, or never runs (no eip155
 * account). A read still pending is `checking`, also unknown.
 */
function delegatesUnknown(query: { isError: boolean; isPending: boolean; fetchStatus: string }): boolean {
  return query.isError || (query.isPending && query.fetchStatus === "idle");
}

function paymentKeyOnChain(key: KeyRow, ctx: CredentialRowContext): PaymentKeyOnChain {
  if (!key.delegateAccount) return { kind: "no-key" };
  if (ctx.evmAccount === false) return { kind: "not-evm" };
  if (ctx.delegates === undefined) return ctx.delegatesUnreadable ? { kind: "unreadable" } : { kind: "checking" };
  const delegation = findDelegation(ctx.delegates, key.delegateAccount);
  if (!delegation) return { kind: "off" };
  return delegation.status === "ACTIVE" ? { kind: "active", delegation } : { kind: "expired", delegation };
}

function sameKey(a: string, b: string): boolean {
  return addressOfAccount(a).toLowerCase() === addressOfAccount(b).toLowerCase();
}

/** One row of Agents & keys, as text (spec §9.2). */
export function credentialRowView(key: KeyRow, ctx: CredentialRowContext): CredentialRowView {
  const live = isLive(key, ctx.nowMs);
  const chain = paymentKeyOnChain(key, ctx);
  const activeOnChain = chain.kind === "active";
  // "Free tools only" only when no key of this row can pay: none bound, or the
  // chain says it is not (or no longer) authorised. Unknown is never "free".
  const provenFree = chain.kind === "no-key" || chain.kind === "off" || chain.kind === "not-evm" || chain.kind === "expired";
  const client = key.issuedVia === "OAUTH" ? key.oauthClient ?? null : null;
  // A key without the payments scope can never pay, whatever its client (the API refuses it).
  const paymentClient = (key.issuedVia === "API_KEY" || client?.paymentClient === true) && keyMayPay(key.scopes);

  let source: string;
  if (key.issuedVia === "API_KEY") {
    source = `API key ${credentialLabel(key)}`;
  } else if (client?.paymentClient) {
    source = "Signed in from Assay app (assay-mcp)";
  } else {
    const domain = client?.registrableDomain ?? null;
    const name = displayClientName(client?.name ?? "", { registrableDomain: domain });
    source = `Signed in from ${name}${domain && domain !== name ? ` (${domain})` : ""}${provenFree ? FREE_ONLY : ""}`;
  }

  let paymentLine: string | null = null;
  if (chain.kind === "no-key") {
    paymentLine = paymentClient ? NO_PAYMENT_KEY : null;
  } else {
    const fp = `Payment key ${fingerprint(key.delegateAccount!)}`;
    switch (chain.kind) {
      case "active":
        paymentLine =
          `${fp} · on · ${dollars(toDecimal(chain.delegation.maxVoucherAmount))} a call · ` +
          `${dollars(toDecimal(chain.delegation.maxPerWindow))} per 24 h · until ${formatDate(chain.delegation.validUntil, { now: ctx.nowMs })}`;
        break;
      case "expired":
        paymentLine = `${fp} · expired ${formatDate(chain.delegation.validUntil, { now: ctx.nowMs })} — free tools only`;
        break;
      case "off":
        // The chain list cannot tell a key that was stopped from one never turned on; a revoked row can only have been stopped or never on.
        paymentLine = live ? `${fp} · not turned on, or stopped — free tools only` : `${fp} · stopped — free tools only`;
        break;
      case "not-evm":
        paymentLine = `${fp} · paid calls are on EVM chains only — free tools only`;
        break;
      case "checking":
      case "unreadable":
        // Unknown is never "stopped" and never "free" (IM-11).
        paymentLine = MAY_BE_ACTIVE_TEXT;
        break;
    }
  }

  const heldByLive =
    key.delegateAccount !== null &&
    key.delegateAccount !== undefined &&
    ctx.keys.some((other) => other.id !== key.id && other.delegateAccount && isLive(other, ctx.nowMs) && sameKey(other.delegateAccount, key.delegateAccount!));
  const stopIt = !live && chain.kind === "active" && !heldByLive ? chain.delegation : null;
  const unknown = chain.kind === "checking" || chain.kind === "unreadable";
  const keyState: RevokeKeyState = heldByLive ? "none" : activeOnChain ? "active" : unknown ? "unknown" : "none";
  const mayBeActive = !live && unknown && !heldByLive;

  const pending = key.pendingDelegateAccount
    ? {
        text:
          `New payment key ${fingerprint(key.pendingDelegateAccount)} is waiting for your approval` +
          (key.pendingDelegateRequestedAt ? ` · asked ${formatDate(key.pendingDelegateRequestedAt, { now: ctx.nowMs })}` : ""),
        note: key.delegateAccount
          ? `It replaces ${fingerprint(key.delegateAccount)}, which keeps paying until you approve. To approve, open the link your app showed.`
          : "To approve, open the link your app showed.",
      }
    : null;

  return {
    live,
    source,
    paymentLine,
    paymentClient,
    chain,
    activeOnChain,
    stopIt,
    keyState,
    mayBeActive,
    scopes: scopesText(key.scopes),
    expiry: keyExpiry(key.expiresAt, ctx.nowMs),
    pending,
  };
}

/**
 * Whether `?agent=` names this agent: its id, a unique-looking id prefix (at
 * least 6 characters, as people copy the short id), or its label. No
 * `?agent=` names the first agent.
 */
export function agentMatches(asked: string | null, agent: AgentRow, index: number): boolean {
  if (!asked) return index === 0;
  const a = asked.trim().toLowerCase();
  const id = agent.agentId.toLowerCase();
  return id === a || (a.length >= 6 && id.startsWith(a)) || (agent.label ?? "").toLowerCase() === a;
}

export function AgentsView() {
  const queryClient = useQueryClient();
  const [needsPoll, setNeedsPoll] = React.useState(false);
  const data = useLimitsContext({ pollMs: needsPoll ? POLL_MS : false });
  const anyWaiting = Object.values(data.readiness).some((r) => r.next === "bind");
  React.useEffect(() => setNeedsPoll(anyWaiting), [anyWaiting]);

  // `/agents?agent={id}#access`: the link a refused call's fix opens. Read after
  // mount (a static export has no request to read it from at build time).
  const [focus, setFocus] = React.useState<{ agentId: string | null; access: boolean }>({ agentId: null, access: false });
  React.useEffect(() => {
    const read = () =>
      setFocus({ agentId: new URLSearchParams(window.location.search).get("agent"), access: window.location.hash === "#access" });
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const [newKeyFor, setNewKeyFor] = React.useState<AgentRow | null>(null);
  type RevokeTarget = { agent: AgentRow; key: KeyRow };
  const [revoking, setRevoking] = React.useState<RevokeTarget | null>(null);
  // The last target, so the sheet's title does not go blank while it animates out.
  const [lastRevoke, setLastRevoke] = React.useState<RevokeTarget | null>(null);
  if (revoking && revoking !== lastRevoke) setLastRevoke(revoking);
  // `account` is the payer that signs: the account of the agent that owns the key (BUG-M3-01).
  type StopTarget = { account: string | undefined; delegateAccount: string; delegation: EscrowDelegate | null };
  const [stopping, setStopping] = React.useState<StopTarget | null>(null);
  // The last target, so the sheet keeps its payer while it animates out.
  const [lastStopping, setLastStopping] = React.useState<StopTarget | null>(null);
  if (stopping && stopping !== lastStopping) setLastStopping(stopping);
  const [payFor, setPayFor] = React.useState<{
    agent: AgentRow;
    delegate: string;
    renew?: { perCall: string; perDay: string } | null;
    purpose?: "renew" | "limits";
  } | null>(null);

  const refresh = () => {
    data.refetchKeys();
    data.refetchDelegates();
    void queryClient.invalidateQueries({ queryKey: ["escrow"] });
    // The debts ride on `GET /me/status` now; they refreshed with the escrow before.
    void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["escrow-delegates"] });
  };

  const editAccess = (agent: AgentRow) => {
    setFocus({ agentId: agent.agentId, access: true });
    try {
      window.history.replaceState(window.history.state, "", `?agent=${encodeURIComponent(agent.agentId)}#access`);
    } catch {
      /* the link is a convenience; the section is highlighted anyway */
    }
    // Scroll again on a second click: the section is already highlighted then.
    window.requestAnimationFrame(() => document.getElementById("access")?.scrollIntoView({ block: "start" }));
  };

  // The Revoke dialog's key state, from the current chain read: it updates while the dialog is open.
  const [revokeNow] = React.useState(() => Date.now());
  const revokeKeys = lastRevoke ? (data.keys[lastRevoke.agent.agentId] ?? []) : [];
  const revokeView = lastRevoke
    ? credentialRowView(revokeKeys.find((k) => k.id === lastRevoke.key.id) ?? lastRevoke.key, {
        delegates: data.delegates,
        delegatesUnreadable: delegatesUnknown(data.delegatesQuery),
        evmAccount: supportsDelegation(lastRevoke.agent.agentAccount),
        keys: revokeKeys,
        nowMs: revokeNow,
      })
    : null;
  // Once revoked the row is no longer live; the dialog keeps the state it was confirmed with.
  const revokeKeyState: RevokeKeyState = revokeView?.keyState ?? "none";

  const payerAccount = data.agents.find((a) => supportsDelegation(a.agentAccount))?.agentAccount;
  // The key is stopped by the wallet of the agent that owns the credential, never another agent's (BUG-M3-01).
  const revokeAccount = lastRevoke?.agent.agentAccount;
  const stopPaymentKey = useStopPaymentKey(revokeAccount);
  const bindings: DelegateBinding[] = data.agents.flatMap((agent) =>
    (data.keys[agent.agentId] ?? [])
      .filter((k) => k.delegateAccount)
      .map((k) => ({
        agentId: agent.agentId,
        agentLabel: agent.label ?? "Agent",
        credentialId: k.id,
        credentialName: k.name,
        delegateAccount: k.delegateAccount as string,
        delegateBoundAt: k.delegateBoundAt ?? null,
        revokedAt: k.revokedAt,
      })),
  );

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Agents & keys</h1>
        <p className="text-body-13 text-02">Each agent&apos;s keys, whether it can pay, and how to stop it.</p>
      </header>
      <UpdateFromAlert />

      {data.agentsQuery.isPending ? (
        <PageState kind="loading" rows={3} label="Loading your agents" />
      ) : data.agentsQuery.isError ? (
        <PageState
          kind="error"
          title="Your agents could not be loaded"
          description={data.agentsQuery.error instanceof ApiError ? <ApiErrorSentence error={data.agentsQuery.error} /> : undefined}
          code={data.agentsQuery.error instanceof ApiError ? data.agentsQuery.error.code : null}
          onRetry={() => void data.agentsQuery.refetch()}
        />
      ) : data.agents.length === 0 ? (
        <PageState
          kind="empty"
          icon={<KeyRound />}
          title="No agent yet"
          description="Your first agent is set up when you sign in for the first time. Reload in a moment."
        />
      ) : (
        data.agents.map((agent, i) => (
          <AgentCard
            key={agent.agentId}
            focusAccess={focus.access && agentMatches(focus.agentId, agent, i)}
            ctx={data}
            agent={agent}
            keys={data.keys[agent.agentId]}
            keysPending={data.keysQuery.isPending}
            keysFailed={data.keysQuery.isError}
            keysHidden={data.keysHiddenFor.has(agent.agentId)}
            onRetryKeys={data.refetchKeys}
            readiness={data.readiness[agent.agentId]!}
            escrowReady={
              Boolean(data.escrowQuery.data?.exists) || !firstDepositOpensEscrow(chainIdOfAccount(agent.agentAccount))
            }
            onNewKey={() => setNewKeyFor(agent)}
            onRevokeKey={(key) => setRevoking({ agent, key })}
            onStopIt={(target) => setStopping({ ...target, account: agent.agentAccount })}
            onRetryChain={data.refetchDelegates}
            onEditAccess={() => editAccess(agent)}
            onLetPay={(delegate, renew, purpose) => setPayFor({ agent, delegate, renew, purpose })}
            onChanged={refresh}
          />
        ))
      )}

      {payerAccount ? (
        <PayerDelegationsPanel account={payerAccount} bindings={bindings} onChanged={refresh} onlyUnbound />
      ) : null}

      <CreateKeySheet
        agentId={newKeyFor?.agentId ?? null}
        agentName={newKeyFor?.label}
        keyCount={newKeyFor ? (data.keys[newKeyFor.agentId] ?? []).length : 0}
        payingKey={newKeyFor ? payingKeyName(data.readiness[newKeyFor.agentId]) : null}
        open={newKeyFor !== null}
        onOpenChange={(open) => !open && setNewKeyFor(null)}
      />

      <RevokeCredentialDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        name={lastRevoke?.key.name ?? ""}
        issuedVia={lastRevoke?.key.issuedVia ?? "API_KEY"}
        keyState={revokeKeyState}
        tightenDelaySeconds={data.delegatesQuery.data?.tightenDelaySeconds}
        onRevoke={() => revokeCredential(lastRevoke!.agent.agentId, lastRevoke!.key.id)}
        onStopOnChain={() => stopPaymentKey(lastRevoke!.key.delegateAccount!)}
        describeRevokeError={(error) => (error instanceof ApiError ? plainApiError(error) : "It could not be revoked. Nothing changed; try again.")}
        describeStopError={explainStopFailure}
        onDone={(outcome, keyState) => {
          refresh();
          invalidateAfterKeyWrite(queryClient);
          if (outcome.chain === "failed") return;
          const text = revokedToast(keyState, outcome.chain);
          if (outcome.chain === "handoff") {
            const delegateAccount = lastRevoke!.key.delegateAccount!;
            setRevoking(null);
            setStopping({ account: revokeAccount, delegateAccount, delegation: findDelegation(data.delegates, delegateAccount) });
            toast.info(text);
          } else if (keyState === "none" || outcome.chain === "stopped") {
            toast.success(text);
          } else {
            toast.warning(text);
          }
        }}
      />

      <StopPaymentKeySheet
        account={lastStopping?.account}
        target={stopping}
        onClose={() => setStopping(null)}
        onFinished={() => {
          setStopping(null);
          refresh();
        }}
      />

      <LetAgentPaySheet
        open={payFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPayFor(null);
            refresh();
          }
        }}
        agentName={payFor?.agent.label ?? "your agent"}
        delegateAccount={payFor?.delegate ?? null}
        renew={payFor?.renew ?? null}
        purpose={payFor?.purpose}
      />
    </div>
  );
}

function SubRow({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full gap-3 border-t border-01 pt-3.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-03 font-mono text-mono-xs text-02">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-label-13 text-01">{title}</span>
        {children}
      </div>
    </div>
  );
}

/**
 * One live credential (spec §9.2):
 *
 *   Assay app on this Mac                              Last used 3m ago
 *   Signed in from Assay app (assay-mcp)
 *   Payment key 1A2B 9F3C · on · $0.50 a call · $5 per 24 h · until Nov 18
 *   [Edit access] [Payment limits] [Revoke]
 *
 * Payment limits only for a row that may hold a payment key (an API key or
 * the built-in app): every other app is free-only (H2).
 */
function CredentialRowItem({
  credential,
  view,
  canChangeLimits,
  onEditAccess,
  onPaymentLimits,
  onRevoke,
  onChanged,
}: {
  credential: KeyRow;
  view: CredentialRowView;
  /** The agent's chain has paid calls and the escrow exists. */
  canChangeLimits: boolean;
  onEditAccess: () => void;
  onPaymentLimits: () => void;
  onRevoke: () => void;
  /** The list is read again (after a key waiting for approval is discarded). */
  onChanged: () => void;
}) {
  // Only a key the buyer already authorised on chain (active or expired) is changed here. A new
  // key goes through the enable-paid page, which checks it against the one on the agent's
  // computer (`#key`); this sheet cannot.
  const onChainBefore = view.chain.kind === "active" || view.chain.kind === "expired";
  return (
    <li data-testid="credential-row" className="flex w-full flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3">
      <div className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4 shrink-0 text-02" />
          <span className="truncate text-label-13 text-01">{credential.name}</span>
        </span>
        <span className="text-body-xs text-03">
          {credential.lastUsedAt ? `Last used ${relativeTime(credential.lastUsedAt)}` : "Never used"}
        </span>
      </div>
      <span className={cn("text-body-xs text-02", credential.prefix ? "font-mono" : undefined)} data-testid="credential-source">
        {view.source}
      </span>
      <span className="text-body-xs text-02" data-testid="credential-scopes">
        {view.scopes}
        {view.expiry ? (
          <>
            {" · "}
            <span className={view.expiry.soon ? "text-warning-700" : undefined} data-testid="credential-expiry">
              {view.expiry.text}
              {view.expiry.soon ? ": create a new key soon" : ""}
            </span>
          </>
        ) : null}
      </span>
      {view.paymentLine ? (
        <span className="text-body-xs text-02" data-testid="credential-payment-key">
          {view.paymentLine}
        </span>
      ) : null}
      {view.pending ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-warning-10 px-2.5 py-1.5" data-testid="credential-pending-key">
          <span className="text-body-xs text-warning-700">{view.pending.text}</span>
          <span className="text-body-xs text-02">{view.pending.note}</span>
          <DiscardPendingKey agentId={credential.agentId} credentialId={credential.id} onDiscarded={onChanged} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant="secondary" type="button" data-testid="edit-access" onClick={onEditAccess}>
          Edit access
        </Button>
        {view.paymentClient ? (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            data-testid="payment-limits"
            disabled={!credential.delegateAccount || !canChangeLimits || !onChainBefore}
            title={
              !credential.delegateAccount
                ? "This app has no payment key yet."
                : !onChainBefore
                  ? "Turn on paid calls from the agent's app first: it opens a page that checks the key on your computer."
                  : undefined
            }
            onClick={onPaymentLimits}
          >
            Payment limits
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" type="button" className="text-danger-600" data-testid="revoke-credential" onClick={onRevoke}>
          Revoke
        </Button>
      </div>
    </li>
  );
}

interface PaymentScope {
  key: string;
  /** "Key “{name}” · 1A2B 9F3C" when the agent has several bound keys; else null. */
  label: string | null;
  /** The agent's readiness with this key as its bound key and grant. */
  readiness: AgentReadiness;
  /** The limits context with that readiness, so the effective limit reads this key's caps. */
  ctx: LimitsContext;
}

/** The payment sections' subjects: the agent as a whole with one bound key or none, else each bound key. */
export function paymentScopes(ctx: LimitsContext, agent: AgentRow, readiness: AgentReadiness): PaymentScope[] {
  const bound = readiness.boundCredentials ?? [];
  if (bound.length <= 1) return [{ key: "agent", label: null, readiness, ctx }];
  return bound.map(({ credential, grant }) => {
    const scoped: AgentReadiness = { ...readiness, boundCredential: credential, grant };
    return {
      key: credential.id,
      label: `Key “${credential.name}” · ${fingerprint(credential.delegateAccount!)}`,
      readiness: scoped,
      ctx: { ...ctx, readiness: { ...ctx.readiness, [agent.agentId]: scoped } },
    };
  });
}

function ScopeLabel({ label }: { label: string | null }) {
  return label ? <span className="text-label-13 text-01" data-testid="payment-scope">{label}</span> : null;
}

/** Section 3 for one bound key. */
function PaymentKeyBlock({ label, readiness }: { label: string | null; readiness: AgentReadiness }) {
  const bound = readiness.boundCredential as KeyRow | null;
  const chainId = chainIdOfAccount(bound?.delegateAccount);
  if (!bound?.delegateAccount || !chainId) return null;
  return (
    <div className="flex flex-col gap-0.5" data-testid="payment-key-block">
      <ScopeLabel label={label} />
      <p className="text-body-13 text-02">
        <span className="font-mono text-01">{shortAddress(chainId, addressOfAccount(bound.delegateAccount))}</span>
        {bound.delegateBoundAt ? <> · set up {relativeTime(bound.delegateBoundAt)}</> : null} · on key “{bound.name}”
      </p>
    </div>
  );
}

/** Section 4 for one bound key (or the agent, with one key or none). */
function SpendingBlock({
  label,
  ctx,
  agent,
  readiness,
  escrowReady,
  now,
  onLetPay,
  onChanged,
}: {
  label: string | null;
  ctx: LimitsContext;
  agent: AgentRow;
  readiness: AgentReadiness;
  escrowReady: boolean;
  now: number;
  onLetPay: (delegate: string, renew?: { perCall: string; perDay: string } | null, purpose?: "renew" | "limits") => void;
  onChanged: () => void;
}) {
  const bound = readiness.boundCredential as KeyRow | null;
  const grant = readiness.grant;
  const expiry = readiness.freeOnly ? null : permissionExpiry(grant, now);
  const subject = label ? "this key" : "this agent";
  if (grant && grant.status === "ACTIVE") {
    return (
      <div className="flex flex-col gap-2" data-testid="spending-block">
        <ScopeLabel label={label} />
        <EffectiveLimitLines lines={limitLines(rowsFor(ctx, agent))} />
        <CapMeter label={`Spent by ${subject} in the last 24 hours`} used={grant.spentInWindow} limit={grant.maxPerWindow} />
        {expiry ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="permission-expiry">
            <StatusChip status="expires-soon" detail={expiry.label} />
            <span className="text-body-13 text-02">After that, paid calls are refused until you renew it.</span>
            <Button
              size="sm"
              type="button"
              disabled={!bound?.delegateAccount || !escrowReady}
              onClick={() => bound?.delegateAccount && onLetPay(bound.delegateAccount, capsToForm(grant) ?? null)}
            >
              Renew
            </Button>
          </div>
        ) : null}
        <p className="text-body-xs text-03">
          Allowed to pay until <UtcTime value={grant.validUntil} dateOnly />. Stop it paying removes that permission; its API key
          keeps working for free calls.
        </p>
        <SpendingLimitsActions ctx={ctx} agent={agent} readiness={readiness} onChanged={onChanged} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="spending-block">
      <ScopeLabel label={label} />
      <p className="text-body-13 text-02">
        {label
          ? grant?.status === "EXPIRED"
            ? "This key's permission to pay expired, so it cannot pay. Free calls still work."
            : "This key is not allowed to pay. Free calls still work."
          : grant?.status === "EXPIRED"
            ? "Its permission to pay expired, so paid calls are refused. Free calls still work."
            : "Not allowed to pay yet. Free calls still work."}
      </p>
      <Button
        size="sm"
        type="button"
        className="self-start"
        disabled={!bound?.delegateAccount || !escrowReady}
        onClick={() => bound?.delegateAccount && onLetPay(bound.delegateAccount)}
      >
        {grant?.status === "EXPIRED" ? "Let it pay again" : "Let it pay"}
      </Button>
      {!bound?.delegateAccount ? (
        <p className="text-body-xs text-03">Needs the payment key above first.</p>
      ) : !escrowReady ? (
        <p className="text-body-xs text-03">Add funds first: your first deposit opens your escrow.</p>
      ) : null}
    </div>
  );
}

function AgentCard({
  focusAccess,
  ctx,
  agent,
  keys,
  keysPending,
  keysFailed,
  keysHidden = false,
  onRetryKeys,
  readiness,
  escrowReady,
  onNewKey,
  onRevokeKey,
  onStopIt,
  onRetryChain,
  onEditAccess,
  onLetPay,
  onChanged,
}: {
  focusAccess: boolean;
  ctx: LimitsContext;
  agent: AgentRow;
  keys: KeyRow[] | undefined;
  keysPending: boolean;
  /** The keys could not be read: say so, never "no key". */
  keysFailed: boolean;
  /** The keys are not shown to this session (agent-kind, BUG-DEMO-02): say so, no retry. */
  keysHidden?: boolean;
  onRetryKeys: () => void;
  readiness: AgentReadiness;
  escrowReady: boolean;
  onNewKey: () => void;
  onRevokeKey: (key: KeyRow) => void;
  onStopIt: (target: { delegateAccount: string; delegation: EscrowDelegate | null }) => void;
  /** Read the chain list again (a failed read). */
  onRetryChain: () => void;
  onEditAccess: () => void;
  onLetPay: (delegate: string, renew?: { perCall: string; perDay: string } | null, purpose?: "renew" | "limits") => void;
  onChanged: () => void;
}) {
  const [showRevoked, setShowRevoked] = React.useState(false);
  const name = agent.label ?? "Agent";
  const [now] = React.useState(() => Date.now());
  const rowContext: CredentialRowContext = {
    delegates: ctx.delegates,
    // A read that failed, or that never runs (no eip155 account): unknown, never "none".
    delegatesUnreadable: delegatesUnknown(ctx.delegatesQuery),
    evmAccount: supportsDelegation(agent.agentAccount),
    keys: keys ?? [],
    nowMs: now,
  };
  const rows = (keys ?? []).map((key) => ({ key, view: credentialRowView(key, rowContext) }));
  const liveRows = rows.filter((row) => row.view.live);
  // A revoked or expired row whose key can still pay stays in view with Stop it (IM-11).
  // So does one whose key may still be active while the chain is unread.
  const stranded = rows.filter((row) => !row.view.live && (row.view.stopIt || row.view.mayBeActive));
  const ended = rows.filter((row) => !row.view.live && !row.view.stopIt && !row.view.mayBeActive);
  const live = readiness.liveCredentials as KeyRow[];
  // On a free-calls-only chain no paying step applies: no payment key, spend
  // meter or renewal is shown (the readiness line says why).
  const delegation = supportsDelegation(agent.agentAccount) && !readiness.freeOnly;
  // One block per bound key when there are several (one per machine,
  // R-MU-11): each with its own fingerprint, caps, spend and Stop it paying.
  const scopes = paymentScopes(ctx, agent, readiness);

  if (keysPending || readiness.loading) {
    return (
      <section
        aria-label={name}
        aria-busy="true"
        data-testid="agent-card-loading"
        className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5"
      >
        <header className="flex w-full flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-label-md text-01">{name}</h2>
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </header>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <span className="sr-only">Loading this agent&apos;s keys</span>
      </section>
    );
  }

  return (
    <section
      aria-label={name}
      data-testid="agent-card"
      className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5"
    >
      <header className="flex w-full flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <AgentName agent={agent} />
          <AgentHealthLine readiness={readiness} />
        </div>
        <ReadinessChip readiness={readiness} />
      </header>

      <SubRow n={1} title="Keys">
        {keysHidden ? (
          <p className="text-body-13 text-02" data-testid="keys-hidden">
            {plainError("AGENT_KEYS_HIDDEN")} This does not change what it can call.
          </p>
        ) : keysFailed ? (
          <div className="flex flex-wrap items-center gap-2" role="alert" data-testid="keys-unreadable">
            <p className="text-body-13 text-02">We could not read this agent&apos;s keys. This does not change what it can call.</p>
            <Button size="sm" variant="secondary" type="button" onClick={onRetryKeys}>
              Retry
            </Button>
          </div>
        ) : liveRows.length === 0 ? (
          <p className="text-body-13 text-02">No live key. Create one to connect this agent.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {liveRows.map(({ key, view }) => (
              <CredentialRowItem
                key={key.id}
                credential={key}
                view={view}
                canChangeLimits={delegation && escrowReady}
                onEditAccess={onEditAccess}
                onPaymentLimits={() => {
                  if (!key.delegateAccount) return;
                  if (view.chain.kind !== "active") {
                    onLetPay(key.delegateAccount, null);
                    return;
                  }
                  // Renew wording only near the end of the permission; otherwise it is about its limits (BUG-M3-03).
                  const purpose = permissionExpiry(view.chain.delegation, now) ? "renew" : "limits";
                  onLetPay(key.delegateAccount, capsToForm(view.chain.delegation), purpose);
                }}
                onRevoke={() => onRevokeKey(key)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
        {!keysFailed && stranded.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {stranded.map(({ key, view }) => (
              <li
                key={key.id}
                data-testid="stranded-credential-row"
                className="flex w-full flex-col gap-1 rounded-lg border border-warning-20 bg-02 p-3"
              >
                <span className="truncate text-label-13 text-01">{key.name}</span>
                <span className="text-body-xs text-03">
                  {view.source} · {key.revokedAt ? `revoked ${relativeTime(key.revokedAt)}` : `signed out ${relativeTime(key.expiresAt)}`}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-body-13 text-warning-700" data-testid="stranded-key-state">
                    <TriangleAlert aria-hidden="true" className="size-3.5" />
                    {view.stopIt ? STILL_ACTIVE_TEXT : MAY_BE_ACTIVE_TEXT} · {fingerprint(key.delegateAccount!)}
                  </span>
                  {view.stopIt ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      className="text-danger-600"
                      data-testid="stop-payment-key"
                      onClick={() => onStopIt({ delegateAccount: key.delegateAccount!, delegation: view.stopIt })}
                    >
                      Stop it
                    </Button>
                  ) : view.chain.kind === "unreadable" ? (
                    <Button size="sm" variant="secondary" type="button" data-testid="check-chain-again" onClick={onRetryChain}>
                      Check again
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={liveRows.length === 0 ? "primary" : "secondary"} icon={<Plus />} type="button" data-testid="new-credential" onClick={onNewKey}>
            {/* R-UI-8: an agent that only signs in through an app gets the API key as the alternative. */}
            {liveRows.some((row) => row.key.issuedVia === "API_KEY") ? "New key" : "Use an API key instead"}
          </Button>
          {ended.length > 0 ? (
            <button type="button" className="text-label-13 text-02 hover:underline" onClick={() => setShowRevoked((v) => !v)} aria-expanded={showRevoked}>
              {showRevoked ? "Hide" : "Show"} {ended.length} revoked or signed out
            </button>
          ) : null}
        </div>
        {showRevoked ? (
          <ul className="flex flex-col gap-1">
            {ended.map(({ key, view }) => (
              <li key={key.id} className="text-body-xs text-03">
                {key.name} · {view.source} · {key.revokedAt ? `revoked ${relativeTime(key.revokedAt)}` : `signed out ${relativeTime(key.expiresAt)}`}
              </li>
            ))}
          </ul>
        ) : null}
      </SubRow>

      <SubRow n={2} title="Servers in use">
        {/* The latest call by any of its keys, revoked ones included (the keys' health). */}
        <ServersInUse agentId={agent.agentId} agentName={name} lastCallAt={ctx.health[agent.agentId]?.lastUsedAtAnyKey ?? null} />
      </SubRow>

      {delegation && !keysFailed ? (
        <SubRow n={3} title={scopes.length > 1 ? "Payment keys" : "Payment key"}>
          {scopes.map((scope) => (
            <PaymentKeyBlock key={scope.key} label={scope.label} readiness={scope.readiness} />
          ))}
          {scopes.length === 1 && !scopes[0]!.readiness.boundCredential ? (
            live.length === 0 ? <p className="text-body-13 text-03">Create a key first.</p> : <PaidByInvitation agentName={name} />
          ) : null}
        </SubRow>
      ) : null}

      {delegation ? (
        <SubRow n={4} title="Spending limits">
          {scopes.map((scope) => (
            <SpendingBlock
              key={scope.key}
              label={scope.label}
              ctx={scope.ctx}
              agent={agent}
              readiness={scope.readiness}
              escrowReady={escrowReady}
              now={now}
              onLetPay={onLetPay}
              onChanged={onChanged}
            />
          ))}
        </SubRow>
      ) : null}

      <SubRow n={delegation ? 5 : 3} title="What this agent can use">
        <AgentAccessCard agentId={agent.agentId} agentName={name} highlight={focusAccess} />
      </SubRow>

      <details className="text-body-xs text-03">
        <summary className="cursor-pointer select-none text-label-xs">Details</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          Agent id <code className="break-all font-mono text-mono-xs text-01">{agent.agentId}</code> <CopyChip value={agent.agentId} display="Copy" label="agent id" />
          {agent.agentAccount ? (
            <>
              · pays from <CopyChip value={addressOfAccount(agent.agentAccount)} />
            </>
          ) : null}
        </div>
      </details>
    </section>
  );
}

/**
 * The agent's name, renamed in place. The label is display text only; the
 * server checks it the same way (`agentLabelError`) and records
 * `agent.renamed`.
 */
function AgentName({ agent }: { agent: AgentRow }) {
  const queryClient = useQueryClient();
  const name = agent.label ?? "Agent";
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const [touched, setTouched] = React.useState(false);
  const rename = useMutation({
    mutationFn: (label: string) => renameAgent(agent.agentId, label),
    onSuccess: (_row, label) => {
      setEditing(false);
      // Patched in place, not refetched: the browser may answer a refetch of
      // `/agents` from its 10-second cache with the old name. Connect,
      // Overview and Explore all read this one query.
      queryClient.setQueriesData({ queryKey: ["agents"] }, (old: unknown) => withLabel(old, agent.agentId, label));
      toast.success(`Renamed to “${label}”`);
    },
  });
  const problem = agentLabelError(draft);
  const save = () => {
    setTouched(true);
    if (problem) return;
    const label = draft.trim();
    if (label === name) {
      setEditing(false);
      return;
    }
    rename.mutate(label);
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="min-w-0 break-words text-label-md text-01">{name}</h2>
        <button
          type="button"
          data-testid="rename-agent"
          className="inline-flex min-h-10 items-center gap-1 text-label-13 text-primary-600 hover:underline tablet:min-h-0"
          onClick={() => {
            setDraft(name);
            setTouched(false);
            rename.reset();
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
          Rename
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex w-full max-w-[420px] flex-col gap-2"
      data-testid="rename-agent-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field
        id={`agent-name-${agent.agentId}`}
        label="Agent name"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        hint={`Shown in Connect, Overview and Explore. Up to ${AGENT_LABEL_MAX} characters.`}
        error={
          touched && problem
            ? problem
            : rename.isError
              ? rename.error instanceof ApiError
                ? plainApiError(rename.error)
                : "The name could not be saved. Try again."
              : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={rename.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={rename.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** An agents page with one agent's label replaced; anything else is returned as it was. */
export function withLabel(page: unknown, agentId: string, label: string): unknown {
  if (!page || typeof page !== "object" || !Array.isArray((page as { items?: unknown }).items)) return page;
  const items = (page as { items: { agentId?: string }[] }).items;
  return { ...page, items: items.map((item) => (item.agentId === agentId ? { ...item, label } : item)) };
}
