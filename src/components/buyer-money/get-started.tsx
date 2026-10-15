"use client";

import * as React from "react";

import { SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { capsAreSet } from "@/features/buyer-money/caps";
import { getStartedStates, payStage, type GetStartedFacts } from "@/features/buyer-money/get-started";
import { supportsDelegation } from "@/features/delegation/delegation-form";

import { CapsSheet } from "./caps-sheet";
import { CreateKeyForm } from "./create-key";
import { DepositSheet } from "./deposit-sheet";
import { LetAgentPaySheet } from "./let-agent-pay-sheet";
import { McpConfigTabs } from "./mcp-config-tabs";
import { useAgentsAndKeys } from "./use-agents";

/**
 * Get started: from a new account to the agent's first paid call, on one card.
 *
 *   1. Create a key and paste the MCP config (tabs per client).
 *   2. First call — a live listener ticks it within seconds, no reload.
 *   3. Add funds — only for paid calls; free calls work already.
 *   4. Let the agent pay — safety caps and the agent's permission in one
 *      drawer; the agent's payment key is detected, never typed.
 *
 * Every tick comes from data (keys, `lastUsedAt`, the escrow, the chain),
 * never from a click. Overview shows it until everything is done (or it is
 * dismissed); /onboarding always shows it.
 */
const DISMISS_KEY = "assay.get-started.dismissed";
const LIVE_POLL_MS = 5_000;
const BIND_COMMAND = "agent-cli keygen && agent-cli bind";

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

export function GetStarted({ placement }: { placement: "overview" | "page" }) {
  const [poll, setPoll] = React.useState<number | false>(false);
  const data = useAgentsAndKeys({ pollMs: poll });
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => setDismissed(readDismissed()), []);

  const [sheet, setSheet] = React.useState<"deposit" | "caps" | "pay" | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null | undefined>(undefined);

  const agent = data.agents[0] ?? null;
  const allKeys = data.agents.flatMap((a) => data.keys[a.agentId] ?? []);
  const liveKeys = allKeys.filter((k) => !k.revokedAt);
  const escrow = data.escrowQuery.data;
  const readiness = agent ? data.readiness[agent.agentId] : undefined;
  const bound = readiness?.boundCredential ?? null;
  const facts: GetStartedFacts = {
    hasLiveKey: liveKeys.length > 0,
    firstCallSeen: liveKeys.some((k) => k.lastUsedAt),
    // "Has ever deposited": the first deposit opens the escrow. A balance
    // spent down to zero later must not bring the checklist back.
    hasFunds: escrow?.exists === true,
    escrowExists: escrow?.exists === true,
    capsSet: capsAreSet(escrow),
    keyBound: Boolean(bound?.delegateAccount),
    grantActive: readiness?.grant?.status === "ACTIVE",
    needsDelegation: supportsDelegation(agent?.agentAccount),
  };
  const states = getStartedStates(facts);
  const stage = payStage(facts);
  const complete = Object.values(states).every((s) => s === "done");

  // The live listener: on while the first call or the payment key is awaited.
  const listen = (states.call === "current" || (states.pay !== "done" && stage === "bind")) && !revealing;
  React.useEffect(() => setPoll(listen ? LIVE_POLL_MS : false), [listen]);

  // When the data moves the current step on, let the checklist follow it again.
  const currentId = revealing ? "key" : (Object.entries(states).find(([, s]) => s === "current")?.[0] ?? null);
  React.useEffect(() => setExpanded(undefined), [currentId]);

  const loading = data.agentsQuery.isPending || (data.agents.length > 0 && data.keysQuery.isPending) || data.escrowQuery.isPending;
  // On Overview, render nothing until the data says it is needed: a set-up
  // account should not see a checklist skeleton flash on every visit.
  if (placement === "overview" && (loading || complete || dismissed)) return null;

  const agentName = agent?.label ?? "your agent";

  const steps: SetupStep[] = [
    {
      id: "key",
      title: "Create a key and connect your agent",
      description: "Your agent uses the key to call tools through Assay.",
      state: revealing ? "current" : states.key,
      blockedReason: agent ? undefined : "Your account is still being set up. Reload in a moment.",
      content: agent ? (
        facts.hasLiveKey && !revealing ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-body-13 text-02">Your key is ready. Paste this into your MCP client, with your key in place of the placeholder:</p>
            <McpConfigTabs token={null} />
          </div>
        ) : (
          <CreateKeyForm
            agentId={agent.agentId}
            onCreated={() => setRevealing(true)}
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
      content: (
        <div className="flex flex-col gap-2">
          <p className="text-body-13 text-02">
            For example, ask it to “search the web for x402 payments”. This step ticks itself when the call arrives.
          </p>
          <Listening>Waiting for your agent&apos;s first call…</Listening>
        </div>
      ),
    },
    {
      id: "funds",
      title: "Add funds",
      description: "Only for paid calls. Free calls already work. Minimum $5.00.",
      state: states.funds,
      content: (
        <Button type="button" onClick={() => setSheet("deposit")}>
          Add funds
        </Button>
      ),
    },
    {
      id: "pay",
      title: "Let your agent pay",
      description: "Set safety caps and allow your agent to pay within them. Free signatures, no gas.",
      state: states.pay,
      blockedReason: "Add funds first: your first deposit opens your escrow.",
      content:
        stage === "bind" ? (
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="text-body-13 text-02">To pay, {agentName} makes its own payment key. Run this on its machine:</p>
            <CodeBlock title="Terminal" code={BIND_COMMAND} />
            <Listening>Waiting for the key. This updates by itself.</Listening>
            {!facts.capsSet ? (
              <Button type="button" variant="secondary" className="self-start" onClick={() => setSheet("caps")}>
                Set safety caps now
              </Button>
            ) : null}
          </div>
        ) : stage === "caps" && !facts.keyBound && facts.needsDelegation ? (
          <div className="flex min-w-0 flex-col gap-2.5">
            <Button type="button" className="self-start" onClick={() => setSheet("caps")}>
              Set safety caps
            </Button>
            <p className="text-body-13 text-02">Then run this on {agentName}&apos;s machine so it gets its payment key:</p>
            <CodeBlock title="Terminal" code={BIND_COMMAND} />
          </div>
        ) : stage === "caps" && !facts.needsDelegation ? (
          <Button type="button" onClick={() => setSheet("caps")}>
            Set safety caps
          </Button>
        ) : (
          <Button type="button" onClick={() => setSheet("pay")}>
            Let {agentName} pay
          </Button>
        ),
    },
  ];

  return (
    <>
      <SetupChecklist
        title="Get started"
        description="Four steps to your agent's first paid call. Free calls work after step 2."
        steps={steps}
        loading={loading}
        expandedId={expanded}
        onExpandedChange={setExpanded}
        doneTitle="All set: your agent can call tools and pay for them"
        doneDescription="Watch its calls under Activity. Change its caps under Controls."
        onDismiss={
          placement === "overview"
            ? () => {
                try {
                  window.localStorage.setItem(DISMISS_KEY, "1");
                } catch {
                  // Not remembered; hidden for this visit.
                }
                setDismissed(true);
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
