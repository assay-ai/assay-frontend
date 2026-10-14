"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { refusalsById, refusalsOf } from "@/features/chain-calls/refusals";
import { formatAtomic, shortRequestId } from "@/features/chain-slashes/format";
import { useNowSeconds } from "@/features/chain-slashes/use-chain-slashes";
import { DASH, stampUtc } from "@/features/g34a/stats";
import {
  ARBITER_BLOCK_ROLES,
  ARBITER_NOTE_MIN,
  ARBITER_RULING_ROLES,
  ARBITER_SELECTION_MAX,
  CHAIN_BLOCK_REASON_SUGGESTIONS,
  RULING_LABEL,
  RULING_REASON_SUGGESTIONS,
  agentShareText,
  arbiterErrorMessage,
  beneficiaryCheck,
  mayBlockOnChain,
  mayRule,
  pruneArbiterSelection,
  selectionChain,
  sortDisputesOldestFirst,
  toggleArbiterSelection,
  validateChainBlockForm,
  validateRulingForm,
  type ArbiterFormErrors,
  type ChainBlockFormInput,
  type RulingFormInput,
} from "@/features/operator/arbiter";
import { BLOCK_NOTE_MAX } from "@/features/operator/blocks";
import { ContractCallPanel } from "@/features/operator/contract-call-panel";
import { useOperatorSession } from "@/features/operator/session-context";
import type { ArbiterDispute, ArbiterRuling, ArbiterTerms, ChainStateHealth } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ROBINHOOD_TESTNET_STAKE, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { DISPUTED_ON_CHAIN_LABEL, chainStatusLabel } from "@/libs/chains/status-labels";
import {
  createArbiterBlockIntent,
  createArbiterRulingIntent,
  getArbiterTerms,
  getPlatformHealth,
  listArbiterDisputes,
} from "@/services/operator.service";
import { cn } from "@/utils";

/**
 * The arbiter page, route `/operator/arbiter` (assay-evm D-19).
 *
 * The provider can dispute a pending penalty on chain (`disputeSlash`), which
 * freezes it. Only the ARBITER rules on it: `upholdSlashBatch` (against the
 * provider: back to Pending, executable from the ruling) or
 * `cancelSlashBatch` (for the provider: the stake is released). Unruled for 30
 * days, anyone can expire it. The arbiter can also put an address on the
 * contracts' own blocklist (`setBlocked(account, true)`); only the admin lifts it.
 *
 * The backend holds no arbiter key. Every action here BUILDS an unsigned
 * transaction, writes the override register (`S-13`, `A-11`) and shows the
 * call with its signer. It is signed here only when the wallet connected in
 * this browser IS the signer; otherwise it is copied into the Safe that holds
 * the arbiter key. Cases move when the chain watcher sees the transaction land.
 */

const FALLBACK_CHAIN = ROBINHOOD_TESTNET_STAKE.chainId;

const EMPTY_RULING: RulingFormInput = { ruling: "", reasonCode: "", note: "", ticketRef: "" };
const EMPTY_BLOCK: ChainBlockFormInput = { account: "", reasonCode: "", note: "", ticketRef: "" };

function when(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return Number.isNaN(Date.parse(iso)) ? iso : `${stampUtc(iso)} UTC`;
}

function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return DASH;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean);
  const short = parts.length > 0 ? parts.join(" ") : `${seconds}s`;
  // Whole hours past a day read as hours too, the unit the dispute copy uses.
  if (days > 0 && seconds % 3_600 === 0) {
    return `${(seconds / 3_600).toLocaleString()} h (${short}, ${seconds.toLocaleString()} s)`;
  }
  return `${short} (${seconds.toLocaleString()} s)`;
}

/** Atomic units at the chain's stake asset scale, when this build pins one; raw otherwise. */
function amount(chainId: string, atomic: string | null): string {
  if (atomic === null) return DASH;
  const deployment = stakeDeploymentFor(chainId);
  if (!deployment || !/^\d+$/.test(atomic)) return `${atomic} (atomic units)`;
  return formatAtomic(BigInt(atomic), deployment.fallbackAssetDecimals, deployment.fallbackAssetSymbol);
}

