"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus } from "lucide-react";
import * as React from "react";

import { AgentHealthLine, ReadinessChip } from "@/components/buyer-money/agent-health";
import { CreateKeySheet, payingKeyName } from "@/components/buyer-money/create-key";
import { PaidByInvitation } from "@/components/buyer-money/get-started";
import { LetAgentPaySheet } from "@/components/buyer-money/let-agent-pay-sheet";
import { EffectiveLimitLines, type LimitsContext, rowsFor, SpendingLimitsActions, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { type AgentRow, type KeyRow } from "@/components/buyer-money/use-agents";
import { limitLines } from "@/features/buyer-money/spending-limits";
import { CapMeter } from "@/components/patterns/cap-meter";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
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
import { type DelegateBinding, supportsDelegation } from "@/features/delegation/delegation-form";
import { hasTightenDelay, tightenDelayLabel } from "@/features/delegation/unsettled";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { shortAddress } from "@/libs/chains/format";
import { renameAgent, revokeCredential } from "@/services/account.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { toast } from "@/utils/toast";

import { AgentAccessCard } from "@/components/toolsets/agent-access-card";
import { ServersInUse } from "@/components/toolsets/servers-in-use";
import { UpdateFromAlert } from "@/components/toolsets/update-sheet";

import { PayerDelegationsPanel } from "./agent-payment-delegation";
import { relativeTime } from "./format";

/**
 * Controls › Agents & keys: one card per agent, answering "is it working?"
 * and "how do I stop it?" without leaving the card.
 *
 *   1. Keys — the agent's live API keys (revoked ones folded away), the MCP
 *      config to paste, and Revoke key behind a confirmation that names the
 *      key and says whether paying stops too.
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
 * Two different stops, never both called "revoke": **Stop it paying** removes
 * the on-chain permission (the API key still works for free calls); **Revoke
 * key** ends the API key for every call, free and paid. Both are immediate.
 */
const POLL_MS = 5_000;

/** Whether the agent pays through this key: its payment key was bound on it and is allowed to pay. */
function paysThrough(key: KeyRow, readiness: AgentReadiness | undefined): boolean {
  return Boolean(
    key.delegateAccount && readiness?.boundCredential?.id === key.id && readiness.grant?.status === "ACTIVE",
  );
}

/**
 * What revoking an API key does — to calls, and whether paying stops too.
 * Revoking the API key stops every call through Assay at once (paid calls need
 * it); it does not touch the on-chain pay permission, which only Stop it
 * paying removes, and on an escrow with the tighten delay (D-21) payments the
 * agent already signed stay collectable for that delay after it.
 */
export function revokeKeyText(
  agent: AgentRow,
  key: KeyRow,
  readiness: AgentReadiness | undefined,
  tightenDelaySeconds?: number | null,
): { text: string; detail: string | null } {
  const name = agent.label ?? "The agent";
  // Two short sentences up front; the on-chain detail below them (review 2026-10-17: one long paragraph).
  const text = `${name} can no longer call any tool with this key, free or paid. This cannot be undone; you can create a new key.`;
  if (paysThrough(key, readiness)) {
    const delay = hasTightenDelay(tightenDelaySeconds)
      ? ` After that, payments it already signed can still be collected for ${tightenDelayLabel(tightenDelaySeconds!)}.`
      : "";
    return {
      text,
      detail:
        "Its on-chain permission to pay is not removed by this: Stop it paying removes it (its payment key is then " +
        `listed under “Other keys that can still pay”).${delay}`,
    };
  }
  if (key.delegateAccount) return { text, detail: "Its payment key was set up on this key, so it cannot pay any more either." };
  return { text, detail: "Nothing about paying changes: this key has no payment key." };
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
  const [revoking, setRevoking] = React.useState<{ agent: AgentRow; key: KeyRow } | null>(null);
  // The last target, so the sheet's title does not go blank while it animates out.
  const [lastRevoke, setLastRevoke] = React.useState<{ agent: AgentRow; key: KeyRow } | null>(null);
  if (revoking && revoking !== lastRevoke) setLastRevoke(revoking);
  const [payFor, setPayFor] = React.useState<{
    agent: AgentRow;
    delegate: string;
    renew?: { perCall: string; perDay: string } | null;
  } | null>(null);

  const revoke = useMutation({
    mutationFn: (input: { agentId: string; id: string }) => revokeCredential(input.agentId, input.id),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["agent-keys"] });
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
      toast.success("Key revoked. It stopped working for every call immediately.");
    },
  });

  const refresh = () => {
    data.refetchKeys();
    data.refetchDelegates();
    void queryClient.invalidateQueries({ queryKey: ["escrow"] });
  };

  const revokeCopy = lastRevoke
    ? revokeKeyText(
        lastRevoke.agent,
        lastRevoke.key,
        data.readiness[lastRevoke.agent.agentId],
        data.delegatesQuery.data?.tightenDelaySeconds,
      )
    : null;

  const payerAccount = data.agents.find((a) => supportsDelegation(a.agentAccount))?.agentAccount;
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
            onRevokeKey={(key) => setRevoking({ agent, key })}
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

      <ConfirmSheet
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        tone="danger"
        title={`Revoke the API key “${lastRevoke?.key.name ?? ""}”?`}
        description={revokeCopy?.text ?? ""}
        changes={
          lastRevoke && paysThrough(lastRevoke.key, data.readiness[lastRevoke.agent.agentId])
            ? [
                { label: "API key", before: "Works", after: "Revoked" },
                { label: "Paid calls", before: "Allowed", after: "Stopped" },
              ]
            : [{ label: "API key", before: "Works", after: "Revoked" }]
        }
        confirmLabel="Revoke key"
        onConfirm={() => revoke.mutateAsync({ agentId: lastRevoke!.agent.agentId, id: lastRevoke!.key.id })}
        describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "The key could not be revoked. Try again.")}
      >
        {revokeCopy?.detail ? <p className="text-body-xs text-03">{revokeCopy.detail}</p> : null}
      </ConfirmSheet>

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
  onRevokeKey: (key: KeyRow) => void;
  onLetPay: (delegate: string, renew?: { perCall: string; perDay: string } | null) => void;
  onChanged: () => void;
}) {
  const [showRevoked, setShowRevoked] = React.useState(false);
  const name = agent.label ?? "Agent";
  const revoked = (keys ?? []).filter((k) => k.revokedAt);
  const live = readiness.liveCredentials as KeyRow[];
  const bound = readiness.boundCredential as KeyRow | null;
  const grant = readiness.grant;
  // On a free-calls-only chain no paying step applies: no payment key, spend
  // meter or renewal is shown (the readiness line says why).
  const delegation = supportsDelegation(agent.agentAccount) && !readiness.freeOnly;
  const chainId = chainIdOfAccount(bound?.delegateAccount);
  const [now] = React.useState(() => Date.now());
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
        ) : live.length === 0 ? (
          <p className="text-body-13 text-02">No live key. Create one to connect this agent.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {live.map((key) => (
              <li key={key.id} data-testid="credential-row" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-3">
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
                  <KeyRound aria-hidden="true" className="size-4 shrink-0 text-02" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label-13 text-01">{key.name}</span>
                    <span className="text-body-xs text-03">
                      <span className={key.prefix ? "font-mono" : undefined}>{credentialLabel(key)}</span> ·{" "}
                      {key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)}` : "never used"}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" type="button" className="text-danger-600" data-testid="revoke-credential" onClick={() => onRevokeKey(key)}>
                    Revoke key
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={live.length === 0 ? "primary" : "secondary"} icon={<Plus />} type="button" data-testid="new-credential" onClick={onNewKey}>
            New key
          </Button>
          {revoked.length > 0 ? (
            <button type="button" className="text-label-13 text-02 hover:underline" onClick={() => setShowRevoked((v) => !v)} aria-expanded={showRevoked}>
              {showRevoked ? "Hide" : "Show"} {revoked.length} revoked
            </button>
          ) : null}
        </div>
        {showRevoked ? (
          <ul className="flex flex-col gap-1">
            {revoked.map((key) => (
              <li key={key.id} className="text-body-xs text-03">
                {key.name} · <span className={key.prefix ? "font-mono" : undefined}>{credentialLabel(key)}</span> · revoked {relativeTime(key.revokedAt)}
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
