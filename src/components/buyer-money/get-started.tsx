"use client";

import Link from "next/link";
import * as React from "react";

import { formatLimit, relativeTime } from "@/components/g31/format";
import { useChains } from "@/hooks/useChains";
import { freeCallsOnlyText, servesPaidCalls } from "@/libs/chains/paid-rails";
import { isEvmChain } from "@/libs/chains/registry";
import { findChain } from "@/services/chains.service";
import { chainIdOfAccount } from "@/utils/chain";

import { SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { capsAreSet } from "@/features/buyer-money/caps";
import {
  ASSAY_MCP_SOURCE,
  PAID_BY_INVITATION_TEXT,
  PAID_BY_INVITATION_TITLE,
  firstCallPrompt,
  getStartedComplete,
  getStartedStates,
  payByInvitation,
  payStage,
  stepOptional,
  type GetStartedFacts,
} from "@/features/buyer-money/get-started";
import { mcpToolName } from "@/features/connect/mcp-url";
import { nextKeyName } from "@/features/buyer-money/agent-label";
import { useCatalogue } from "@/components/g31/use-catalogue";
import { plainError } from "@/libs/plain-language";
import { SUPPORT_URL } from "@/libs/support";
import { supportsDelegation } from "@/features/delegation/delegation-form";

import { CapsSheet } from "./caps-sheet";
import { CreateKeyForm, createKeyErrorText, newKeyPaysNote, payingKeyName, useCreateKey } from "./create-key";
import { DepositSheet } from "./deposit-sheet";
import { LetAgentPaySheet } from "./let-agent-pay-sheet";
import { McpConfigTabs } from "./mcp-config-tabs";
import { useRecordConnect } from "@/components/toolsets/use-toolsets";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { assayMcpRun, keyForHint, urlForClient, type McpClient } from "@/features/buyer-money/mcp-config";
import { GasHelpNote } from "./gas-help-note";
import { useAgentsAndKeys } from "./use-agents";

/**
 * Get started: from a new account to the agent's first paid call, on one card.
 *
 *   1. Create a key and paste the MCP config (tabs per client).
 *   2. First call — a live listener ticks it within seconds, no reload.
 *   3. Add funds — only for paid calls; free calls work already.
 *   4. Let the agent pay — its spending limits (and the account ceiling,
 *      raised to fit if needed) in one drawer; the payment key is detected,
 *      never typed. Until a payment key is bound this step reads "Paid
 *      calls: by invitation during testnet" (D14) and is not counted.
 *
 * A done step shows only its summary (what was achieved, where to change it),
 * never the active-state buttons or "waiting" lines.
 *
 * Every tick comes from data (keys, `lastUsedAt`, the escrow, the chain),
 * never from a click. Overview shows it until everything is done (or it is
 * dismissed); /onboarding always shows it.
 */
const DISMISS_KEY = "assay.get-started.dismissed";
const LIVE_POLL_MS = 5_000;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function Listening({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-body-13 text-02" aria-live="polite">
      <span aria-hidden="true" className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-400 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-primary-500" />
      </span>
      {children}
    </p>
  );
}

type AgentsAndKeys = ReturnType<typeof useAgentsAndKeys>;

/** A chain that serves free calls only: nothing to fund or pay with there. */
function freeOnlyChain(chainId: string | null): boolean {
  return chainId !== null && !servesPaidCalls(chainId);
}

/**
 * The agent Get started is about: the one furthest along — paying, else
 * holding a bound key, else holding a key that is not revoked — and the first
 * agent only when none is. Always the first one read a second agent that
 * already pays as "Let your agent pay" whenever the first had only revoked
 * keys, and kept the 5-second listener on for a bind nobody was making.
 */
function getStartedAgent(data: AgentsAndKeys): AgentsAndKeys["agents"][number] | null {
  const agents = data.agents;
  return (
    agents.find((a) => data.readiness[a.agentId]?.grant?.status === "ACTIVE") ??
    agents.find((a) => Boolean(data.readiness[a.agentId]?.boundCredential?.delegateAccount)) ??
    agents.find((a) => (data.health[a.agentId]?.unrevokedKeyCount ?? 0) > 0) ??
    agents[0] ??
    null
  );
}

/** The facts Get started ticks from, read off the agents, keys and escrow. */
function getStartedFactsFrom(data: AgentsAndKeys) {
  const agent = getStartedAgent(data);
  const allKeys = data.agents.flatMap((a) => data.keys[a.agentId] ?? []);
  const agentKeyCount = agent ? (data.keys[agent.agentId] ?? []).length : 0;
  // Get started's "live" is not revoked, expiry aside: the health's `unrevokedKeyCount`.
  const liveKeys = allKeys.filter((k) => !k.revokedAt);
  const health = data.agents.map((a) => data.health[a.agentId]).filter((h) => h !== undefined);
  const escrow = data.escrowQuery.data;
  const readiness = agent ? data.readiness[agent.agentId] : undefined;
  const bound = readiness?.boundCredential ?? null;
  const facts: GetStartedFacts = {
    hasLiveKey: health.some((h) => h.unrevokedKeyCount > 0),
    firstCallSeen: health.some((h) => h.firstCallSeen),
    // "Has ever deposited": the first deposit opens the escrow. A balance
    // spent down to zero later must not bring the checklist back.
    hasFunds: escrow?.exists === true,
    escrowExists: escrow?.exists === true,
    capsSet: capsAreSet(escrow),
    keyBound: Boolean(bound?.delegateAccount),
    grantActive: readiness?.grant?.status === "ACTIVE",
    needsDelegation: supportsDelegation(agent?.agentAccount),
    freeOnly: freeOnlyChain(chainIdOfAccount(escrow?.account ?? agent?.agentAccount)),
  };
  // When the first call arrived: the earliest use of a key that is not revoked.
  const firstCallAt =
    health
      .map((h) => h.earliestLastUsedAt)
      .filter((at): at is string => at !== null)
      .sort()[0] ?? null;
  // A bind can only be awaited for a key that is not revoked: the payment key is bound to one.
  const agentHasKey = agent ? (data.health[agent.agentId]?.unrevokedKeyCount ?? 0) > 0 : false;
  return { agent, liveKeys, agentKeyCount, escrow, readiness, bound, facts, firstCallAt, agentHasKey };
}

/**
 * Not every fact is read yet. A bound key's pay permission counts: without it
 * an agent that already pays read as "Let your agent pay" for a beat on every
 * Overview load, then the card vanished (V1-1).
 */
function dataLoading(data: AgentsAndKeys): boolean {
  return (
    data.agentsQuery.isPending ||
    (data.agents.length > 0 && data.keysQuery.isPending) ||
    data.escrowQuery.isPending ||
    // Every agent's: which one Get started is about depends on all of them (`getStartedAgent`).
    data.agents.some((agent) => data.readiness[agent.agentId]?.loading === true)
  );
}

/**
 * Some agent's keys are not shown to this session (an agent session,
 * BUG-DEMO-02). Which step is done depends on every agent's keys, and the
 * steps (create a key, let it pay) are a person's, so the checklist does not
 * guess: it is not shown, and never reads a hidden agent as "no key".
 */
function keysHidden(data: AgentsAndKeys): boolean {
  return data.agents.some((agent) => data.keysHiddenFor.has(agent.agentId));
}

const DISMISS_EVENT = "assay:get-started-dismissed";

/**
 * Whether Overview is showing Get started right now (loaded, not complete,
 * not dismissed), so the page around it can step back: "Add funds" turns
 * secondary while step 1 is "Create a key".
 */
export function useGetStartedShown(): boolean {
  const data = useAgentsAndKeys();
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    setDismissed(readDismissed());
    const onDismiss = () => setDismissed(true);
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(DISMISS_EVENT, onDismiss);
  }, []);
  if (dismissed || dataLoading(data) || keysHidden(data)) return false;
  return !getStartedComplete(getStartedFactsFrom(data).facts);
}

