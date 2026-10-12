"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import * as React from "react";

import { CodeBlock } from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/libs/ApiClient";
import {
  createCredential,
  listAgents,
  listCredentials,
  revokeCredential,
} from "@/services/account.service";
import { toast } from "@/utils/toast";

import type { DelegateBinding } from "@/features/delegation/delegation-form";
import { supportsDelegation } from "@/features/delegation/delegation-form";

import { AgentPaymentDelegation, PayerDelegationsPanel } from "./agent-payment-delegation";
import { MicroLabel, PageHeader, StatusPill } from "./chrome";
import { dateOnly, relativeTime } from "./format";

/**
 * Agents and credentials, and the "Credential created" reveal.
 *
 * "Credential created" is not a route. It is the one-shot reveal that follows a successful
 * `POST /agents/{agentId}/credentials`, and the API's own words are that the
 * secret is "returned exactly once". So it is a dialog on this screen, opened
 * by the response and closed by the person confirming they have stored it —
 * a route would imply the key could be navigated back to.
 *
 * The design's own note is the product rule here: revocation is immediate,
 * with no grace period and no cached-token window. `DELETE .../credentials/{id}`
 * sets `revoked_at` and never deletes the row, so a revoked credential stays
 * visible with its history rather than vanishing.
 *
 * Two sections of the design have no endpoint and are not drawn: the session
 * signer (no signer resource) and browser sessions (no session resource). What
 * stands in for a session signer is agent payment delegation: the agent's own
 * key, bound to its credential, authorised by the person's wallet on chain —
 * see `agent-payment-delegation.tsx`.
 * Both would have had to be invented wholesale on a screen whose subject is
 * "what currently has authority over your money" — the worst place in the
 * product to show a made-up grant.
 */

interface Credential {
  id: string;
  agentId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId: string | null;
  /** CAIP-10 of the delegate key this credential proved it holds (agent payment delegation). */
  delegateAccount?: string | null;
  delegateBoundAt?: string | null;
  createdAt: string;
}

