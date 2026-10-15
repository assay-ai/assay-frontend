"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { CopyChip, shortId } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { SignOrExport } from "@/components/patterns/sign-or-export";
import type { WalletStep } from "@/components/patterns/sign-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { refusalsById, refusalsOf } from "@/features/chain-calls/refusals";
import { connectedSpelling, sendSlashContractCall } from "@/features/chain-calls/send-contract-call";
import {
  ARBITER_NOTE_MIN,
  ARBITER_SELECTION_MAX,
  RULING_REASONS,
  arbiterErrorMessage,
  beneficiaryCheck,
  disputeAmount,
  durationText,
  mayBlockOnChain,
  mayRule,
  pruneArbiterSelection,
  selectionChain,
  toggleArbiterSelection,
  validateRulingForm,
} from "@/features/operator/arbiter";
import { BLOCK_NOTE_MAX } from "@/features/operator/blocks";
import { DisputeProgress } from "@/features/operator/dispute-line";
import { sortDisputesByDaysLeft } from "@/features/operator/inbox";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { mayBlock } from "@/features/operator/blocks";
import { useProviderNames } from "@/features/operator/use-operator-lookups";
import { useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import type { ArbiterDispute, ArbiterRuling, ArbiterTerms, ChainStateHealth } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { sameEvmAddress } from "@/libs/chains/evm/contract-call";
import { ROBINHOOD_TESTNET_STAKE, explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { routes } from "@/libs/routes";
import { createArbiterRulingIntent, getArbiterTerms, getPlatformHealth, listArbiterDisputes } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * Arbiter, route `/operator/arbiter` (assay-evm D-19).
 *
 * A provider disputes a pending penalty on chain; only the arbiter rules:
 * uphold (the penalty executes) or cancel (the stake is released). Unruled
 * for 30 days, anyone can expire it. Each dispute is a card with its 30-day
 * bar, the evidence in one line and two buttons. The ruling sheet takes a
 * reason chip and a note, then signs in the same step when this browser holds
 * the arbiter's wallet — otherwise it downloads a Safe batch. Several disputes
 * can be ruled in one transaction.
 *
 * `?focus=<requestId>` or `?case=<proposalId>` scrolls to one dispute.
 *
 * [backend] A "Routine cancels" list (CANCEL_REQUESTED records) needs a list
 * endpoint; each one is reachable from its penalty page meanwhile.
 */

const FALLBACK_CHAIN = ROBINHOOD_TESTNET_STAKE.chainId;

function ArbiterScreen() {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const canRule = mayRule(me.roles);
  const canBlock = mayBlock(me.roles);
  const providers = useProviderNames();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus")?.toLowerCase() ?? null;
  const focusCase = searchParams.get("case");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const health = useQuery({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, retry: 0 });
  const chainStates: readonly ChainStateHealth[] = React.useMemo(() => health.data?.chainState ?? [], [health.data]);
  const chainIds = React.useMemo(() => {
    const ids = chainStates.map((state) => state.chainId);
    return ids.length > 0 ? ids : [FALLBACK_CHAIN];
  }, [chainStates]);
  const [chosenChain, setChosenChain] = React.useState<string | null>(null);
  const chainId = chosenChain && chainIds.includes(chosenChain) ? chosenChain : chainIds[0]!;
  const chainState = chainStates.find((state) => state.chainId === chainId) ?? null;

  const terms = useQuery({ queryKey: ["operator", "arbiter", "terms", chainId], queryFn: () => getArbiterTerms(chainId), retry: 0 });
  const disputes = useQuery({ queryKey: ["operator", "arbiter", "disputes"], queryFn: listArbiterDisputes, refetchInterval: 60_000, retry: 0 });
  const rows = React.useMemo(() => sortDisputesByDaysLeft(disputes.data ?? []), [disputes.data]);

  const connected = useConnectedAddresses();
  const arbiter = terms.data?.arbiter ?? null;
  const arbiterConnected = arbiter !== null && connected.some((address) => sameEvmAddress(address, arbiter));

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = React.useState<string | null>(null);
  React.useEffect(() => setSelected((current) => pruneArbiterSelection(current, rows)), [rows]);
  const [ruling, setRuling] = React.useState<{ kind: ArbiterRuling; ids: string[] } | null>(null);
  const [rowRefusals, setRowRefusals] = React.useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  const [result, setResult] = React.useState<{ title: string; hash: string | null; chainId: string } | null>(null);

  // Land on the dispute a link named.
  React.useEffect(() => {
    if (!disputes.data) return;
    const row = rows.find((r) => r.requestId.toLowerCase() === focus || (focusCase && r.proposalId === focusCase));
    if (row) document.getElementById(`dispute-${row.requestId}`)?.scrollIntoView({ block: "center" });
  }, [disputes.data, rows, focus, focusCase]);

  const toggle = (row: ArbiterDispute) => {
    const next = toggleArbiterSelection(selected, row, rows);
    setSelected(next.selected);
    setNotice(
      next.ok
        ? null
        : next.reason === "limit"
          ? `At most ${ARBITER_SELECTION_MAX} penalties go into one transaction.`
          : "One transaction is on one chain. Clear the selection to pick a penalty on another chain.",
    );
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "arbiter"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "health"] });
  };

  const rowsById = new Map(rows.map((row) => [row.requestId.toLowerCase(), row]));
  const openRuling = (kind: ArbiterRuling, ids: string[]) => {
    setRowRefusals(new Map());
    setRuling({ kind, ids });
  };

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Arbiter</h1>
          <p className="text-body-13 text-03">Rule on disputed penalties before their 30 days run out. Fewest days left first.</p>
        </div>
        {chainIds.length > 1 ? (
          <Select label="Chain" value={chainId} onChange={(e) => setChosenChain(e.target.value)}>
            {chainIds.map((id) => (
              <option key={id} value={id}>
                {stakeDeploymentFor(id)?.displayName ?? id}
              </option>
            ))}
          </Select>
        ) : null}
      </header>

      <ArbiterStatus
        terms={terms.data}
        termsError={terms.isError ? terms.error : null}
        chainState={chainState}
        arbiterConnected={arbiterConnected}
        onRetry={() => void terms.refetch()}
      />

      {!canRule ? (
        <p className="w-full rounded-lg border border-01 bg-01 px-3.5 py-2.5 text-body-13 text-02">
          You can read the disputes. Ruling needs a Lead adjudicator or Treasury.
        </p>
      ) : null}

      {result ? (
        <ResultCard
          title={result.title}
          next="The penalties move once the chain watcher sees the transaction, usually within a minute."
          txUrl={result.hash && stakeDeploymentFor(result.chainId) ? explorerTxLink(stakeDeploymentFor(result.chainId)!, result.hash) : null}
          activityHref="/operator/override-log?kind=arbiter"
          onDismiss={() => setResult(null)}
        />
      ) : null}

      {canRule && selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex w-full flex-wrap items-center gap-2 rounded-xl border border-primary-20 bg-primary-10 px-3.5 py-2.5 shadow-soft">
          <span className="mr-auto text-label-13 text-01" aria-live="polite">
            {selected.size} selected
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openRuling("CANCEL", [...selected])}>
            Cancel {selected.size}
          </Button>
          <Button size="sm" variant="danger" onClick={() => openRuling("UPHOLD", [...selected])}>
            Uphold {selected.size}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p className="text-body-xs text-warning-700" role="status">
          {notice}
        </p>
      ) : null}

      {disputes.isLoading ? (
        <PageState kind="loading" rows={3} label="Loading disputes" />
      ) : disputes.isError ? (
        <PageState
          kind="error"
          description={arbiterErrorMessage(disputes.error, "disputes").replace(/\s*\([A-Z_]+\)$/, "")}
          onRetry={() => void disputes.refetch()}
          code={disputes.error instanceof ApiError ? disputes.error.code : null}
        />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title="Nothing to rule on" description="No penalty is disputed on chain. A new dispute appears here within a minute of the provider filing it." />
      ) : (
        <ul className="flex w-full flex-col gap-2.5">
          {rows.map((row) => (
            <DisputeCard
              key={row.requestId}
              row={row}
              providerName={providers.name(row.providerId)}
              now={now}
              canRule={canRule}
              canBlock={canBlock}
              selected={selected.has(row.requestId.toLowerCase())}
              focused={row.requestId.toLowerCase() === focus || (focusCase !== null && row.proposalId === focusCase)}
              refusals={rowRefusals.get(row.requestId.toLowerCase()) ?? []}
              onToggle={() => toggle(row)}
              onRule={(kind) => openRuling(kind, [row.requestId.toLowerCase()])}
            />
          ))}
        </ul>
      )}

      {mayBlockOnChain(me.roles) ? (
        <p className="text-body-xs text-03">
          To block a wallet on chain, block it on{" "}
          <Link href="/operator/blocks" className="text-primary-600 hover:underline">
            Blocks
          </Link>{" "}
          and turn on &ldquo;also block on chain&rdquo;.
        </p>
      ) : null}

      {canRule ? (
        <RulingSheet
          ruling={ruling}
          rows={ruling ? ruling.ids.map((id) => rowsById.get(id)).filter((r): r is ArbiterDispute => Boolean(r)) : []}
          providerName={providers.name}
          arbiter={arbiter}
          chainForSelection={ruling ? selectionChain(new Set(ruling.ids), rows) : null}
          onClose={() => setRuling(null)}
          onRefused={setRowRefusals}
          onDone={(title, hash, chain) => {
            setResult({ title, hash, chainId: chain });
            setSelected(new Set());
            setRuling(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

// ── The status strip ────────────────────────────────────────────────────────

function ArbiterStatus({
  terms,
  termsError,
  chainState,
  arbiterConnected,
  onRetry,
}: {
  terms: ArbiterTerms | undefined;
  termsError: unknown;
  chainState: ChainStateHealth | null;
  arbiterConnected: boolean;
  onRetry: () => void;
}) {
  if (termsError) {
    return (
      <PageState
        kind="error"
        title="The chain's terms could not be read"
        description={arbiterErrorMessage(termsError, "terms").replace(/\s*\([A-Z_]+\)$/, "")}
        onRetry={onRetry}
        code={termsError instanceof ApiError ? termsError.code : null}
      />
    );
  }
  if (!terms) return <PageState kind="loading" rows={1} label="Reading the chain's terms" />;

  const lagMin = chainState?.lagSeconds != null ? Math.round(chainState.lagSeconds / 60) : null;
  const parts: { ok: boolean; text: string }[] = [
    terms.arbiter === null
      ? { ok: false, text: "No arbiter appointed" }
      : arbiterConnected
        ? { ok: true, text: "Arbiter wallet connected" }
        : { ok: true, text: `Arbiter is ${shortId(terms.arbiter)} (not this browser: you download a Safe batch)` },
    chainState === null
      ? { ok: true, text: "Indexer not reported" }
      : chainState.stale
        ? { ok: false, text: lagMin === null ? "Indexer has not caught up" : `Indexer ${lagMin} min behind` }
        : { ok: true, text: "Indexer up to date" },
    terms.paused ? { ok: false, text: "Contracts paused" } : { ok: true, text: "Contracts running" },
  ];
  const red = parts.some((p) => !p.ok);

  return (
    <details className={cn("group w-full rounded-lg border", red ? "border-warning-20 bg-warning-10" : "border-01 bg-01")}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-body-13">
        {arbiterConnected ? (
          <Wallet aria-hidden="true" className="size-4 shrink-0 text-success-500" />
        ) : red ? (
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-warning-600" />
        ) : (
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success-500" />
        )}
        <span className="min-w-0 flex-1 text-02">
          {parts.map((part, index) => (
            <React.Fragment key={part.text}>
              {index > 0 ? " · " : ""}
              <span className={part.ok ? undefined : "text-warning-700"}>{part.text}</span>
            </React.Fragment>
          ))}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-03 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-2.5 border-t border-01 px-3.5 py-3 text-body-13 min-[480px]:grid-cols-2 desktop:grid-cols-3">
        <Fact label="Dispute window">{durationText(terms.slashDelaySeconds)}</Fact>
        <Fact label="Time to rule">30 days from the dispute</Fact>
        <Fact label="Agents' share of a penalty">{`${terms.slashAgentBps / 100}%`}</Fact>
        <Fact label="Arbiter">{terms.arbiter ? <CopyChip value={terms.arbiter} label="arbiter address" /> : "None"}</Fact>
        <Fact label="Admin">
          <CopyChip value={terms.admin} label="admin address" />
        </Fact>
        <Fact label="Chain">{stakeDeploymentFor(terms.chainId)?.displayName ?? terms.chainId}</Fact>
        {chainState ? (
          <>
            <Fact label="Blocked on chain">{String(chainState.blockedCount)}</Fact>
            <Fact label="Last reconciled">{chainState.reconciledAt ? <LocalTime value={chainState.reconciledAt} /> : "never"}</Fact>
          </>
        ) : null}
      </dl>
    </details>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="min-w-0 text-01">{children}</dd>
    </div>
  );
}

// ── One dispute ─────────────────────────────────────────────────────────────

function DisputeCard({
  row,
  providerName,
  now,
  canRule,
  canBlock,
  selected,
  focused,
  refusals,
  onToggle,
  onRule,
}: {
  row: ArbiterDispute;
  providerName: string;
  now: number;
  canRule: boolean;
  canBlock: boolean;
  selected: boolean;
  focused: boolean;
  refusals: readonly string[];
  onToggle: () => void;
  onRule: (kind: ArbiterRuling) => void;
}) {
  const amount = disputeAmount(row.chainId, row.penaltyAmount);
  const check = beneficiaryCheck(row);
  const evidence = row.beneficiaryEvidence;
  const paid = evidence ? disputeAmount(row.chainId, evidence.paidAmount) : null;
  const share = evidence ? disputeAmount(row.chainId, evidence.shareAmount) : null;
  const checkboxId = `select-${row.requestId}`;

  return (
    <li
      id={`dispute-${row.requestId}`}
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-01 p-4",
        selected ? "border-primary-500" : "border-01",
        focused && "ring-2 ring-primary-500",
      )}
    >
      <div className="flex w-full min-w-0 items-start gap-3">
        {canRule ? (
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-primary-600"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${providerName}'s penalty for a combined ruling`}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-body-sm text-01">
            <span className="font-medium">{providerName}</span> · <span className="font-mono">{amount ? formatMoney(amount) : "penalty"}</span>
            {row.disputedAt ? (
              <span className="text-03">
                {" "}
                · disputed <LocalTime value={row.disputedAt} />
              </span>
            ) : null}
          </p>
          <DisputeProgress row={row} now={now} />
        </div>
      </div>

      <p className="text-body-13 text-02">
        {evidence ? (
          <>
            {evidence.failedCalls} failed call{evidence.failedCalls === 1 ? "" : "s"}
            {paid ? `, ${formatMoney(paid)} paid for them` : ""}
          </>
        ) : (
          "Payments for the failed calls not matched"
        )}
        {" · "}
        {row.upheldViolations30d === 0 ? "no penalty upheld in the last 30 days" : `${row.upheldViolations30d} upheld in the last 30 days`}
        {share ? ` · agents get ${formatMoney(share)} if upheld` : ""}
      </p>

      <details className={cn("rounded-md border px-3 py-2", check.status === "ok" ? "border-01 bg-02" : check.status === "failed" ? "border-danger-20 bg-danger-10" : "border-warning-20 bg-warning-10")}>
        <summary className={cn("cursor-pointer select-none text-label-13", check.status === "ok" ? "text-02" : check.status === "failed" ? "text-danger-700" : "text-warning-700")}>
          Who gets paid: {check.status === "ok" ? "checked" : check.status === "failed" ? "check fails" : "not checked"}
        </summary>
        <p className="mt-1.5 text-body-13 text-02">{check.headline}</p>
        {check.reason ? <p className="mt-1 text-body-13 text-danger-700">{check.reason}</p> : null}
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-body-xs text-03">
          Beneficiary <CopyChip value={row.beneficiary} label="beneficiary" /> · request <CopyChip value={row.requestId} label="request id" />
        </p>
      </details>

      {refusals.length > 0 ? (
        <div role="alert" className="flex flex-col gap-0.5 rounded-md border border-danger-20 bg-danger-10 px-3 py-2">
          {refusals.map((text) => (
            <p key={text} className="text-body-13 text-danger-700">
              {text}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-center">
        <div className="flex gap-2 tablet:mr-auto">
          <Button variant="ghost" size="sm" asChild>
            <Link href={routes.operatorCase(row.proposalId)}>Open penalty</Link>
          </Button>
          {canBlock ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/operator/blocks?block=${encodeURIComponent(row.providerId)}&kind=ORGANIZATION`}>Block this provider</Link>
            </Button>
          ) : null}
        </div>
        {canRule ? (
          <>
            <Button variant="secondary" onClick={() => onRule("CANCEL")} className="w-full tablet:w-auto">
              Cancel penalty
            </Button>
            <Button variant="danger" onClick={() => onRule("UPHOLD")} className="w-full tablet:w-auto">
              Uphold penalty
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

// ── The ruling sheet: reason + note, then sign (or export) in one step ─────

function RulingSheet({
  ruling,
  rows,
  providerName,
  arbiter,
  chainForSelection,
  onClose,
  onRefused,
  onDone,
}: {
  ruling: { kind: ArbiterRuling; ids: string[] } | null;
  rows: ArbiterDispute[];
  providerName: (id: string) => string;
  arbiter: string | null;
  chainForSelection: string | null;
  onClose: () => void;
  onRefused: (refusals: ReadonlyMap<string, readonly string[]>) => void;
  onDone: (title: string, hash: string | null, chainId: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const kind = ruling?.kind ?? "CANCEL";
  const chainId = chainForSelection ?? FALLBACK_CHAIN;

  const rulingKey = ruling ? `${ruling.kind}:${ruling.ids.join(",")}` : "";
  React.useEffect(() => {
    setReason("");
    setNote("");
    setTicket("");
  }, [rulingKey]);

  const connected = useConnectedAddresses();
  const signerState = useSigner({ chainId, address: arbiter ? connectedSpelling(connected, arbiter) : undefined });
  const canSign = arbiter !== null && signerState.status === "ready" && sameEvmAddress(signerState.signer.address, arbiter);

  const validated = validateRulingForm({ ruling: kind, reasonCode: reason, note, ticketRef: ticket }, chainForSelection, ruling?.ids ?? []);
  const notReady = !validated.ok
    ? reason === ""
      ? "Pick a reason first."
      : note.trim().length < ARBITER_NOTE_MIN
        ? `Write at least ${ARBITER_NOTE_MIN} characters in the note.`
        : (Object.values(validated.errors)[0] ?? "Check the form.")
    : null;

  const prepare = async () => {
    if (!validated.ok) throw new Error(notReady ?? "Check the form.");
    try {
      return await createArbiterRulingIntent(validated.body);
    } catch (error) {
      const refused = refusalsOf(error);
      if (refused && refused.length > 0) onRefused(refusalsById(refused, "arbiter"));
      throw error;
    }
  };

  const total = rows.reduce((sum, row) => sum + BigInt(/^\d+$/.test(row.penaltyAmount) ? row.penaltyAmount : "0"), BigInt(0));
  const totalMoney = rows[0] ? disputeAmount(rows[0].chainId, total.toString()) : null;
  const count = rows.length;
  const noun = `${count} penalt${count === 1 ? "y" : "ies"}`;
  const title = kind === "UPHOLD" ? `Uphold ${count === 1 ? "this penalty" : noun}?` : `Cancel ${count === 1 ? "this penalty" : noun}?`;

  const steps: WalletStep[] = [
    {
      id: "rule",
      label: kind === "UPHOLD" ? `Uphold ${noun}` : `Cancel ${noun}`,
      cost: "gas",
      run: async ({ report }) => {
        if (signerState.status !== "ready") throw new Error("Connect the arbiter's wallet to sign here.");
        report({ stage: "preparing" });
        const call = await prepare();
        report({ stage: "wallet" });
        const hash = await sendSlashContractCall(call, signerState.signer);
        const deployment = stakeDeploymentFor(call.chainId);
        const explorerUrl = deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined;
        report({ stage: "submitted", data: hash, explorerUrl });
        return { data: hash, explorerUrl };
      },
    },
  ];

  const errorText = (error: unknown) => arbiterErrorMessage(error, "ruling").replace(/\s*\([A-Z_]+\)$/, "");

  return (
    <Sheet open={ruling !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent showCloseButton>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription>
            {kind === "UPHOLD"
              ? `${count === 1 ? "The penalty becomes" : "The penalties become"} executable at once: anyone can then execute it and the stake${totalMoney ? ` (${formatMoney(totalMoney)})` : ""} is taken. It cannot be disputed again.`
              : `The reserved stake${totalMoney ? ` (${formatMoney(totalMoney)})` : ""} goes back to the provider${count === 1 ? "" : "s"}. Nothing is taken.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          <ul className="flex w-full flex-col rounded-lg border border-01">
            {rows.map((row) => {
              const amount = disputeAmount(row.chainId, row.penaltyAmount);
              return (
                <li key={row.requestId} className="flex items-center justify-between gap-3 border-b border-01 px-3 py-2 text-body-13 last:border-b-0">
                  <span className="min-w-0 truncate text-01">{providerName(row.providerId)}</span>
                  <span className="shrink-0 font-mono text-mono-12 text-02">{amount ? formatMoney(amount) : ""}</span>
                </li>
              );
            })}
          </ul>
          <ReasonChips
            label="Why"
            options={RULING_REASONS[kind]}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={ARBITER_NOTE_MIN}
            noteMax={BLOCK_NOTE_MAX}
            notePlaceholder="Why, and on what evidence. It is recorded in Activity."
          />
          <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="INC-123" maxLength={128} />
          <SignOrExport
            canSign={canSign}
            signerLabel={arbiter ? `the arbiter (${shortId(arbiter)})` : "the arbiter"}
            signLabel={kind === "UPHOLD" ? `Uphold and sign` : `Cancel and sign`}
            steps={steps}
            disabled={notReady !== null}
            disabledReason={notReady}
            describeError={errorText}
            onSigned={(results) => {
              const hash = results[results.length - 1]?.data;
              onDone(kind === "UPHOLD" ? `Upheld ${noun}` : `Cancelled ${noun}`, typeof hash === "string" ? hash : null, chainId);
            }}
            functionName={kind === "UPHOLD" ? "upholdSlashBatch" : "cancelSlashBatch"}
            chainId={chainId}
            prepare={async () => {
              const call = await prepare();
              return [{ to: call.to, value: call.value, data: call.data }];
            }}
            afterExport="Import the file in the Safe that holds the arbiter key and sign it there. The penalties move once it lands."
            details={rows.map((row) => ({ label: `${providerName(row.providerId)} request id`, value: row.requestId }))}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function ArbiterPage() {
  return (
    <React.Suspense fallback={null}>
      <ArbiterScreen />
    </React.Suspense>
  );
}