export default function ArbiterPage() {
  const identity = useOperatorSession();
  const queryClient = useQueryClient();
  const canRule = mayRule(identity.roles);
  const canBlock = mayBlockOnChain(identity.roles);

  // ── Which chain ───────────────────────────────────────────────────────────
  const health = useQuery({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, retry: 0 });
  const chainStates: readonly ChainStateHealth[] = React.useMemo(
    () => health.data?.chainState ?? [],
    [health.data],
  );
  const chainIds = React.useMemo(() => {
    const ids = chainStates.map((state) => state.chainId);
    return ids.length > 0 ? ids : [FALLBACK_CHAIN];
  }, [chainStates]);
  const [chosenChain, setChosenChain] = React.useState<string | null>(null);
  const chainId = chosenChain && chainIds.includes(chosenChain) ? chosenChain : chainIds[0];
  const chainState = chainStates.find((state) => state.chainId === chainId) ?? null;

  // ── Terms and the queue ───────────────────────────────────────────────────
  const terms = useQuery({
    queryKey: ["operator", "arbiter", "terms", chainId],
    queryFn: () => getArbiterTerms(chainId),
    retry: 0,
  });
  const disputes = useQuery({
    queryKey: ["operator", "arbiter", "disputes"],
    queryFn: listArbiterDisputes,
    retry: 0,
  });
  const rows = React.useMemo(() => sortDisputesOldestFirst(disputes.data ?? []), [disputes.data]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selectionNotice, setSelectionNotice] = React.useState<string | null>(null);
  React.useEffect(() => setSelected((current) => pruneArbiterSelection(current, rows)), [rows]);
  const selectedChain = selectionChain(selected, rows);

  const toggle = (row: ArbiterDispute) => {
    const result = toggleArbiterSelection(selected, row, rows);
    setSelected(result.selected);
    setSelectionNotice(
      result.ok
        ? null
        : result.reason === "limit"
          ? `At most ${ARBITER_SELECTION_MAX} penalties go into one transaction.`
          : `One transaction is one chain: ${row.chainId} is not ${selectedChain ?? "the chain already selected"}. Clear the selection first.`,
    );
  };

  // ── Ruling (S-13) ─────────────────────────────────────────────────────────
  const [ruling, setRuling] = React.useState<RulingFormInput>(EMPTY_RULING);
  const [rulingErrors, setRulingErrors] = React.useState<ArbiterFormErrors<keyof RulingFormInput | "selection">>({});
  const [rulingError, setRulingError] = React.useState<string | null>(null);
  const [rowRefusals, setRowRefusals] = React.useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  const [rulingCall, setRulingCall] = React.useState<SlashContractCall | null>(null);

  const prepareRuling = useMutation({
    mutationFn: createArbiterRulingIntent,
    onSuccess: (call) => {
      setRulingCall(call);
      setRulingError(null);
      setRowRefusals(new Map());
    },
    onError: (error) => {
      const refused = refusalsOf(error);
      setRowRefusals(refused && refused.length > 0 ? refusalsById(refused, "arbiter") : new Map());
      setRulingError(arbiterErrorMessage(error, "ruling"));
    },
  });

  function submitRuling(event: React.FormEvent) {
    event.preventDefault();
    setRulingError(null);
    setRulingCall(null);
    const result = validateRulingForm(ruling, selectedChain, [...selected]);
    if (!result.ok) {
      setRulingErrors(result.errors);
      return;
    }
    setRulingErrors({});
    prepareRuling.mutate(result.body);
  }

  // ── Block on chain (A-11) ─────────────────────────────────────────────────
  const [block, setBlock] = React.useState<ChainBlockFormInput>(EMPTY_BLOCK);
  const [blockErrors, setBlockErrors] = React.useState<ArbiterFormErrors<keyof ChainBlockFormInput>>({});
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [blockCall, setBlockCall] = React.useState<SlashContractCall | null>(null);

  const prepareBlock = useMutation({
    mutationFn: createArbiterBlockIntent,
    onSuccess: (call) => {
      setBlockCall(call);
      setBlockError(null);
    },
    onError: (error) => setBlockError(arbiterErrorMessage(error, "block")),
  });

  function submitBlock(event: React.FormEvent) {
    event.preventDefault();
    setBlockError(null);
    setBlockCall(null);
    const result = validateChainBlockForm(block, chainId);
    if (!result.ok) {
      setBlockErrors(result.errors);
      return;
    }
    setBlockErrors({});
    prepareBlock.mutate(result.body);
  }

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "arbiter"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "health"] });
  };

  const nowMs = useNowSeconds() * 1000;

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Arbiter</h1>
          <p className="text-body-sm text-03">
            on-chain disputes · ruling is S-13, an on-chain block is A-11 · the arbiter&apos;s wallet signs
          </p>
        </div>
        <div className="flex items-end gap-3">
          {chainIds.length > 1 ? (
            <Select label="Chain" value={chainId} onChange={(e) => setChosenChain(e.target.value)}>
              {chainIds.map((id) => (
                <option key={id} value={id}>
                  {stakeDeploymentFor(id)?.displayName ?? id}
                </option>
              ))}
            </Select>
          ) : (
            <span className="font-mono text-mono-12 text-03">{stakeDeploymentFor(chainId)?.displayName ?? chainId}</span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={refreshAll}>
            Refresh
          </Button>
        </div>
      </header>

      {/* ── Terms ─────────────────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Terms on chain</PanelTitle>
            <PanelDescription>X402Config, read live · and what the chain-state indexer last saw</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
          {terms.isLoading ? (
            <p className="text-body-13 text-03">Reading the Config…</p>
          ) : terms.isError ? (
            <Banner
              tone="danger"
              title="The terms could not be read"
              description={arbiterErrorMessage(terms.error, "terms")}
              action={<BannerAction onClick={() => void terms.refetch()}>Try again</BannerAction>}
            />
          ) : terms.data ? (
            <TermsGrid terms={terms.data} />
          ) : null}

          {terms.data?.paused ? (
            <Banner
              tone="warning"
              title="Contracts paused — try after unpause"
              description="Execution, deposits and withdrawals are refused while paused. Providers can still dispute, and the arbiter can still uphold, cancel and block: none of those is pause-gated."
            />
          ) : null}

          <ChainStateBlock state={chainState} loading={health.isLoading} />
        </PanelBody>
      </Panel>

      {/* ── Disputes ──────────────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Disputed on chain</PanelTitle>
            <PanelDescription>
              oldest dispute first · {rows.length} open · select up to {ARBITER_SELECTION_MAX} for one ruling
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          {disputes.isLoading ? (
            <p className="text-body-13 text-03">Loading the disputes…</p>
          ) : disputes.isError ? (
            <Banner
              tone="danger"
              title="The disputes could not be loaded"
              description={arbiterErrorMessage(disputes.error, "disputes")}
              action={<BannerAction onClick={() => void disputes.refetch()}>Try again</BannerAction>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing disputed on chain"
              description="No provider has an open on-chain dispute. A new one appears here once the chain watcher sees its SlashDisputed event."
            />
          ) : (
            <>
              <div className="flex w-full flex-wrap items-center gap-3">
                <span className="text-label-13 text-01" aria-live="polite">
                  {selected.size} of {ARBITER_SELECTION_MAX} selected
                  {selectedChain ? ` · ${selectedChain}` : ""}
                </span>
                {selected.size > 0 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                ) : null}
              </div>
              {selectionNotice ? (
                <p className="text-body-xs text-warning-700" role="status">
                  {selectionNotice}
                </p>
              ) : null}
              <ul className="flex w-full min-w-0 flex-col gap-2">
                {rows.map((row) => (
                  <DisputeRow
                    key={row.requestId}
                    row={row}
                    selected={selected.has(row.requestId.toLowerCase())}
                    selectable={canRule}
                    onToggle={() => toggle(row)}
                    refusals={rowRefusals.get(row.requestId.toLowerCase()) ?? []}
                    nowMs={nowMs}
                  />
                ))}
              </ul>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ── Ruling ────────────────────────────────────────────────────── */}
      {canRule ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Rule on the selected disputes</PanelTitle>
              <PanelDescription>S-13 · {ARBITER_RULING_ROLES.join(" or ")} · builds the arbiter&apos;s transaction</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitRuling} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <p className="text-body-13 text-02">
                Uphold puts the penalty back to Pending, executable from the ruling; the ordinary execution
                then takes the stake. Cancel releases the reservation whole. Both are atomic over the
                selection: one penalty the chain would refuse refuses them all, and nothing is built.
              </p>
              {rulingErrors.selection ? (
                <p className="text-body-xs text-danger-600">{rulingErrors.selection}</p>
              ) : null}
              <Select
                label="Ruling"
                value={ruling.ruling}
                onChange={(e) => setRuling((f) => ({ ...f, ruling: e.target.value as ArbiterRuling | "" }))}
                hint={
                  rulingErrors.ruling ? (
                    <span className="text-danger-600">{rulingErrors.ruling}</span>
                  ) : (
                    "Both are the arbiter's: Assay builds an uphold or a cancel for the arbiter only."
                  )
                }
              >
                <option value="">Choose…</option>
                <option value="UPHOLD">{RULING_LABEL.UPHOLD}</option>
                <option value="CANCEL">{RULING_LABEL.CANCEL}</option>
              </Select>
              <ReasonCodeField
                id="ruling-reason"
                value={ruling.reasonCode}
                onChange={(reasonCode) => setRuling((f) => ({ ...f, reasonCode }))}
                suggestions={ruling.ruling === "" ? RULING_REASON_SUGGESTIONS.CANCEL : RULING_REASON_SUGGESTIONS[ruling.ruling]}
                error={rulingErrors.reasonCode}
              />
              <NoteBox
                id="ruling-note"
                value={ruling.note}
                onChange={(note) => setRuling((f) => ({ ...f, note }))}
                error={rulingErrors.note}
                placeholder="Why this ruling, and on what evidence. Written to the override register."
              />
              <Field
                label="Ticket (optional)"
                value={ruling.ticketRef}
                onChange={(e) => setRuling((f) => ({ ...f, ticketRef: e.target.value }))}
                placeholder="INC-123"
                autoComplete="off"
                error={rulingErrors.ticketRef}
              />
              {rulingError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {rulingError}
                </p>
              ) : null}
              <Button
                type="submit"
                className="self-start"
                variant={ruling.ruling === "UPHOLD" ? "danger" : "primary"}
                loading={prepareRuling.isPending}
                disabled={selected.size === 0}
              >
                {ruling.ruling === "UPHOLD"
                  ? `Prepare uphold of ${selected.size}`
                  : ruling.ruling === "CANCEL"
                    ? `Prepare cancel of ${selected.size}`
                    : "Prepare ruling"}
              </Button>
            </form>
            {rulingCall ? (
              <div className="mt-4">
                <ContractCallPanel
                  call={rulingCall}
                  title="The arbiter's unsigned ruling"
                  afterSend="The cases move once the chain watcher sees it land; this list refreshes then."
                  onSent={refreshAll}
                />
              </div>
            ) : null}
          </PanelBody>
        </Panel>
      ) : (
        <Banner
          tone="primary"
          title="You can read the disputes, not rule on them"
          description={`Preparing a ruling needs ${ARBITER_RULING_ROLES.join(" or ")}. You hold ${
            identity.roles.length > 0 ? identity.roles.join(", ") : "no role"
          }.`}
        />
      )}

      {/* ── Block on chain ────────────────────────────────────────────── */}
      {canBlock ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Block address on chain</PanelTitle>
              <PanelDescription>A-11 · {ARBITER_BLOCK_ROLES.join(", ")} · setBlocked(account, true) · block only</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitBlock} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <p className="text-body-13 text-02">
                The contracts then refuse the address as a party to payments, deposits, withdrawals and
                execution on {stakeDeploymentFor(chainId)?.displayName ?? chainId}. It can still revoke a
                delegate and dispute a penalty. Only the admin can lift it. For Assay&apos;s own, off-chain
                block, use{" "}
                <Link href="/operator/blocks" className="text-primary-600 underline">
                  Blocks
                </Link>
                .
              </p>
              <Field
                label="Address"
                value={block.account}
                onChange={(e) => setBlock((f) => ({ ...f, account: e.target.value }))}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                error={blockErrors.account}
              />
              <ReasonCodeField
                id="chain-block-reason"
                value={block.reasonCode}
                onChange={(reasonCode) => setBlock((f) => ({ ...f, reasonCode }))}
                suggestions={CHAIN_BLOCK_REASON_SUGGESTIONS}
                error={blockErrors.reasonCode}
              />
              <NoteBox
                id="chain-block-note"
                value={block.note}
                onChange={(note) => setBlock((f) => ({ ...f, note }))}
                error={blockErrors.note}
                placeholder="What happened, and who reported it."
              />
              <Field
                label="Ticket (optional)"
                value={block.ticketRef}
                onChange={(e) => setBlock((f) => ({ ...f, ticketRef: e.target.value }))}
                placeholder="INC-123"
                autoComplete="off"
                error={blockErrors.ticketRef}
              />
              {blockError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {blockError}
                </p>
              ) : null}
              <Button type="submit" variant="danger" className="self-start" loading={prepareBlock.isPending}>
                Prepare on-chain block
              </Button>
            </form>
            {blockCall ? (
              <div className="mt-4">
                <ContractCallPanel
                  call={blockCall}
                  title="The arbiter's unsigned block"
                  afterSend="The indexer counts it in the blocked addresses once it lands."
                  onSent={refreshAll}
                />
              </div>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}
    </>
  );
}