interface CreatedCredential {
  id: string;
  agentId: string;
  name: string;
  prefix: string;
  /** Shown exactly once. Never re-fetchable. */
  token: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

interface Agent {
  agentId: string;
  label?: string;
  agentAccount?: string;
  credentialCount?: number;
}

const DEFAULT_SCOPES = ["tools:call"];

function CredentialRow({
  credential,
  onRevoke,
  revoking,
}: {
  credential: Credential;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const revoked = Boolean(credential.revokedAt);
  return (
    <div
      data-testid="credential-row"
      data-credential-id={credential.id}
      className="flex w-full items-center gap-3.5 rounded-lg border border-01 bg-02 p-3.5"
    >
      <KeyRound aria-hidden="true" className="size-4 shrink-0 text-02" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-mono-13 font-semibold text-01">
          {credential.prefix}…
        </span>
        <span className={revoked ? "text-body-xs text-danger-600" : "text-body-xs text-03"}>
          {credential.name} · created {dateOnly(credential.createdAt)} ·{" "}
          {revoked
            ? `revoked ${relativeTime(credential.revokedAt)}`
            : credential.lastUsedAt
              ? `last used ${relativeTime(credential.lastUsedAt)}`
              : "never used"}
        </span>
      </div>
      {revoked ? (
        <StatusPill label="REVOKED" tone="danger" />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          data-testid="revoke-credential"
          className="text-danger-600"
          loading={revoking}
          onClick={onRevoke}
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

export function AgentsView() {
  const queryClient = useQueryClient();
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [created, setCreated] = React.useState<CreatedCredential | null>(null);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  /**
   * Bumped after every write, and threaded into the REQUEST URL — not just the
   * React Query key.
   *
   * The API answers every GET with
   * `Cache-Control: private, max-age=10, stale-while-revalidate=3600`, so the
   * BROWSER serves a credential list it already has and the request never
   * reaches the server. Measured: after creating a credential the API returned
   * six rows to curl while the page still showed five, through
   * `invalidateQueries`, through `refetchQueries`, and through a fresh React
   * Query key — because none of those change the URL.
   *
   * On this screen that is not a refresh annoyance. The design's own promise
   * is "revocation is immediate, no grace period and no cached-token window",
   * and a revoked credential that keeps rendering as live says the opposite.
   *
   * `from` is the cache-buster because it is on the endpoint's parameter
   * whitelist (an unknown parameter is a 400) and because a `from` in 1970
   * excludes nothing. The real fix belongs in the backend's cache headers.
   */
  const [writeCount, setWriteCount] = React.useState(0);
  const cacheBuster = React.useMemo(() => new Date(writeCount).toISOString(), [writeCount]);

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: Agent[] }>,
  });

  const agents = React.useMemo(() => agentsQuery.data?.items ?? [], [agentsQuery.data]);
  /** Bumped after every delegation write, success or failure, so the chain is read again. */
  const [delegationVersion, setDelegationVersion] = React.useState(0);
  const bumpDelegations = React.useCallback(() => setDelegationVersion((n) => n + 1), []);

  const agentIds = React.useMemo(() => agents.map((agent) => agent.agentId), [agents]);

  /** One query across every agent, keyed by `writeCount` — see the note above. */
  const credentialsQuery = useQuery({
    queryKey: ["credentials", agentIds, writeCount],
    /*
      This used to carry an `eslint-disable-next-line
      @tanstack/query/exhaustive-deps`, which was dead:
      `@tanstack/eslint-plugin-query` has never been a dependency of this repo,
      so the rule never ran and the directive suppressed nothing. It was removed
      when the frontend gained its first ESLint config, because ESLint reports a
      disable comment naming an unknown rule as an error of its own. If that
      plugin is ever added, this call is where its finding will land.
    */
    enabled: agentIds.length > 0,
    queryFn: async () => {
      const lists = await Promise.all(
        agentIds.map(
          (id) =>
            listCredentials(id, { limit: 50, from: cacheBuster } as never) as Promise<{
              items: Credential[];
            }>
        )
      );
      return Object.fromEntries(agentIds.map((id, i) => [id, lists[i].items])) as Record<
        string,
        Credential[]
      >;
    },
  });

  /**
   * The payer whose on-chain grants the page lists: an agent's spending account on
   * eip155 (every agent of a person spends from the same wallet).
   */
  const payerAccount = agents.find((agent) => supportsDelegation(agent.agentAccount))?.agentAccount;
  /** Every credential that ever bound a key — revoked ones included, so their grants stay visible. */
  const delegateBindings = React.useMemo<DelegateBinding[]>(
    () =>
      agents.flatMap((agent) =>
        (credentialsQuery.data?.[agent.agentId] ?? [])
          .filter((credential) => credential.delegateAccount)
          .map((credential) => ({
            agentId: agent.agentId,
            agentLabel: agent.label ?? agent.agentId,
            credentialId: credential.id,
            credentialName: credential.name,
            delegateAccount: credential.delegateAccount as string,
            delegateBoundAt: credential.delegateBoundAt ?? null,
            revokedAt: credential.revokedAt,
          }))
      ),
    [agents, credentialsQuery.data]
  );

  const createMutation = useMutation({
    mutationFn: (input: { agentId: string; name: string }) =>
      createCredential(input.agentId, {
        name: input.name,
        scopes: DEFAULT_SCOPES,
      }) as Promise<CreatedCredential>,
    onSuccess: async (credential) => {
      setCreated(credential);
      setCreatingFor(null);
      setName("");
      setWriteCount((n) => n + 1);
      await queryClient.refetchQueries({ queryKey: ["agents"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "The credential could not be created");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { agentId: string; id: string }) =>
      revokeCredential(input.agentId, input.id),
    onSuccess: async () => {
      setRevokingId(null);
      setWriteCount((n) => n + 1);
      await queryClient.refetchQueries({ queryKey: ["agents"] });
      toast.success("Revoked. There is no grace period — it stopped working immediately.");
    },
    onError: (error) => {
      setRevokingId(null);
      toast.error(error instanceof ApiError ? error.message : "The credential could not be revoked");
    },
  });

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Agents and credentials"
        subtitle="what currently has authority over your money, and when each thing stops working"
        actions={
          agents.length > 0 ? (
            <Button
              icon={<Plus />}
              type="button"
              data-testid="new-credential"
              onClick={() => setCreatingFor(agents[0].agentId)}
            >
              New credential
            </Button>
          ) : null
        }
      />

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-3.5 tablet:p-[15px]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
        <p className="text-body-13 text-primary-700">
          Revocation is immediate. There is no grace period and no cached-token window. A console
          that lists live grants with their remaining allowance and a one-click revoke is the
          largest open gap in the market — Stripe SPTs are revoke-by-API only, Coinbase Spend
          Permissions ship no manager UI, AP2 has no user-initiated revocation.
        </p>
      </div>

      {payerAccount ? (
        <PayerDelegationsPanel
          account={payerAccount}
          bindings={delegateBindings}
          version={delegationVersion}
          onChanged={bumpDelegations}
        />
      ) : null}

      {agentsQuery.isPending ? (
        <p className="font-mono text-mono-13 text-03">Loading agents…</p>
      ) : agentsQuery.isError ? (
        <EmptyState
          icon={<KeyRound width={22} height={22} />}
          title="Agents could not be read"
          description={`${
            agentsQuery.error instanceof ApiError
              ? agentsQuery.error.message
              : "The request could not be completed"
          }. This is not a statement that nothing holds authority over your money — it is a statement that we cannot currently see what does.`}
        />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<KeyRound width={22} height={22} />}
          title="No agent has been created yet"
          description="An agent is the thing that holds a credential and spends against your policy. Until one exists, nothing has authority over your money."
        />
      ) : (
        agents.map((agent) => {
          const credentials = credentialsQuery.data?.[agent.agentId] ?? [];
          const pending = credentialsQuery.isPending;
          return (
            <Panel key={agent.agentId}>
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>{agent.label ?? agent.agentId}</PanelTitle>
                  <PanelDescription>
                    {credentials.filter((c) => !c.revokedAt).length} live ·{" "}
                    {credentials.filter((c) => c.revokedAt).length} revoked · {agent.agentId}
                  </PanelDescription>
                </PanelTitles>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<Plus />}
                  onClick={() => setCreatingFor(agent.agentId)}
                >
                  New credential
                </Button>
              </PanelHeader>
              <PanelBody className="gap-3 p-5">
                <MicroLabel>CREDENTIALS</MicroLabel>
                {pending ? (
                  <p className="font-mono text-mono-13 text-03">Loading…</p>
                ) : credentials.length === 0 ? (
                  <p className="text-body-13 text-02">
                    This agent has no credential. It cannot call anything until one is created.
                  </p>
                ) : (
                  credentials.map((credential) => (
                    <CredentialRow
                      key={credential.id}
                      credential={credential}
                      revoking={revokingId === credential.id}
                      onRevoke={() => {
                        setRevokingId(credential.id);
                        revokeMutation.mutate({ agentId: agent.agentId, id: credential.id });
                      }}
                    />
                  ))
                )}
                {agent.agentAccount ? (
                  <p className="break-all pt-1 font-mono text-mono-xs text-03">
                    spends from {agent.agentAccount}
                  </p>
                ) : null}
                <AgentPaymentDelegation
                  agentAccount={agent.agentAccount}
                  credentials={credentials}
                  version={delegationVersion}
                  onChanged={bumpDelegations}
                />
              </PanelBody>
            </Panel>
          );
        })
      )}

      <p className="text-body-xs text-03">
        The design also draws a browser-session table here. It has no endpoint on this API, so it is
        not shown rather than invented — on a screen about what has authority over your money, an
        invented grant is worse than a missing one. An agent’s authority to pay is listed above,
        read from the chain.
      </p>

      {/* Create */}
      <Sheet open={creatingFor !== null} onOpenChange={(open) => !open && setCreatingFor(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New credential</SheetTitle>
            <SheetDescription>
              The secret is returned exactly once. Give it a name you will recognise in this list
              when you come to revoke it.
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
            <Field
              label="Name"
              id="credential-name"
              data-testid="credential-name"
              placeholder="CI deploy"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint={`Scopes: ${DEFAULT_SCOPES.join(", ")}`}
            />
            <Button
              type="button"
              data-testid="create-credential"
              loading={createMutation.isPending}
              disabled={!name.trim()}
              onClick={() =>
                creatingFor && createMutation.mutate({ agentId: creatingFor, name: name.trim() })
              }
            >
              Create credential
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Credential created */}
      <Sheet open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <SheetContent className="tablet:max-w-[760px]" data-testid="credential-created">
          <SheetHeader>
            <SheetTitle className="text-heading-md">Your new credential</SheetTitle>
            <SheetDescription className="text-body-md">
              Scoped to {created?.name}. It does not expire — revoke or rotate it at any time under
              Agents.
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-5 px-[18px] pb-8 pt-5">
            {created ? (
              <CodeBlock title={`${created.prefix}…`} code={created.token} />
            ) : null}

            <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-warning-600" />
              <p className="text-body-13 text-warning-700">
                This key is shown once. We cannot show it again — create a new one if you lose it.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-4">
              <p className="text-label-sm text-01">Rotating safely</p>
              <p className="text-body-13 text-02">
                Both keys are live right now. Deploy this one, confirm “last used” updates on the
                Agents screen, then revoke the old key. Revocation is immediate and has no
                cached-token window.
              </p>
            </div>

            <div className="flex w-full justify-end gap-2.5">
              <Button type="button" onClick={() => setCreated(null)}>
                I have stored it
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
