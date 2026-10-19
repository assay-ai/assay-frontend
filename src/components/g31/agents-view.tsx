"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, TriangleAlert } from "lucide-react";
import * as React from "react";

import { AgentHealthLine, ReadinessChip } from "@/components/buyer-money/agent-health";
import { CreateKeySheet, payingKeyName } from "@/components/buyer-money/create-key";
import { PaidByInvitation } from "@/components/buyer-money/get-started";
import { LetAgentPaySheet } from "@/components/buyer-money/let-agent-pay-sheet";
import { EffectiveLimitLines, type LimitsContext, rowsFor, SpendingLimitsActions, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { type AgentRow, type KeyRow } from "@/components/buyer-money/use-agents";
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
import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";
import { capsToForm } from "@/features/buyer-money/caps";
import { credentialLabel } from "@/features/buyer-money/mcp-config";
import { permissionExpiry } from "@/features/buyer-money/permission-expiry";
import { type DelegateBinding, findDelegation, supportsDelegation } from "@/features/delegation/delegation-form";
import { dollars, fingerprint } from "@/features/delegation/enable-paid";
import { displayClientName } from "@/features/oauth/consent";
import type { EscrowDelegate } from "@/interfaces";
import { formatDate } from "@/libs/utc-time";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { shortAddress } from "@/libs/chains/format";
import { renameAgent, revokeCredential } from "@/services/account.service";
import { cn } from "@/utils";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { AgentAccessCard } from "@/components/toolsets/agent-access-card";
import { ServersInUse } from "@/components/toolsets/servers-in-use";
import { UpdateFromAlert } from "@/components/toolsets/update-sheet";

import { explainStopFailure, PayerDelegationsPanel, StopPaymentKeySheet, useStopPaymentKey } from "./agent-payment-delegation";
import { relativeTime } from "./format";
import { RevokeCredentialDialog, STILL_ACTIVE_TEXT } from "./revoke-credential-dialog";

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
 *   3. Payment key — made by `assay-mcp enable-paid`, detected automatically.
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
  /** Revoke offers "Also stop its payment key on chain": active on chain, and no other live row holds the same key. */
  offerStopOnRevoke: boolean;
}

export interface CredentialRowContext {
  /** `GET /escrow/delegates`; undefined while it loads or when it failed. */
  delegates: readonly EscrowDelegate[] | undefined;
  delegatesUnreadable: boolean;
  /** Every credential of the agent, to see whether a live one holds the same key. */
  keys: readonly KeyRow[];
  nowMs: number;
}

export const NO_PAYMENT_KEY = "Payment key: none — free tools only";
const FREE_ONLY = " · free tools only";

function isLive(key: KeyRow, nowMs: number): boolean {
  return !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > nowMs);
}

