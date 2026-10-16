"use client";

import { Plus } from "lucide-react";
import * as React from "react";

import { SectionTabs } from "@/components/layout/section-tabs";
import { CapMeter } from "@/components/patterns/cap-meter";
import { EffectiveLimit } from "@/components/patterns/effective-limit";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { CopyChip } from "@/components/patterns/copy-chip";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { STATUS_CHIPS, StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { UtcTime } from "@/components/patterns/utc-time";
import { MoneyFlow, MoneySplit } from "@/components/patterns/money-flow";
import { PageState, Skeleton } from "@/components/patterns/page-state";
import { PresetChips } from "@/components/patterns/preset-chips";
import { ChecklistPill, SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { CostBadge, SignAction, WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { GLOSSARY_KEYS } from "@/libs/glossary";
import { plain, plainError, plainRule } from "@/libs/plain-language";
import { cn } from "@/utils";
import { formatDecimal, parseAmountInput } from "@/utils/money";

/**
 * Kitchen-sink group 08: the shared UX patterns (components/patterns), every
 * state each one has. The wallet steps here are simulated with timers; one of
 * them can be set to decline so the rejection path is visible.
 */

function Spec({ name, children, className }: { name: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-03">{name}</span>
      <div className="flex w-full flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const usd = (dollars: string) => ({ amount: String(Math.round(Number(dollars) * 1e6)), asset: "demo", decimals: 6 });

function rejection() {
  return Object.assign(new Error("User rejected the request."), { code: 4001 });
}

/** Module scope on purpose: the simulated wallet declines the 2nd signature once per run. */
const declineSecond = { current: true };

function demoSteps(): WalletStep[] {
  return [
    { id: "approve", label: "Allow Assay to move $20.00 USDG", cost: "gas", run: () => wait(900) },
    {
      id: "deposit",
      label: "Deposit $20.00",
      cost: "gas",
      run: async () => {
        await wait(900);
        if (declineSecond.current) {
          declineSecond.current = false;
          throw rejection();
        }
        return { explorerUrl: "https://explorer.example/tx/0xabc" };
      },
    },
  ];
}

function ChecklistDemo() {
  const [done, setDone] = React.useState(1);
  const state = (i: number): SetupStep["state"] => (i < done ? "done" : i === done ? "current" : "todo");
  const steps: SetupStep[] = [
    { id: "wallet", title: "Link a wallet", state: state(0) },
    {
      id: "agent",
      title: "Create an agent",
      description: "An agent is what calls tools on your behalf.",
      state: state(1),
      content: (
        <Button size="sm" onClick={() => setDone(2)}>
          Create agent
        </Button>
      ),
    },
    {
      id: "connect",
      title: "Connect it to your MCP client",
      state: done < 2 ? "blocked" : state(2),
      blockedReason: "Needs an agent first.",
      content: (
        <Button size="sm" onClick={() => setDone(3)}>
          Copy mcp.json
        </Button>
      ),
    },
    {
      id: "call",
      title: "Make a first call",
      state: state(3),
      content: (
        <Button size="sm" onClick={() => setDone(4)}>
          Simulate a call
        </Button>
      ),
    },
    { id: "fund", title: "Add funds", state: "todo", optional: true },
  ];
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-2">
      <ChecklistPill label="Get started" steps={steps} href="#" className="self-start" />
      <SetupChecklist title="Get started" description="Four steps to your agent's first verified call." steps={steps} onDismiss={() => setDone(1)} />
      <button type="button" className="self-start text-label-xs text-03 underline" onClick={() => setDone(done >= 4 ? 1 : done + 1)}>
        Advance the data (simulated)
      </button>
    </div>
  );
}

export function PatternsGallery() {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);
  const [toolId, setToolId] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");
  const [cap, setCap] = React.useState("20");
  const capCheck = parseAmountInput(cap, { decimals: 6, min: "1" });
  const [stepsKey, setStepsKey] = React.useState(0);
  const [now] = React.useState(() => Date.now());
  const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();

  return (
    <>
      <Spec name="setup-checklist · live steps, inline actions, collapses to all set">
        <ChecklistDemo />
      </Spec>

      <Spec name="setup-checklist · loading (never a false 0 of 4)">
        <SetupChecklist
          className="max-w-[560px]"
          loading
          title="Get started"
          steps={[
            { id: "a", title: "A", state: "todo" },
            { id: "b", title: "B", state: "todo" },
            { id: "c", title: "C", state: "todo" },
          ]}
        />
      </Spec>

      <Spec name="sign-action · two signatures; the 2nd declines once, then try again resumes">
        <div key={stepsKey} className="w-full max-w-[420px] rounded-xl border border-01 bg-01 p-4">
          <SignAction
            label="Deposit $20.00"
            steps={demoSteps()}
            successTitle="Deposit sent"
            successDescription="It shows in your balance within a minute."
            doneAction={{
              label: "Run again",
              onClick: () => {
                declineSecond.current = true;
                setStepsKey((k) => k + 1);
              },
            }}
          />
        </div>
        <div className="w-full max-w-[420px] rounded-xl border border-01 bg-01 p-4">
          <SignAction
            label="Save caps"
            steps={[{ id: "caps", label: "Save caps", cost: "free", run: () => wait(700) }]}
            successTitle="Caps saved"
          />
        </div>
        <div className="w-full max-w-[420px] rounded-xl border border-01 bg-01 p-4">
          <SignAction
            label="Withdraw"
            disabled
            disabledReason="Nothing to withdraw yet: your balance is $0.00."
            steps={[{ id: "w", label: "Withdraw", cost: "gas", run: () => wait(500) }]}
          />
        </div>
        <div className="flex w-full max-w-[420px] items-center gap-2 rounded-xl border border-01 bg-01 p-4">
          <span className="text-body-13 text-02">Cost badges:</span>
          <CostBadge cost="free" />
          <CostBadge cost="gas" />
        </div>
      </Spec>

      <Spec name="wallet-action-sheet · preset amount + sign, refuses to close mid-signature">
        <Button onClick={() => setSheetOpen(true)}>Set safety caps</Button>
        <WalletActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Set safety caps"
          description={capCheck.value ? `Your agents can spend at most ${formatDecimal(capCheck.value)} a day from escrow.` : "Choose how much your agents can spend a day from escrow."}
          label="Sign and save"
          resetKey={cap}
          disabled={Boolean(capCheck.error)}
          disabledReason={capCheck.error}
          steps={[{ id: "caps", label: "Save caps on chain", cost: "gas", run: () => wait(1200) }]}
          successTitle="Caps saved"
          doneAction={{ label: "Close", onClick: () => setSheetOpen(false) }}
        >
          <PresetChips
            label="Daily cap"
            presets={["5", "20", "50"]}
            value={cap}
            onChange={setCap}
            error={cap ? capCheck.error : null}
            hint="You can change this at any time."
          />
        </WalletActionSheet>
        <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>
          Request a withdrawal
        </Button>
        <WalletActionSheet
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          title="Request a withdrawal of $20.00?"
          description="The money leaves escrow after about an hour. Paid calls pause until then."
          changes={[
            { label: "Escrow", before: "$20.00", after: "$0.00" },
            { label: "Paid calls", before: "Allowed", after: "Paused" },
          ]}
          acknowledge="I understand my agents cannot pay until the withdrawal completes"
          label="Request withdrawal"
          steps={[{ id: "req", label: "Request withdrawal", cost: "free", run: () => wait(900) }]}
          successTitle="Withdrawal requested"
          doneAction={{ label: "Close", onClick: () => setWithdrawOpen(false) }}
        />
      </Spec>

      <Spec name="status-timeline · penalty lifecycle, next date highlighted (horizontal ≥ tablet, stacked below)">
        <div className="w-full max-w-[860px] rounded-xl border border-01 bg-01 p-5">
          <StatusTimeline
            steps={[
              { id: "p", label: "Proposed", state: "done", date: iso(-72) },
              { id: "d", label: "Disputed", state: "done", date: iso(-48) },
              { id: "r", label: "Arbiter decides", state: "current", date: iso(30), countdown: true, description: "The arbiter has 30 days." },
              { id: "e", label: "Executed or cancelled", state: "upcoming", dateLabel: "after the ruling" },
            ]}
          />
        </div>
        <div className="w-full max-w-[860px] rounded-xl border border-01 bg-01 p-5">
          <StatusTimeline
            orientation="vertical"
            steps={[
              { id: "draft", label: "Draft", state: "done" },
              { id: "test", label: "Tested", state: "failed", description: "2 of 3 test calls failed the response shape." },
              { id: "live", label: "Live", state: "upcoming" },
              { id: "skip", label: "Paused", state: "skipped" },
            ]}
          />
        </div>
      </Spec>

      <Spec name="money-flow · not charged / charged">
        <MoneyFlow
          nodes={[
            { label: "Held", amount: "$0.10" },
            { label: "Check failed", tone: "danger" },
            { label: "Released", amount: "$0.10", tone: "teal", note: "back to your balance" },
          ]}
        />
        <MoneyFlow
          nodes={[
            { label: "Held", amount: "$0.10" },
            { label: "Check passed", tone: "success" },
            { label: "Charged", amount: "$0.10", tone: "primary" },
          ]}
        />
      </Spec>

      <Spec name="money-split · listed = charged + not charged; price → provider / fee; 60/30/10; empty">
        <div className="w-full max-w-[360px] rounded-xl border border-01 bg-01 p-4">
          <MoneySplit
            total={{ label: "Listed", amount: "$12.40" }}
            segments={[
              { label: "Charged", value: 11.2, amount: "$11.20", tone: "primary" },
              { label: "Not charged", value: 1.2, amount: "$1.20", tone: "teal" },
            ]}
          />
        </div>
        <div className="w-full max-w-[360px] rounded-xl border border-01 bg-01 p-4">
          <MoneySplit
            total={{ label: "Price per call", amount: "$0.0100" }}
            segments={[
              { label: "To you", value: 95, amount: "$0.0095", tone: "success" },
              { label: "Assay fee", value: 5, amount: "$0.0005", tone: "neutral" },
            ]}
          />
        </div>
        <div className="w-full max-w-[360px] rounded-xl border border-01 bg-01 p-4">
          <MoneySplit
            total={{ label: "Penalty", amount: "$30.00" }}
            segments={[
              { label: "Affected buyers", value: 60, amount: "$18.00", tone: "teal" },
              { label: "Reserve", value: 30, amount: "$9.00", tone: "indigo" },
              { label: "Assay", value: 10, amount: "$3.00", tone: "neutral" },
            ]}
          />
        </div>
        <div className="w-full max-w-[360px] rounded-xl border border-01 bg-01 p-4">
          <MoneySplit
            total={{ label: "Listed", amount: "$0.00" }}
            segments={[
              { label: "Charged", value: 0, amount: "$0.00", tone: "primary" },
              { label: "Not charged", value: 0, amount: "$0.00", tone: "teal" },
            ]}
          />
        </div>
      </Spec>

      <Spec name="status-chip · the shared state vocabulary">
        {(Object.keys(STATUS_CHIPS) as StatusChipKey[]).map((key) => (
          <StatusChip key={key} status={key} />
        ))}
        <StatusChip status="needs-you" detail="3" />
      </Spec>

      <Spec name="entity-picker · search by name, never by id">
        <div className="w-full max-w-[360px]">
          <EntityPicker
            label="Tool"
            value={toolId}
            onChange={(id) => setToolId(id)}
            options={[
              { id: "06399979-f8b8-4c9e-a9b1-bd2a5924d442", label: "search_web", detail: "3 providers" },
              { id: "1a2b3c4d-0000-4000-8000-000000000001", label: "get_token_price", detail: "1 provider" },
              { id: "1a2b3c4d-0000-4000-8000-000000000002", label: "scrape_url", detail: "2 providers" },
              { id: "1a2b3c4d-0000-4000-8000-000000000003", label: "deep_research", detail: "no provider live", disabled: true },
            ]}
          />
        </div>
      </Spec>

      <Spec name="cap-meter · ok / high / full / over / not set">
        {[
          ["1.54", "2.00"],
          ["1.80", "2.00"],
          ["2.00", "2.00"],
          ["2.10", "2.00"],
        ].map(([used, limit]) => (
          <div key={used} className="w-full max-w-[320px] rounded-xl border border-01 bg-01 p-4">
            <CapMeter label="Today" used={usd(used!)} limit={usd(limit!)} refillsAt={iso(2.3)} />
          </div>
        ))}
        <div className="w-full max-w-[320px] rounded-xl border border-01 bg-01 p-4">
          <CapMeter label="Per day" used={usd("0")} limit={null} />
        </div>
      </Spec>

      <Spec name="effective-limit · lowest of budget, agent permission, safety caps">
        <div className="w-full max-w-[420px]">
          <EffectiveLimit
            title="What prod can spend"
            rows={[
              {
                id: "call",
                label: "Per call",
                sources: [
                  { source: "Budget", value: usd("10") },
                  { source: "Agent permission", value: usd("0.5") },
                  { source: "Safety caps", value: usd("1") },
                ],
              },
              {
                id: "day",
                label: "Per day",
                sources: [
                  { source: "Budget", value: usd("10"), used: usd("8.25") },
                  { source: "Agent permission", value: usd("40"), used: usd("15.75") },
                  { source: "Safety caps", value: usd("20"), used: usd("3.4") },
                ],
              },
            ]}
            footer="The lowest limit wins."
          />
        </div>
        <div className="w-full max-w-[420px]">
          <EffectiveLimit
            title="What staging can spend"
            rows={[{ id: "call", label: "Per call", sources: [{ source: "Budget", value: null }] }]}
            stopped="All paid calls are paused, so this agent can spend nothing until you resume."
          />
        </div>
      </Spec>

      <Spec name="page-state · loading / empty / error / blocked">
        <div className="w-full max-w-[420px]">
          <PageState kind="loading" rows={3} label="Loading your agents" />
        </div>
        <PageState
          className="max-w-[420px]"
          kind="empty"
          title="No agents yet"
          description="An agent is what calls tools on your behalf. Create one to get a key."
          action={{ label: "Create an agent", icon: <Plus aria-hidden="true" />, onClick: () => {} }}
        />
        <PageState
          className="max-w-[420px]"
          kind="error"
          description={plainError("ERR_NETWORK")}
          onRetry={() => {}}
          code="ERR_NETWORK"
          details="Network Error at GET /api/v1/balances"
        />
        <PageState
          className="max-w-[420px]"
          kind="blocked"
          title="Paid calls are paused"
          description="A withdrawal is in progress. Calls resume when it completes, or cancel it."
          action={{ label: "View withdrawal", href: "#" }}
        />
        <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-xl border border-01 bg-01 p-4">
          <span className="text-body-13 text-02">Skeleton, for a custom loading shape:</span>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Spec>

      <Spec name="confirm-sheet · names the object, before → after, acknowledgement">
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Pause all agents
        </Button>
        <ConfirmSheet
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Pause all 3 agents?"
          description="They stop paying for calls at once. Free calls still work. You can resume them here any time."
          changes={[
            { label: "Paid calls", before: "Allowed", after: "Paused" },
            { label: "Daily budget", before: "$20.00", after: "$0.00" },
          ]}
          acknowledge="I understand my agents will stop paying for tools"
          confirmLabel="Pause all agents"
          onConfirm={() => wait(800)}
        />
      </Spec>

      <Spec name="preset-chips · empty by default, Custom opens a field">
        <div className="w-full max-w-[420px]">
          <PresetChips
            label="Deposit amount"
            presets={["5", "20", "50"]}
            value={amount}
            onChange={setAmount}
            hint={amount ? `You will deposit $${amount}.` : "Pick an amount or choose Custom."}
          />
        </div>
      </Spec>

      <Spec name="term · glossary tooltip (hover, focus or tap)">
        <p className="max-w-[560px] text-body-sm text-02">
          Your <Term k="escrow">escrow</Term> pays a <Term k="binding">listing</Term> only when the{" "}
          <Term k="verdict">verdict</Term> is a pass. A failing provider risks its <Term k="stake">stake</Term> through a{" "}
          <Term k="slash">penalty</Term>, which it can <Term k="dispute">dispute</Term> before the{" "}
          <Term k="arbiter">arbiter</Term>.
        </p>
        <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-body-xs text-02">
          {GLOSSARY_KEYS.map((key) => (
            <Term key={key} k={key} />
          ))}
        </div>
      </Spec>

      <Spec name="copy-chip · utc-time">
        <CopyChip value="06399979-f8b8-4c9e-a9b1-bd2a5924d442" label="call id" />
        <CopyChip value="0x83ab1234567890abcdef1234567890abcdef2913" label="wallet address" />
        <span className="text-body-13 text-02">
          Created <UtcTime value={iso(-0.5)} /> · expires <UtcTime value={iso(50)} />
        </span>
      </Spec>

      <Spec name="section-tabs">
        <div className="w-full max-w-[560px]">
          <SectionTabs
            activeId="calls"
            tabs={[
              { id: "spend", label: "Spend", href: "#spend" },
              { id: "calls", label: "Calls", href: "#calls" },
              { id: "not-charged", label: "Not charged", href: "#not-charged" },
            ]}
            linkAs="a"
          />
        </div>
      </Spec>

      <Spec name="plain-language">
        <ul className="flex flex-col gap-1 text-body-13 text-02">
          <li>
            <code className="font-mono text-mono-12 text-03">MIN_ARRAY_LENGTH {"{min:3}"}</code> → {plainRule("MIN_ARRAY_LENGTH", { min: 3 })}
          </li>
          <li>
            <code className="font-mono text-mono-12 text-03">quorum_failures_at_least</code> → {plain("quorum_failures_at_least")}
          </li>
          <li>
            <code className="font-mono text-mono-12 text-03">PAYMENT_VOUCHER_ADMISSION_PAUSED</code> →{" "}
            {plainError("PAYMENT_VOUCHER_ADMISSION_PAUSED")}
          </li>
          <li>
            <code className="font-mono text-mono-12 text-03">credential.revoked</code> → {plain("credential.revoked")}
          </li>
        </ul>
      </Spec>
    </>
  );
}