export function GetStarted({ placement }: { placement: "overview" | "page" }) {
  const [poll, setPoll] = React.useState<number | false>(false);
  const data = useAgentsAndKeys({ pollMs: poll });
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => setDismissed(readDismissed()), []);

  const [sheet, setSheet] = React.useState<"deposit" | "caps" | "pay" | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  // The key made on this visit, kept in memory only (never stored), so the
  // config stays ready to paste after "I've pasted it".
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null | undefined>(undefined);

  const { agent, liveKeys, agentKeyCount, escrow, readiness, bound, facts, firstCallAt, agentHasKey } = getStartedFactsFrom(data);
  // Step 1 done, but the full key is gone: make a new one here and fill it in.
  const createInPlace = useCreateKey(agent?.agentId ?? null, agentKeyCount, (key) => setCreatedToken(key.token));
  const catalogue = useCatalogue();
  // Copying the config hands out `/`: Servers in use then waits for its first call.
  const recordConnect = useRecordConnect(agent?.agentId);
  const onCopyConfig = (client: McpClient, copied?: string) => {
    if (agent) recordConnect.mutate({ url: copied ?? urlForClient(client, mcpEndpointUrl()), serverName: "assay", client });
  };
  const states = getStartedStates(facts);
  const { chains } = useChains();
  const chainId = chainIdOfAccount(escrow?.account ?? agent?.agentAccount);
  const chain = chainId ? findChain(chains, chainId) : null;
  const evm = chainId !== null && isEvmChain(chainId);
  const grant = readiness?.grant?.status === "ACTIVE" ? readiness.grant : null;
  const payLine = grant ? `up to ${formatLimit(grant.maxVoucherAmount)} a call and ${formatLimit(grant.maxPerWindow)} per 24 hours` : null;
  const stage = payStage(facts);
  const complete = getStartedComplete(facts);
  const invitation = payByInvitation(facts);

  // The live listener: on while the first call or the payment key is awaited.
  const loading = dataLoading(data);
  // On Overview, render nothing until the data says it is needed: a set-up
  // account should not see a checklist skeleton flash on every visit.
  const keysNotShown = keysHidden(data);
  const hidden = placement === "overview" && (loading || complete || dismissed || keysNotShown);
  // The live listener, only while there is something to wait for on screen: the
  // first call of a key that exists, or the bind of a key that is not revoked.
  // Never while the checklist is hidden, loading or complete: then the agent
  // rows' 30-second read is enough.
  const listen =
    !hidden &&
    !keysNotShown &&
    !loading &&
    !complete &&
    (states.call === "current" || (states.pay !== "done" && stage === "bind" && agentHasKey)) &&
    !revealing;
  React.useEffect(() => setPoll(listen ? LIVE_POLL_MS : false), [listen]);

  // When the data moves the current step on, let the checklist follow it again.
  const currentId = revealing ? "key" : (Object.entries(states).find(([, s]) => s === "current")?.[0] ?? null);
  React.useEffect(() => setExpanded(undefined), [currentId]);
  // `?step=call` (Overview's "Make a first call") opens that step. Read after
  // mount: a static export has no request to read it from at build time.
  const [askedStep, setAskedStep] = React.useState<string | null>(null);
  React.useEffect(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    if (step) setAskedStep(step);
  }, []);

  if (hidden) return null;
  if (keysNotShown) {
    return (
      <p className="text-body-13 text-02" data-testid="get-started-keys-hidden">
        {plainError("AGENT_KEYS_HIDDEN")} Sign in as yourself to set your agent up.
      </p>
    );
  }

  const agentName = agent?.label ?? "your agent";
  // Free calls only on this chain: steps 3 and 4 do not apply, said up front.
  const freeOnlyNote = facts.freeOnly ? (
    <p className="text-body-13 text-02" data-testid="step-free-only">
      Not needed: {freeCallsOnlyText(chain?.displayName ?? "This chain")}
    </p>
  ) : null;

  const allSteps: SetupStep[] = [
    {
      id: "key",
      title: "Create a key and connect your agent",
      description: "Your agent uses the key to call tools through Assay.",
      // Done as soon as the key exists, so the count says 1 of 4 while the
      // key is still on screen; the step stays open until "I've pasted it".
      state: revealing && !facts.hasLiveKey ? "current" : states.key,
      blockedReason: agent ? undefined : "Your account is still being set up. Reload in a moment.",
      content: agent ? (
        facts.hasLiveKey && !revealing ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-body-13 text-02">
              {createdToken
                ? "Your key is ready, and the config below already carries it. It is shown once: copy it now."
                : "You have a key. Its full value was shown once, when it was made: create a new key here to get a config ready to paste."}
            </p>
            {createdToken ? <p className="text-body-xs text-03">{newKeyPaysNote(payingKeyName(readiness))}</p> : null}
            <McpConfigTabs
              token={createdToken}
              keyPrefix={keyForHint(liveKeys)?.prefix ?? null}
              onCopy={onCopyConfig}
              onCreateKey={() => createInPlace.mutate()}
              agentName={agent?.label ?? null}
              creatingKey={createInPlace.isPending}
              createKeyError={createInPlace.isError ? createKeyErrorText(createInPlace.error) : null}
            />
          </div>
        ) : (
          <CreateKeyForm
            agentId={agent.agentId}
            defaultName={nextKeyName(agentKeyCount)}
            onCreated={(key) => {
              setCreatedToken(key.token);
              setRevealing(true);
            }}
            onDone={() => {
              setRevealing(false);
              setExpanded("call");
            }}
            doneLabel="I've pasted it: next step"
          />
        )
      ) : undefined,
    },
    {
      id: "call",
      title: "Make a first call",
      description: "Ask your agent to use a tool. Many tools have free calls each day, so no money is needed yet.",
      state: revealing ? "todo" : states.call,
      blockedReason: "Needs a key first.",
      content:
        states.call === "done" ? (
          <p className="text-body-13 text-02" data-testid="step-call-done">
            Its first call arrived{firstCallAt ? ` ${relativeTime(firstCallAt)}` : ""}. Free calls work from here on.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-body-13 text-02" data-testid="first-call-prompt">
              {firstCallPrompt(catalogue.tools, mcpToolName)}
            </p>
            <Listening>Waiting for your agent&apos;s first call…</Listening>
          </div>
        ),
    },
    {
      id: "funds",
      title: facts.freeOnly ? "Add funds (not needed on this chain)" : "Add funds",
      description: facts.freeOnly
        ? "This chain serves free calls only, so there is nothing to fund."
        : invitation
          ? "Only needed for paid calls, which are by invitation during testnet."
          : "Only for paid calls. Free calls already work. Minimum $5.00.",
      state: states.funds,
      // A deposit buys nothing while paying is by invitation (D14): not counted.
      optional: stepOptional(facts, "funds"),
      content: freeOnlyNote ? (
        freeOnlyNote
      ) : states.funds === "done" ? (
          <p className="text-body-13 text-02" data-testid="step-funds-done">
            Your escrow is open{escrow?.spendable ? ` with ${formatLimit(escrow.spendable)} available` : ""}. Add more any time
            on{" "}
            <Link href="/funding" className="font-semibold text-primary-600 hover:underline">
              Money
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button type="button" onClick={() => setSheet("deposit")}>
              Add funds
            </Button>
            {evm ? (
              <p className="text-body-xs text-03">Two wallet prompts, each paid in a little ETH for gas.</p>
            ) : null}
            <GasHelpNote chain={chain} />
          </div>
        ),
    },
    {
      id: "pay",
      title: facts.freeOnly ? "Let your agent pay (not needed on this chain)" : invitation ? PAID_BY_INVITATION_TITLE : "Let your agent pay",
      description: facts.freeOnly
        ? "This chain serves free calls only, so your agent never pays here."
        : invitation
          ? "Free calls work without it."
          : "Allow your agent to pay, within spending limits you choose. Free signatures, no gas.",
      state: states.pay,
      // By invitation: not counted as unfinished (D14).
      optional: stepOptional(facts, "pay"),
      blockedReason: "Add funds first: your first deposit opens your escrow.",
      content: freeOnlyNote ? (
        freeOnlyNote
      ) : invitation ? (
        <PaidByInvitation
          agentName={agentName}
          onSetCaps={facts.escrowExists && !facts.capsSet ? () => setSheet("caps") : undefined}
        />
      ) : states.pay === "done" ? (
          <div className="flex flex-col gap-1.5" data-testid="step-pay-done">
            <p className="text-body-13 text-02">{agentName} can pay for calls{payLine ? `: ${payLine}` : "."}</p>
            <Link href="/limits" className="self-start text-label-13 text-primary-600 hover:underline">
              Change its spending limits
            </Link>
          </div>
        ) : stage === "caps" && !facts.needsDelegation ? (
          <Button type="button" onClick={() => setSheet("caps")}>
            Set your account ceiling
          </Button>
        ) : (
          <Button type="button" onClick={() => setSheet("pay")}>
            Let {agentName} pay
          </Button>
        ),
    },
  ];

  // Free calls only: funding and paying do not apply, so they are not steps
  // (counted as done they made the bar read "2 of 4" before anything was done).
  const steps = facts.freeOnly ? allSteps.filter((step) => step.id === "key" || step.id === "call") : allSteps;
  // The asked step opens only once it can be done; while it waits on an earlier one, the current step opens.
  const askedOpen = askedStep !== null && steps.some((step) => step.id === askedStep && step.state !== "blocked");

  return (
    <>
      <SetupChecklist
        title="Get started"
        description={
          facts.freeOnly
            ? "Two steps to your agent's first call. This chain serves free calls only, so adding funds and letting your agent pay are not needed."
            : invitation
              ? "Free calls work after step 2. Paid calls are by invitation during testnet."
              : "Four steps to your agent's first paid call. Free calls work after step 2."
        }
        steps={steps}
        loading={loading}
        expandedId={revealing ? "key" : expanded === undefined && askedOpen ? askedStep : expanded}
        onExpandedChange={setExpanded}
        doneTitle={facts.freeOnly || invitation ? "All set: your agent can make free calls" : "All set: your agent can call tools and pay for them"}
        doneDescription="Watch its calls under Activity. Change its spending limits under Controls."
        onDismiss={
          placement === "overview"
            ? () => {
                try {
                  window.localStorage.setItem(DISMISS_KEY, "1");
                } catch {
                  // Not remembered; hidden for this visit.
                }
                setDismissed(true);
                window.dispatchEvent(new Event(DISMISS_EVENT));
              }
            : undefined
        }
      />
      <DepositSheet
        open={sheet === "deposit"}
        onOpenChange={(open) => !open && setSheet(null)}
        onSetCaps={() => setSheet(facts.keyBound || !facts.needsDelegation ? (facts.needsDelegation ? "pay" : "caps") : "caps")}
      />
      <CapsSheet open={sheet === "caps"} onOpenChange={(open) => !open && setSheet(null)} />
      <LetAgentPaySheet
        open={sheet === "pay"}
        onOpenChange={(open) => !open && setSheet(null)}
        agentName={agentName}
        delegateAccount={bound?.delegateAccount ?? null}
      />
    </>
  );
}