function Fact({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "warning" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className={cn("min-w-0 break-all font-mono text-mono-12", tone === "warning" ? "text-warning-700" : "text-01")}>
        {children}
      </dd>
    </div>
  );
}

function TermsGrid({ terms }: { terms: ArbiterTerms }) {
  return (
    <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-3 tablet:grid-cols-2 desktop:grid-cols-3">
      <Fact label="Arbiter" tone={terms.arbiter ? undefined : "warning"}>
        {terms.arbiter ?? "None appointed — Assay cannot build an uphold, a cancel or a block"}
      </Fact>
      <Fact label="Admin">{terms.admin}</Fact>
      <Fact label="Paused" tone={terms.paused ? "warning" : undefined}>
        {terms.paused ? "Yes — contracts paused" : "No"}
      </Fact>
      <Fact label="Slash delay (the dispute window)">{duration(terms.slashDelaySeconds)}</Fact>
      <Fact label="Beneficiary share (slashAgentBps)">{agentShareText(terms.slashAgentBps)}</Fact>
      <Fact label="Chain">{terms.chainId}</Fact>
    </dl>
  );
}

function ChainStateBlock({ state, loading }: { state: ChainStateHealth | null; loading: boolean }) {
  if (loading) return <p className="text-body-xs text-03">Reading the indexer&apos;s state…</p>;
  if (!state) {
    return (
      <p className="text-body-xs text-03">
        The chain-state indexer reports nothing for this chain (or this backend does not report it).
      </p>
    );
  }
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border p-3",
        state.stale ? "border-warning-20 bg-warning-10" : "border-01 bg-02",
      )}
    >
      <p className={cn("text-label-13", state.stale ? "text-warning-700" : "text-01")}>
        {state.stale
          ? "Indexer STALE — it never caught up, or lags more than the allowed bound. Trust the live terms above."
          : "Indexer up to date"}
      </p>
      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-2 tablet:grid-cols-2 desktop:grid-cols-4">
        <Fact label="Indexed block">{state.indexedBlock ?? DASH}</Fact>
        <Fact label="Head block">{state.headBlock ?? DASH}</Fact>
        <Fact label="Lag">{state.lagSeconds === null ? "never caught up" : `${state.lagSeconds} s`}</Fact>
        <Fact label="Reconciled">{when(state.reconciledAt)}</Fact>
        <Fact label="Paused (indexed)">{state.paused ? "Yes" : "No"}</Fact>
        <Fact label="Arbiter (indexed)">{state.arbiter ?? "none"}</Fact>
        <Fact label="Blocked on chain">{String(state.blockedCount)}</Fact>
      </dl>
    </div>
  );
}

