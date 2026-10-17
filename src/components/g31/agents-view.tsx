"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import * as React from "react";

import { AgentHealthLine } from "@/components/buyer-money/agent-health";
import { CreateKeySheet } from "@/components/buyer-money/create-key";
import { LetAgentPaySheet } from "@/components/buyer-money/let-agent-pay-sheet";
import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { EffectiveLimitLines, type LimitsContext, rowsFor, SpendingLimitsActions, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { type AgentRow, type KeyRow } from "@/components/buyer-money/use-agents";
import { limitLines } from "@/features/buyer-money/spending-limits";
import { CapMeter } from "@/components/patterns/cap-meter";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { CopyChip } from "@/components/patterns/copy-chip";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";
import { capsToForm } from "@/features/buyer-money/caps";
import { AGENT_CLI_SOURCE } from "@/features/buyer-money/get-started";
import { permissionExpiry } from "@/features/buyer-money/permission-expiry";
import { type DelegateBinding, supportsDelegation } from "@/features/delegation/delegation-form";
import { hasTightenDelay, tightenDelayLabel } from "@/features/delegation/unsettled";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { shortAddress } from "@/libs/chains/format";
import { revokeCredential } from "@/services/account.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { toast } from "@/utils/toast";

import { AgentAccessCard } from "@/components/toolsets/agent-access-card";
import { ServersInUse } from "@/components/toolsets/servers-in-use";

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
 *   3. Payment key — bound by `agent-cli bind`, detected automatically.
 *   4. Spending limits — the effective limit and what binds it, what it spent
 *      in the last 24 hours, and Change spending limits / Stop it paying.
 *   5. What this agent can use — its access and provider limits. The fix
 *      links of refused calls open it: `/agents?agent={id}#access`.
 *
 * Two different stops, never both called "revoke": **Stop it paying** removes
 * the on-chain permission (the API key still works for free calls); **Revoke
 * key** ends the API key for every call, free and paid. Both are immediate.
 */
const BIND_COMMAND = "agent-cli keygen && agent-cli bind";
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
            focusAccess={focus.access && (focus.agentId ? focus.agentId === agent.agentId : i === 0)}
            ctx={data}
            agent={agent}
            keys={data.keys[agent.agentId]}
            keysPending={data.keysQuery.isPending}
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

function AgentCard({
  focusAccess,
  ctx,
  agent,
  keys,
  keysPending,
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
  readiness: AgentReadiness;
  escrowReady: boolean;
  onNewKey: () => void;
  onRevokeKey: (key: KeyRow) => void;
  onLetPay: (delegate: string, renew?: { perCall: string; perDay: string } | null) => void;
  onChanged: () => void;
}) {
  const [showRevoked, setShowRevoked] = React.useState(false);
  const [configFor, setConfigFor] = React.useState<string | null>(null);
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

  return (
    <section
      aria-label={name}
      data-testid="agent-card"
      className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5"
    >
      <header className="flex w-full flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-label-md text-01">{name}</h2>
          <AgentHealthLine readiness={readiness} />
        </div>
        <StatusChip status={readiness.status} />
      </header>

      <SubRow n={1} title="Keys">
        {keysPending ? (
          <p className="text-body-13 text-03">Loading keys…</p>
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
                      <span className="font-mono">{key.prefix}…</span> ·{" "}
                      {key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)}` : "never used"}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" type="button" onClick={() => setConfigFor(configFor === key.id ? null : key.id)} aria-expanded={configFor === key.id}>
                    {configFor === key.id ? "Hide config" : "MCP config"}
                  </Button>
                  <Button size="sm" variant="secondary" type="button" className="text-danger-600" data-testid="revoke-credential" onClick={() => onRevokeKey(key)}>
                    Revoke key
                  </Button>
                </div>
                {configFor === key.id ? (
                  <div className="min-w-0">
                    <McpConfigTabs token={null} keyPrefix={key.prefix} />
                  </div>
                ) : null}
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
                {key.name} · <span className="font-mono">{key.prefix}…</span> · revoked {relativeTime(key.revokedAt)}
              </li>
            ))}
          </ul>
        ) : null}
      </SubRow>

      <SubRow n={2} title="Servers in use">
        <ServersInUse agentId={agent.agentId} agentName={name} />
      </SubRow>

      {delegation ? (
        <SubRow n={3} title="Payment key">
          {bound?.delegateAccount && chainId ? (
            <p className="text-body-13 text-02">
              <span className="font-mono text-01">{shortAddress(chainId, addressOfAccount(bound.delegateAccount))}</span>
              {bound.delegateBoundAt ? <> · set up {relativeTime(bound.delegateBoundAt)}</> : null} · on key “{bound.name}”
            </p>
          ) : live.length === 0 ? (
            <p className="text-body-13 text-03">Create a key first.</p>
          ) : (
            <>
              <p className="text-body-13 text-02">
                To pay, the agent makes its own payment key. Run this on the agent&apos;s machine:
              </p>
              <CodeBlock title="Terminal" code={BIND_COMMAND} />
              <p className="text-body-xs text-03" data-testid="agent-cli-source">{AGENT_CLI_SOURCE}</p>
              <p className="flex items-center gap-1.5 text-body-xs text-03" aria-live="polite">
                <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
                Waiting for the key. This updates by itself.
              </p>
            </>
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
          Agent id <CopyChip value={agent.agentId} />
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