/**
 * Step 4 while no payment key is bound (D14): paid calls are by invitation
 * during testnet. "Ask for access" goes to SUPPORT_URL when this deployment
 * has one. An invited buyer still finds the payment-key command, folded away,
 * and the step ticks on by itself once the key is bound.
 */
export function PaidByInvitation({ agentName, onSetCaps }: { agentName: string; onSetCaps?: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="paid-by-invitation">
      <p className="text-body-13 text-02">{PAID_BY_INVITATION_TEXT}</p>
      {SUPPORT_URL ? (
        <Button asChild variant="secondary" className="self-start">
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer" data-testid="ask-for-access">
            Ask for access
          </a>
        </Button>
      ) : null}
      <details className="text-body-13 text-02">
        <summary className="min-h-10 cursor-pointer select-none content-center text-label-13 text-01">Invited already?</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2.5">
          <p className="text-body-xs text-03" data-testid="assay-mcp-source">
            {ASSAY_MCP_SOURCE.replace("the agent's machine", `${agentName}'s machine`)}
          </p>
          <CodeBlock title="Terminal" code={`${assayMcpRun()} enable-paid`} wrap />
          <Listening>Waiting for the payment key. This updates by itself.</Listening>
          {onSetCaps ? (
            <Button type="button" variant="secondary" className="self-start" onClick={onSetCaps}>
              Set your account ceiling
            </Button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