function paymentKeyOnChain(key: KeyRow, ctx: CredentialRowContext): PaymentKeyOnChain {
  if (!key.delegateAccount) return { kind: "no-key" };
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
  const provenFree = chain.kind === "no-key" || chain.kind === "off" || chain.kind === "expired";
  const client = key.issuedVia === "OAUTH" ? key.oauthClient ?? null : null;
  const paymentClient = key.issuedVia === "API_KEY" || client?.paymentClient === true;

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
        paymentLine = `${fp} · not turned on — free tools only`;
        break;
      case "checking":
        paymentLine = `${fp} · checking the chain…`;
        break;
      case "unreadable":
        paymentLine = `${fp} · could not be read from the chain`;
        break;
    }
  }

  const heldByLive =
    key.delegateAccount !== null &&
    key.delegateAccount !== undefined &&
    ctx.keys.some((other) => other.id !== key.id && other.delegateAccount && isLive(other, ctx.nowMs) && sameKey(other.delegateAccount, key.delegateAccount!));
  const stopIt = !live && chain.kind === "active" && !heldByLive ? chain.delegation : null;
  const offerStopOnRevoke = activeOnChain && !heldByLive;

  return { live, source, paymentLine, paymentClient, chain, activeOnChain, stopIt, offerStopOnRevoke };
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
  type RevokeTarget = { agent: AgentRow; key: KeyRow; activeOnChain: boolean };
  const [revoking, setRevoking] = React.useState<RevokeTarget | null>(null);
  // The last target, so the sheet's title does not go blank while it animates out.
  const [lastRevoke, setLastRevoke] = React.useState<RevokeTarget | null>(null);
  if (revoking && revoking !== lastRevoke) setLastRevoke(revoking);
  const [stopping, setStopping] = React.useState<EscrowDelegate | null>(null);
  const [payFor, setPayFor] = React.useState<{
    agent: AgentRow;
    delegate: string;
    renew?: { perCall: string; perDay: string } | null;
  } | null>(null);

  const refresh = () => {
    data.refetchKeys();
    data.refetchDelegates();
    void queryClient.invalidateQueries({ queryKey: ["escrow"] });
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

  const payerAccount = data.agents.find((a) => supportsDelegation(a.agentAccount))?.agentAccount;
  const stopPaymentKey = useStopPaymentKey(payerAccount);
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
          description={data.agentsQuery.error instanceof ApiError ? plainError(data.agentsQuery.error.code) : undefined}
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
            onRetryKeys={data.refetchKeys}
            readiness={data.readiness[agent.agentId]!}
            escrowReady={Boolean(data.escrowQuery.data?.exists)}
            onNewKey={() => setNewKeyFor(agent)}
            onRevokeKey={(key, activeOnChain) => setRevoking({ agent, key, activeOnChain })}
            onStopIt={setStopping}
            onEditAccess={() => editAccess(agent)}
            onLetPay={(delegate, renew) => setPayFor({ agent, delegate, renew })}
            onChanged={refresh}
          />
        ))
      )}

      {payerAccount ? (
        <PayerDelegationsPanel account={payerAccount} bindings={bindings} version={0} onChanged={refresh} onlyUnbound />
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
        keyActiveOnChain={Boolean(lastRevoke?.activeOnChain && lastRevoke.key.delegateAccount)}
        tightenDelaySeconds={data.delegatesQuery.data?.tightenDelaySeconds}
        onRevoke={() => revokeCredential(lastRevoke!.agent.agentId, lastRevoke!.key.id)}
        onStopOnChain={() => stopPaymentKey(lastRevoke!.key.delegateAccount!)}
        describeRevokeError={(error) => (error instanceof ApiError ? plainError(error.code) : "It could not be revoked. Nothing changed; try again.")}
        describeStopError={explainStopFailure}
        onDone={(outcome) => {
          refresh();
          void queryClient.invalidateQueries({ queryKey: ["credentials"] });
          if (outcome.chain === "stopped") toast.success("Revoked, and its payment key was stopped on chain.");
          else if (outcome.chain === "untouched") toast.success("Revoked. It stopped working at once.");
        }}
      />

      <StopPaymentKeySheet
        account={payerAccount}
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
}: {
  credential: KeyRow;
  view: CredentialRowView;
  /** The agent's chain has paid calls and the escrow exists. */
  canChangeLimits: boolean;
  onEditAccess: () => void;
  onPaymentLimits: () => void;
  onRevoke: () => void;
}) {
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
      {view.paymentLine ? (
        <span className="text-body-xs text-02" data-testid="credential-payment-key">
          {view.paymentLine}
        </span>
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
            disabled={!credential.delegateAccount || !canChangeLimits}
            title={!credential.delegateAccount ? "This app has no payment key yet." : undefined}
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

/** The latest call by any of an agent's keys, revoked ones included. */
function latestUse(keys: readonly KeyRow[] | undefined): string | null {
  const used = (keys ?? []).map((key) => key.lastUsedAt).filter((at): at is string => Boolean(at));
  return used.length === 0 ? null : used.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

function AgentCard({
  focusAccess,
  ctx,
  agent,
  keys,
  keysPending,
  keysFailed,
  onRetryKeys,
  readiness,
  escrowReady,
  onNewKey,
  onRevokeKey,
  onStopIt,
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
  onRetryKeys: () => void;
  readiness: AgentReadiness;
  escrowReady: boolean;
  onNewKey: () => void;
  onRevokeKey: (key: KeyRow, activeOnChain: boolean) => void;
  onStopIt: (delegation: EscrowDelegate) => void;
  onEditAccess: () => void;
  onLetPay: (delegate: string, renew?: { perCall: string; perDay: string } | null) => void;
  onChanged: () => void;
}) {
  const [showRevoked, setShowRevoked] = React.useState(false);
  const name = agent.label ?? "Agent";
  const [now] = React.useState(() => Date.now());
  const rowContext: CredentialRowContext = {
    delegates: ctx.delegates,
    // A read that failed, or that never runs (no eip155 account): unknown, never "none".
    delegatesUnreadable: ctx.delegatesQuery.isError || (ctx.delegatesQuery.isPending && ctx.delegatesQuery.fetchStatus === "idle"),
    keys: keys ?? [],
    nowMs: now,
  };
  const rows = (keys ?? []).map((key) => ({ key, view: credentialRowView(key, rowContext) }));
  const liveRows = rows.filter((row) => row.view.live);
  // A revoked or expired row whose key can still pay stays in view with Stop it (IM-11).
  const stranded = rows.filter((row) => !row.view.live && row.view.stopIt);
  const ended = rows.filter((row) => !row.view.live && !row.view.stopIt);
  const live = readiness.liveCredentials as KeyRow[];
  const bound = readiness.boundCredential as KeyRow | null;
  const grant = readiness.grant;
  // On a free-calls-only chain no paying step applies: no payment key, spend
  // meter or renewal is shown (the readiness line says why).
  const delegation = supportsDelegation(agent.agentAccount) && !readiness.freeOnly;
  const chainId = chainIdOfAccount(bound?.delegateAccount);
  const expiry = readiness.freeOnly ? null : permissionExpiry(grant, now);

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
        {keysFailed ? (
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
                  onLetPay(key.delegateAccount, view.chain.kind === "active" ? capsToForm(view.chain.delegation) : null);
                }}
                onRevoke={() => onRevokeKey(key, view.offerStopOnRevoke)}
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
                  <span className="flex items-center gap-1 text-body-13 text-warning-700">
                    <TriangleAlert aria-hidden="true" className="size-3.5" />
                    {STILL_ACTIVE_TEXT} · {fingerprint(key.delegateAccount!)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    className="text-danger-600"
                    data-testid="stop-payment-key"
                    onClick={() => onStopIt(view.stopIt!)}
                  >
                    Stop it
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={liveRows.length === 0 ? "primary" : "secondary"} icon={<Plus />} type="button" data-testid="new-credential" onClick={onNewKey}>
            New key
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
        <ServersInUse agentId={agent.agentId} agentName={name} lastCallAt={latestUse(keys)} />
      </SubRow>

      {delegation && !keysFailed ? (
        <SubRow n={3} title="Payment key">
          {bound?.delegateAccount && chainId ? (
            <p className="text-body-13 text-02">
              <span className="font-mono text-01">{shortAddress(chainId, addressOfAccount(bound.delegateAccount))}</span>
              {bound.delegateBoundAt ? <> · set up {relativeTime(bound.delegateBoundAt)}</> : null} · on key “{bound.name}”
            </p>
          ) : live.length === 0 ? (
            <p className="text-body-13 text-03">Create a key first.</p>
          ) : (
            <PaidByInvitation agentName={name} />
          )}
        </SubRow>
      ) : null}

      {delegation ? (
        <SubRow n={4} title="Spending limits">
          {grant && grant.status === "ACTIVE" ? (
            <>
              <EffectiveLimitLines lines={limitLines(rowsFor(ctx, agent))} />
              <CapMeter label="Spent by this agent in the last 24 hours" used={grant.spentInWindow} limit={grant.maxPerWindow} />
              {expiry ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="permission-expiry">
                  <StatusChip status="expires-soon" detail={expiry.label} />
                  <span className="text-body-13 text-02">After that, paid calls are refused until you renew it.</span>
                  <Button
                    size="sm"
                    type="button"
                    disabled={!bound?.delegateAccount || !escrowReady}
                    onClick={() =>
                      bound?.delegateAccount &&
                      onLetPay(bound.delegateAccount, capsToForm(grant) ?? null)
                    }
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
            </>
          ) : (
            <>
              <p className="text-body-13 text-02">
                {grant?.status === "EXPIRED"
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
            </>
          )}
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
                ? plainError(rename.error.code)
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