function DisputeRow({
  row,
  selected,
  selectable,
  onToggle,
  refusals,
  nowMs,
}: {
  row: ArbiterDispute;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  refusals: readonly string[];
  nowMs: number;
}) {
  const expired = row.expiresAt !== null && Date.parse(row.expiresAt) <= nowMs;
  const id = `arbiter-${row.requestId}`;
  return (
    <li
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-01 p-3",
        selected ? "border-primary-500" : "border-01",
      )}
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {selectable ? (
          <input
            id={id}
            type="checkbox"
            className="size-4 accent-primary-600"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${row.requestId}`}
          />
        ) : null}
        <label htmlFor={selectable ? id : undefined} className="font-mono text-mono-13 text-01" title={row.requestId}>
          {shortRequestId(row.requestId)}
        </label>
        {/*
          Every row here is a record that is Disputed on chain (the backend lists
          DISPUTED parts only). The case's mirror can still read PENDING — the
          case's other parts are pending — so it is shown beside, not instead.
        */}
        <span className="rounded-full bg-primary-10 px-[9px] py-0.5 text-label-13 text-primary-700">
          {DISPUTED_ON_CHAIN_LABEL}
        </span>
        {row.caseChainStatus === "PENDING" ? (
          <span className="text-body-xs text-03">case partly disputed: its other parts are pending on chain</span>
        ) : row.caseChainStatus !== "DISPUTED" ? (
          <span className="text-body-xs text-03">
            {`case on chain: ${chainStatusLabel(row.caseChainStatus, row.chainId)}`}
          </span>
        ) : null}
        <span className="text-body-xs text-03">case {row.caseStatus.toLowerCase().replace(/_/g, " ")}</span>
        <Link
          href={`/operator/cases/${encodeURIComponent(row.proposalId)}`}
          className="ml-auto text-label-13 text-primary-600 hover:underline"
        >
          Open case
        </Link>
      </div>
      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-1.5 min-[480px]:grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-7">
        <Fact label="Provider">{row.providerId}</Fact>
        <Fact label="Penalty">{amount(row.chainId, row.penaltyAmount)}</Fact>
        <Fact label="Reserved">{amount(row.chainId, row.reservedAmount)}</Fact>
        <Fact label="Disputed">{when(row.disputedAt)}</Fact>
        <Fact label="Expires unruled" tone={expired ? "warning" : undefined}>
          {when(row.expiresAt)}
          {expired ? " · past: it can only be expired now" : ""}
        </Fact>
        <Fact label="Chain">{row.chainId}</Fact>
        <Fact label="Provider: upheld, last 30 days" tone={row.upheldViolations30d > 0 ? "warning" : undefined}>
          {String(row.upheldViolations30d)}
        </Fact>
      </dl>
      <BeneficiaryEvidenceBlock row={row} />
      {refusals.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded-md border border-danger-20 bg-danger-10 px-3 py-2" role="alert">
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

/**
 * Follow-up C5: the beneficiary of the record, whether it paid for the failed
 * calls, and whether this penalty is within its share of the formula penalty.
 * Upholding a record that fails this pays an account that was not harmed, or
 * pays it too much.
 */
function BeneficiaryEvidenceBlock({ row }: { row: ArbiterDispute }) {
  const check = beneficiaryCheck(row);
  const evidence = row.beneficiaryEvidence;
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 rounded-md border px-3 py-2",
        check.status === "ok"
          ? "border-01 bg-02"
          : check.status === "failed"
            ? "border-danger-20 bg-danger-10"
            : "border-warning-20 bg-warning-10",
      )}
    >
      <p
        className={cn(
          "text-label-13",
          check.status === "ok" ? "text-01" : check.status === "failed" ? "text-danger-700" : "text-warning-700",
        )}
      >
        Beneficiary check · {check.headline}
      </p>
      {check.reason ? <p className="text-body-13 text-danger-700">{check.reason}</p> : null}
      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-1.5 tablet:grid-cols-2 desktop:grid-cols-3">
        <Fact label="Beneficiary">{row.beneficiary}</Fact>
        {evidence ? (
          <>
            <Fact
              label="Payer of the failed calls"
              tone={evidence.payer === null ? "warning" : undefined}
            >
              {evidence.payer ?? "None found in this window"}
            </Fact>
            <Fact label="Failed calls">{String(evidence.failedCalls)}</Fact>
            <Fact label="Paid for them">{amount(row.chainId, evidence.paidAmount)}</Fact>
            <Fact label="Of which redeemed">{amount(row.chainId, evidence.redeemedAmount)}</Fact>
            <Fact label="Its share of the formula penalty" tone={evidence.ok ? undefined : "warning"}>
              {evidence.formulaShareAmount === undefined
                ? "Not reported"
                : amount(row.chainId, evidence.formulaShareAmount)}
            </Fact>
            <Fact label="This penalty">{amount(row.chainId, row.penaltyAmount)}</Fact>
            <Fact label="Paid to the beneficiary if executed">{amount(row.chainId, evidence.shareAmount)}</Fact>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** A reason code: free text up to 64 characters, with the usual ones offered. */
function ReasonCodeField({
  id,
  value,
  onChange,
  suggestions,
  error,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  suggestions: readonly string[];
  error?: string;
}) {
  return (
    <>
      <Field
        label="Reason code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={`${id}-options`}
        autoComplete="off"
        spellCheck={false}
        placeholder={suggestions[0]}
        error={error}
        hint={`Short and closed-list, e.g. ${suggestions.join(", ")}.`}
      />
      <datalist id={`${id}-options`}>
        {suggestions.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </>
  );
}

/** A prose note with a live counter. */
function NoteBox({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const length = value.trim().length;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-01">
        Internal note
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={BLOCK_NOTE_MAX + 200}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={
          error
            ? "w-full rounded-md border-[1.5px] border-danger-500 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03"
            : "w-full rounded-md border border-02 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03 focus:border-[1.5px] focus:border-primary-500"
        }
      />
      <p className={error ? "text-body-xs text-danger-600" : "font-mono text-mono-12 text-03"}>
        {error ?? `${length} / ${ARBITER_NOTE_MIN} minimum, ${BLOCK_NOTE_MAX} maximum`}
      </p>
    </div>
  );
}
