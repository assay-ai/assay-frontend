"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Coins,
  Info,
  Lock,
  MoreHorizontal,
  PenLine,
  Undo2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { CopyChip, shortId } from "@/components/patterns/copy-chip";
import { useHandoff } from "@/components/patterns/handoff-record";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { SignOrExport } from "@/components/patterns/sign-or-export";
import type { WalletStep } from "@/components/patterns/sign-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  possessive,
  pruneArbiterSelection,
  rulingMissingText,
  rulingOutcome,
  selectionChain,
  toggleArbiterSelection,
  validateRulingForm,
} from "@/features/operator/arbiter";
import { ApprovedArbiterBlocks } from "@/features/operator/approved-arbiter-blocks";
import { callSummary } from "@/features/operator/call-summary";
import { BLOCK_NOTE_MAX, mayBlock } from "@/features/operator/blocks";
import { disputeUrgency, sortDisputesByDaysLeft } from "@/features/operator/inbox";
import { splitSharesText } from "@/features/operator/penalty-money";
import { ResultCard } from "@/features/operator/result-card";
import { useRulingFromLink } from "@/features/operator/ruling-link";
import { SupersededRecords } from "@/features/operator/superseded-records";
import { checkAction } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import { useProviderNames } from "@/features/operator/use-operator-lookups";
import { WhatHappens } from "@/features/operator/what-happens";
import { WhyNot } from "@/features/operator/why-not";
import { dropUrlParams } from "@/features/operator/url-params";
import { useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import type { Money } from "@/interfaces/api";
import type { ArbiterDispute, ArbiterRuling, ArbiterTerms, ChainStateHealth } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { sameEvmAddress } from "@/libs/chains/evm/contract-call";
import { assertContractCall, formatCallArg, type DecodedCall, type ExpectedCall } from "@/libs/chains/evm/signing-guard";
import { ROBINHOOD_TESTNET_STAKE, explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { routes } from "@/libs/routes";
import { createArbiterRulingIntent, getArbiterTerms, getPlatformHealth, listArbiterDisputes } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatClock } from "@/libs/utc-time";
import { formatMoney } from "@/utils/money";

import { Deadline } from "@/features/operator/deadline";

/**
 * Arbiter, route `/operator/arbiter` (assay-evm D-19).
 *
 * A provider disputes a pending penalty on chain; only the arbiter rules:
 * uphold (the penalty executes) or cancel (the stake is released). Unruled
 * for 30 days, anyone can expire it. The disputes are one flat list, fewest
 * days left first: who and how much, the deadline, the evidence in one line
 * and the payee check as a chip. Uphold and Cancel weigh the same in the list
 * — the list does not lean towards a verdict; the sheet says what each one
 * does with the money. The sheet takes a reason chip and a note, then signs in
 * the same step when this browser holds the arbiter's wallet — otherwise it
 * downloads the file for their Safe and copies a link for them. Several
 * disputes can be ruled in one transaction; upholding one whose payee check
 * did not pass needs an explicit acknowledgement.
 *
 * `?focus=<requestId>` or `?case=<proposalId>` scrolls to one dispute;
 * `&rule=cancel|uphold` also opens its ruling sheet.
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
  // Who may fetch an approved block's call (backend: ADJL, SRE, TRE). Support
  // (SRE) may download it for the arbiter's wallet; only that wallet signs.
  const canExportBlocks = mayBlockOnChain(me.roles);
  const blockWhy = checkAction(me, "block").why;
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
  // Once per link, not on every refresh.
  const scrolledTo = React.useRef<string | null>(null);
  React.useEffect(() => {
    const key = focus ?? focusCase;
    if (!key || scrolledTo.current === key) return;
    const row = rows.find((r) => r.requestId.toLowerCase() === focus || (focusCase && r.proposalId === focusCase));
    if (!row) return;
    scrolledTo.current = key;
    document.getElementById(`dispute-${row.requestId}`)?.scrollIntoView({ block: "center" });
  }, [rows, focus, focusCase]);

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
  // "Cancel" / "Uphold" on a penalty page lands here with that dispute's sheet open.
  useRulingFromLink({ rows, proposalId: focusCase, rule: searchParams.get("rule"), canRule, open: openRuling });
  // A link's `?case=…&rule=…` opened the sheet; closing it drops both, so Back
  // or a reload does not open it again (a plain `?case=` link keeps its highlight).
  const closeRuling = () => {
    setRuling(null);
    if (searchParams.has("rule")) dropUrlParams(["rule", "case"]);
  };
  const barOpen = canRule && (selected.size > 0 || notice !== null);
  const soonest = rows[0] ? disputeUrgency(rows[0], now) : null;

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h1 className="text-heading-md text-01">Arbiter</h1>
        <div className="flex flex-wrap items-center gap-3">
          {rows.length > 0 && soonest ? (
            <p className="text-body-13 tabular-nums text-03">
              {rows.length} dispute{rows.length === 1 ? "" : "s"} · {rows.length === 1 ? "" : "soonest "}
              {soonest.label.toLowerCase()}
            </p>
          ) : null}
          {chainIds.length > 1 ? (
            <Select label="Chain" value={chainId} onChange={(e) => setChosenChain(e.target.value)}>
              {chainIds.map((id) => (
                <option key={id} value={id}>
                  {stakeDeploymentFor(id)?.displayName ?? `Chain ${id.split(":")[1] ?? id}`}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </header>

      <ArbiterStatus
        terms={terms.data}
        termsError={terms.isError ? terms.error : null}
        chainState={chainState}
        arbiterConnected={arbiterConnected}
        onRetry={() => void terms.refetch()}
      />

      {!canRule ? (
        <WhyNot action="rule" me={me} ask="Can you rule on the disputed penalties on Arbiter? Some are getting close to their 30 days." />
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
        <ul className="flex w-full flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
          {rows.map((row) => (
            <DisputeRow
              key={row.requestId}
              row={row}
              providerName={providers.name(row.providerId)}
              now={now}
              canRule={canRule}
              canBlock={canBlock}
              blockWhy={blockWhy}
              selected={selected.has(row.requestId.toLowerCase())}
              focused={row.requestId.toLowerCase() === focus || (focusCase !== null && row.proposalId === focusCase)}
              refusals={rowRefusals.get(row.requestId.toLowerCase()) ?? []}
              onToggle={() => toggle(row)}
              onRule={(kind) => openRuling(kind, [row.requestId.toLowerCase()])}
            />
          ))}
        </ul>
      )}

      {/* Records of an earlier proposal that landed on chain late (review R2-6), and approved
          on-chain blocks (A-11) still to sign (review N5). Each section shows only when it has rows. */}
      <SupersededRecords canCancel={canRule} providerName={providers.name} onSent={refresh} />
      {canExportBlocks ? <ApprovedArbiterBlocks onSent={refresh} canRule={canRule} /> : null}

      {/* The selection's actions: a bar fixed to the bottom of the screen (above
          the phone's tab bar), out of the flow, so selecting never moves a row.
          The spacer keeps the last row scrollable above it. */}
      {barOpen ? (
        <>
          <div aria-hidden="true" className="h-16 w-full shrink-0" />
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-30 px-4 md:bottom-4 tablet:px-[26px]">
            <div
              role="region"
              aria-label="Selected disputes"
              className="pointer-events-auto mx-auto flex w-full max-w-[1148px] flex-col gap-1.5 rounded-xl border border-02 bg-01 px-3.5 py-2.5 shadow-lifted"
            >
              {selected.size > 0 ? (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <span className="mr-auto text-label-13 tabular-nums text-01" aria-live="polite">
                    {selected.size} selected
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="touch-target">
                    Clear
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openRuling("CANCEL", [...selected])} className="touch-target">
                    Cancel {selected.size}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openRuling("UPHOLD", [...selected])} className="touch-target">
                    Uphold {selected.size}
                  </Button>
                </div>
              ) : null}
              {notice ? (
                <p className="text-body-xs text-warning-700" role="status">
                  {notice}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {canRule ? (
        <RulingSheet
          ruling={ruling}
          rows={ruling ? ruling.ids.map((id) => rowsById.get(id)).filter((r): r is ArbiterDispute => Boolean(r)) : []}
          providerName={providers.name}
          chainForSelection={ruling ? selectionChain(new Set(ruling.ids), rows) : null}
          onClose={closeRuling}
          onRefused={setRowRefusals}
          onDone={(title, hash, chain) => {
            setResult({ title, hash, chainId: chain });
            setSelected(new Set());
            closeRuling();
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

// ── The status line ─────────────────────────────────────────────────────────

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
  // Only what is wrong is listed next to the signer; "all fine" stays under details.
  const problems = [
    ...(terms.arbiter === null ? ["No arbiter is appointed, so nobody can rule."] : []),
    ...(chainState?.stale ? [lagMin === null ? "The indexer has not caught up." : `The indexer is ${lagMin} min behind.`] : []),
    ...(terms.paused ? ["The contracts are paused."] : []),
  ];
  const signer =
    terms.arbiter === null
      ? null
      : arbiterConnected
        ? "The arbiter's wallet is connected here, so rulings are signed in this browser."
        : (
          <>
            Rulings are signed by the arbiter key <span className="font-mono text-mono-12">{shortId(terms.arbiter)}</span>. It isn&rsquo;t
            connected here, so each ruling downloads as a file to sign.
          </>
        );
  const warn = problems.length > 0;

  return (
    <details className={cn("group w-full rounded-lg border", warn ? "border-warning-20 bg-warning-10" : "border-01 bg-02")}>
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3.5 py-2 text-body-13 text-02 [&::-webkit-details-marker]:hidden">
        {warn ? (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
        ) : arbiterConnected ? (
          <Wallet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-500" />
        ) : (
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
        )}
        <span className="min-w-0 flex-1">
          {warn ? <span className="text-warning-700">{problems.join(" ")} </span> : null}
          {signer}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-label-13 text-03 group-hover:text-01">
          Details
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-2.5 border-t border-01 px-3.5 py-3 text-body-13 min-[480px]:grid-cols-2 desktop:grid-cols-3">
        <Fact label="Dispute window">{durationText(terms.slashDelaySeconds)}</Fact>
        <Fact label="Time to rule">30 days from the dispute</Fact>
        <Fact label="Split of a penalty">{splitSharesText(terms.slashAgentBps).replace("never taken from the provider", "stays with the provider")}</Fact>
        <Fact label="Arbiter">{terms.arbiter ? <CopyChip value={terms.arbiter} label="arbiter address" /> : "None"}</Fact>
        <Fact label="Admin">
          <CopyChip value={terms.admin} label="admin address" />
        </Fact>
        <Fact label="Chain">{stakeDeploymentFor(terms.chainId)?.displayName ?? `Chain ${terms.chainId.split(":")[1] ?? terms.chainId}`}</Fact>
        <Fact label="Indexer">
          {chainState === null ? "Not reported" : chainState.stale ? (lagMin === null ? "Not caught up" : `${lagMin} min behind`) : "Up to date"}
        </Fact>
        <Fact label="Contracts">{terms.paused ? "Paused" : "Running"}</Fact>
        {chainState ? (
          <Fact label="Last reconciled">{chainState.reconciledAt ? <UtcTime value={chainState.reconciledAt} /> : "never"}</Fact>
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

/** "✓ Payee checked" / "⚠ Payee not checked" / "⚠ Payee check fails", with the details one click away. */
function PayeeChip({ row }: { row: ArbiterDispute }) {
  const check = beneficiaryCheck(row);
  const ok = check.status === "ok";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "hit-area inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
            ok ? "bg-03 text-02 hover:text-01" : check.status === "failed" ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700",
          )}
        >
          {ok ? <CheckCircle2 aria-hidden="true" className="size-3" /> : <AlertTriangle aria-hidden="true" className="size-3" />}
          {ok ? "Payee checked" : check.status === "failed" ? "Payee check fails" : "Payee not checked"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2 border border-01 p-3 text-body-13">
        <DropdownMenuLabel className="p-0 text-label-13 text-01">Who gets paid if it is upheld</DropdownMenuLabel>
        <p className="text-02">{check.headline}</p>
        {check.reason ? <p className="text-danger-700">{check.reason}</p> : null}
        <p className="flex flex-wrap items-center gap-2 text-body-xs text-03">
          Paid to <CopyChip value={row.beneficiary} label="payee address" />
        </p>
        <p className="flex flex-wrap items-center gap-2 text-body-xs text-03">
          Request <CopyChip value={row.requestId} label="request id" />
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DisputeRow({
  row,
  providerName,
  now,
  canRule,
  canBlock,
  blockWhy,
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
  blockWhy: string | null;
  selected: boolean;
  focused: boolean;
  refusals: readonly string[];
  onToggle: () => void;
  onRule: (kind: ArbiterRuling) => void;
}) {
  const amount = disputeAmount(row.chainId, row.penaltyAmount);
  const evidence = row.beneficiaryEvidence;
  const paid = evidence ? disputeAmount(row.chainId, evidence.paidAmount) : null;
  const checkboxId = `select-${row.requestId}`;
  // What this browser did with a ruling on it: a downloaded Safe file, or a sent transaction.
  const handed = useHandoff([row.requestId]);

  return (
    <li
      id={`dispute-${row.requestId}`}
      className={cn(
        "relative flex w-full min-w-0 flex-col gap-2 px-4 py-3",
        !canRule && "pr-14 tablet:pr-4",
        selected && "bg-primary-10",
        focused && "ring-2 ring-inset ring-primary-500",
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-2 tablet:flex-row tablet:items-start tablet:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {canRule ? (
            // A 40px hit area around the 16px box, without moving it.
            <label
              htmlFor={checkboxId}
              className="-mx-3 -my-2.5 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-02"
            >
              <input
                id={checkboxId}
                type="checkbox"
                className="size-4 cursor-pointer accent-primary-600"
                checked={selected}
                onChange={onToggle}
                aria-label={`Select ${possessive(providerName)} penalty for a combined ruling`}
              />
            </label>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-01">
              <Link href={routes.operatorCase(row.proposalId)} className="hit-area min-w-0 font-medium hover:underline">
                {providerName}
                <span className="text-03"> · </span>
                <span className="tabular-nums">{amount ? formatMoney(amount) : "penalty"}</span>
              </Link>
              <Deadline kind="dispute" until={row.expiresAt} from={row.disputedAt} now={now} />
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs tabular-nums text-03">
              <span>
                {evidence ? (
                  <>
                    {evidence.failedCalls} failed call{evidence.failedCalls === 1 ? "" : "s"}
                    {paid ? ` · ${formatMoney(paid)} paid for them` : ""}
                  </>
                ) : (
                  "Payments for the failed calls not matched"
                )}
                {" · "}
                {row.upheldViolations30d === 0 ? "none upheld in 30 days" : `${row.upheldViolations30d} upheld in 30 days`}
              </span>
              <PayeeChip row={row} />
            </p>
            {handed ? (
              <p role="status" className="text-body-xs text-02">
                {handed.kind === "file"
                  ? `Ruling file downloaded here at ${formatClock(handed.at)} UTC · waiting for the arbiter's signature`
                  : `Ruling sent at ${formatClock(handed.at)} UTC · waiting for the chain watcher`}
              </p>
            ) : null}
          </div>
        </div>
        <div className={cn("flex shrink-0 items-center gap-2", !canRule && "absolute right-3 top-2.5 tablet:static")}>
          {canRule ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => onRule("CANCEL")} className="touch-target flex-1 tablet:flex-none" aria-label={`Cancel ${possessive(providerName)} penalty`}>
                Cancel
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onRule("UPHOLD")} className="touch-target flex-1 tablet:flex-none" aria-label={`Uphold ${possessive(providerName)} penalty`}>
                Uphold
              </Button>
            </>
          ) : null}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={`More for ${possessive(providerName)} penalty`} className="touch-target">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px] border border-01">
              <DropdownMenuItem asChild>
                <Link href={routes.operatorCase(row.proposalId)}>Open penalty</Link>
              </DropdownMenuItem>
              {canBlock ? (
                <DropdownMenuItem asChild>
                  <Link href={`/operator/blocks?block=${encodeURIComponent(row.providerId)}&kind=ORGANIZATION`}>Block this provider</Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
                  <span>Block this provider</span>
                  {blockWhy ? <span className="text-body-xs text-03">{blockWhy}</span> : null}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {refusals.length > 0 ? (
        <div role="alert" className="flex flex-col gap-0.5 rounded-md border border-danger-20 bg-danger-10 px-3 py-2">
          {refusals.map((text) => (
            <p key={text} className="text-body-13 text-danger-700">
              {text}
            </p>
          ))}
        </div>
      ) : null}
    </li>
  );
}

// ── The ruling sheet: what happens, reason + note, then sign (or export) ───

function sumMoney(rows: readonly ArbiterDispute[]): Money | null {
  if (!rows[0]) return null;
  const total = rows.reduce((sum, row) => sum + BigInt(/^\d+$/.test(row.penaltyAmount) ? row.penaltyAmount : "0"), BigInt(0));
  return disputeAmount(rows[0].chainId, total.toString());
}

const OUTCOME_ICON = { money: Coins, undo: Undo2, final: Lock, sign: PenLine } as const;

function RulingSheet({
  ruling,
  rows,
  providerName,
  chainForSelection,
  onClose,
  onRefused,
  onDone,
}: {
  ruling: { kind: ArbiterRuling; ids: string[] } | null;
  rows: ArbiterDispute[];
  providerName: (id: string) => string;
  chainForSelection: string | null;
  onClose: () => void;
  onRefused: (refusals: ReadonlyMap<string, readonly string[]>) => void;
  onDone: (title: string, hash: string | null, chainId: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [footer, setFooter] = React.useState<HTMLDivElement | null>(null);
  const kind = ruling?.kind ?? "CANCEL";
  const chainId = chainForSelection ?? FALLBACK_CHAIN;
  // The arbiter of the chain these penalties are on, not of the chain picked in the header.
  const terms = useQuery({
    queryKey: ["operator", "arbiter", "terms", chainId],
    queryFn: () => getArbiterTerms(chainId),
    enabled: ruling !== null,
    retry: 0,
  });
  const arbiter = terms.data?.arbiter ?? null;
  const [signing, setSigning] = React.useState(false);
  // The call as decoded from the calldata once it is built: what the summary and details then show.
  const [built, setBuilt] = React.useState<{ key: string; decoded: DecodedCall } | null>(null);

  const rulingKey = ruling ? `${ruling.kind}:${ruling.ids.join(",")}` : "";
  React.useEffect(() => {
    setReason("");
    setNote("");
    setTicket("");
    setAcknowledged(false);
  }, [rulingKey]);

  // Upholding pays the beneficiary: every row whose payee check did not pass is named, and acknowledged first.
  const unchecked = kind === "UPHOLD" ? rows.filter((row) => beneficiaryCheck(row).status !== "ok") : [];

  const connected = useConnectedAddresses();
  const signerState = useSigner({ chainId, address: arbiter ? connectedSpelling(connected, arbiter) : undefined });
  const canSign = arbiter !== null && signerState.status === "ready" && sameEvmAddress(signerState.signer.address, arbiter);

  const validated = validateRulingForm({ ruling: kind, reasonCode: reason, note, ticketRef: ticket }, chainForSelection, ruling?.ids ?? []);
  // Everything still missing in one line, not one item at a time.
  const notReady = rulingMissingText({
    warnings: unchecked.length,
    acknowledged,
    reason,
    note,
    otherError: validated.ok ? null : (Object.values(validated.errors)[0] ?? "Check the form."),
  });

  // The ruling the arbiter chose here, on exactly the selected records: the
  // calldata is checked against it before it is signed or downloaded (F1).
  const expected: ExpectedCall | null = validated.ok
    ? {
        contract: "stake",
        functionName: kind === "UPHOLD" ? "upholdSlashBatch" : "cancelSlashBatch",
        args: [validated.body.requestIds],
      }
    : null;

  const prepare = async () => {
    if (!validated.ok || !expected) throw new Error(notReady ?? "Check the form.");
    let call;
    try {
      call = await createArbiterRulingIntent(validated.body);
    } catch (error) {
      const refused = refusalsOf(error);
      if (refused && refused.length > 0) onRefused(refusalsById(refused, "arbiter"));
      throw error;
    }
    const decoded = assertContractCall(call, expected);
    setBuilt({ key: rulingKey, decoded });
    return { call, expected };
  };

  const totalMoney = sumMoney(rows);
  const count = rows.length;
  const single = count === 1 ? rows[0] : undefined;
  const noun = `${count} penalt${count === 1 ? "y" : "ies"}`;
  const verb = kind === "UPHOLD" ? "Uphold" : "Cancel";
  const title = single
    ? `${verb} ${possessive(providerName(single.providerId))} ${totalMoney ? `${formatMoney(totalMoney)} ` : ""}penalty?`
    : `${verb} ${noun}${totalMoney ? ` (${formatMoney(totalMoney)})` : ""}?`;
  const signer = canSign
    ? "Signed here, with the arbiter wallet connected in this browser"
    : arbiter
      ? `Signed by the arbiter key ${shortId(arbiter)}: download the file and sign it in the arbiter's multi-signer wallet`
      : "Signed by the arbiter: download the file for the arbiter's multi-signer wallet";
  const outcome = rulingOutcome({ kind, total: totalMoney, agentBps: terms.data?.slashAgentBps ?? null, count, signer });

  const steps: WalletStep[] = [
    {
      id: "rule",
      label: `${verb} ${noun}`,
      cost: "gas",
      run: async ({ report }) => {
        if (signerState.status !== "ready") throw new Error("Connect the arbiter's wallet to sign here.");
        report({ stage: "preparing" });
        const { call, expected: chosen } = await prepare();
        report({ stage: "wallet" });
        const hash = await sendSlashContractCall(call, signerState.signer, chosen);
        const deployment = stakeDeploymentFor(call.chainId);
        const explorerUrl = deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined;
        report({ stage: "submitted", data: hash, explorerUrl });
        return { data: hash, explorerUrl };
      },
    },
  ];

  const functionName = kind === "UPHOLD" ? "upholdSlashBatch" : "cancelSlashBatch";
  const decoded = built && built.key === rulingKey ? built.decoded : null;
  const summary = callSummary({
    functionName: decoded?.functionName ?? functionName,
    args: decoded?.args ?? [ruling?.ids ?? []],
    contract: "stake",
    to: decoded?.to ?? stakeDeploymentFor(chainId)?.stakeContract ?? "",
    chainId,
    signer: arbiter,
  });

  const errorText = (error: unknown) => arbiterErrorMessage(error, "ruling").replace(/\s*\([A-Z_]+\)$/, "");

  return (
    <Sheet open={ruling !== null} onOpenChange={(open) => (!open && !signing ? onClose() : undefined)}>
      <SheetContent showCloseButton={!signing} aria-describedby={undefined}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-4 pt-3">
          <WhatHappens lines={outcome.map((line) => ({ icon: OUTCOME_ICON[line.icon], text: line.text }))} />
          {count > 1 ? (
            <ul className="flex w-full flex-col rounded-lg border border-01">
              {rows.map((row) => {
                const amount = disputeAmount(row.chainId, row.penaltyAmount);
                return (
                  <li key={row.requestId} className="flex items-center justify-between gap-3 border-b border-01 px-3 py-2 text-body-13 last:border-b-0">
                    <span className="min-w-0 truncate text-01">{providerName(row.providerId)}</span>
                    <span className="shrink-0 tabular-nums text-02">{amount ? formatMoney(amount) : ""}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {unchecked.length > 0 ? (
            <div className="flex w-full flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5">
              <p className="flex items-start gap-2 text-body-13 text-02">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
                <span>
                  Upholding pays {single ? "the penalty" : "each penalty"} out.{" "}
                  {single
                    ? `Assay could not confirm that the account receiving it paid for the failed calls${beneficiaryCheck(single).reason ? ` (${beneficiaryCheck(single).reason})` : ""}. Check it on the penalty before upholding.`
                    : `For ${unchecked.length} of them (${unchecked.map((row) => providerName(row.providerId)).join(", ")}) Assay could not confirm that the account receiving the money paid for the failed calls. Check them on their penalties, or leave them out of this batch.`}
                </span>
              </p>
              <Checkbox
                label={`I checked who gets paid on ${unchecked.length === 1 ? "this penalty" : `these ${unchecked.length} penalties`}`}
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
            </div>
          ) : null}
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
          <Field
            label="Ticket (optional)"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="INC-123"
            maxLength={128}
          />
          <SignOrExport
            canSign={canSign}
            signerLabel={arbiter ? `the arbiter key ${shortId(arbiter)}` : "the arbiter"}
            hideSigner
            actionsContainer={footer}
            exportVariant={kind === "UPHOLD" ? "danger" : "primary"}
            handoff={{
              link: `/operator/arbiter?focus=${encodeURIComponent(rows[0]?.requestId ?? "")}`,
              message: `Please sign the ${kind === "UPHOLD" ? "uphold" : "cancel"} ruling for ${rows.map((row) => providerName(row.providerId)).join(", ")} with the arbiter key. The file is attached; the disputes are here:`,
            }}
            signLabel={`${verb} and sign`}
            steps={steps}
            disabled={notReady !== null}
            disabledReason={notReady}
            resetKey={`${rulingKey}|${reason}|${note}|${ticket}`}
            onPhaseChange={(phase) => setSigning(phase === "running")}
            describeError={errorText}
            onSigned={(results) => {
              const hash = results[results.length - 1]?.data;
              onDone(kind === "UPHOLD" ? `Uphold of ${noun} sent` : `Cancel of ${noun} sent`, typeof hash === "string" ? hash : null, chainId);
            }}
            functionName={functionName}
            chainId={chainId}
            summary={summary}
            summaryNote={
              decoded
                ? "Read from the transaction itself, and checked against the penalties you picked."
                : "The transaction is built when you press the button, and only offered if it is exactly this."
            }
            trackIds={ruling?.ids}
            prepare={async () => {
              const { call } = await prepare();
              return [{ to: call.to, value: call.value, data: call.data }];
            }}
            afterExport={`In the arbiter's multi-signer wallet (Safe), open Transaction Builder, drop the file in and sign. ${count === 1 ? "The penalty moves" : "The penalties move"} once it lands.`}
            details={
              decoded
                ? decoded.args.map((arg, i) => ({ label: `Argument ${i + 1} (decoded from the calldata)`, value: formatCallArg(arg) }))
                : rows.map((row) => ({ label: `${providerName(row.providerId)} request id (selected)`, value: row.requestId }))
            }
          />
        </div>
        <div ref={setFooter} className={cn(OPERATOR_SHEET_FOOTER, "mt-auto flex w-full flex-col gap-2 px-[18px] pt-3")} />
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
