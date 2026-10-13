"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Search } from "@/components/ui/search";
import { Select } from "@/components/ui/select";
import { connectedSpelling, sendSlashContractCall } from "@/features/chain-calls/send-contract-call";
import { refusalsById, refusalsOf } from "@/features/chain-calls/refusals";
import { assayMatchFor } from "@/features/chain-slashes/assay-match";
import {
  MAX_DISPUTE_SELECTION,
  disputeErrorMessage,
  isDisputeSelectable,
  notSelectableReason,
  pruneDisputeSelection,
  selectAllDisputable,
  toggleDisputeSelection,
} from "@/features/chain-slashes/dispute-selection";
import {
  DEFAULT_FILTERS,
  STATUS_FILTERS,
  TIME_RANGES,
  applyFilters,
  attentionCount,
  type SlashFilters,
  type StatusFilter,
  type TimeRange,
} from "@/features/chain-slashes/filters";
import { SlashRowCard } from "@/features/chain-slashes/slash-row-card";
import { useChainSlashes, useNowSeconds } from "@/features/chain-slashes/use-chain-slashes";
import { stakeChains } from "@/features/provider-stake/chain-stake";
import { isUserRejection, useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import { normaliseEvmAddress, type HexString } from "@/libs/chains/evm/stake-slashes/address";
import { disputeCallMismatch } from "@/libs/chains/evm/stake-slashes/dispute-call";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";
import { shortAddress } from "@/libs/chains/format";
import { createSlashDisputeIntent } from "@/services/provider-slash-cases.service";
import { getProviderStake } from "@/services/provider-stake.service";
import { cn } from "@/utils";
import { addressOfAccount } from "@/utils/chain";

/**
 * Penalties on chain — route `/provider/capital/penalties`.
 *
 * The provider's independent check on slashes against their stake. **The list
 * is read in the browser straight from the chain**: `eth_getLogs` for the
 * stake contract's `SlashProposed` / `SlashExecuted` / `SlashCancelled` events
 * filtered by the provider's address, then `slashRecordOf(requestId)` for each
 * record's current state, through the RPC pinned in
 * `libs/chains/evm/stake-slashes/deployments.ts`. No figure, status or row on this screen
 * comes from Assay's backend; if the backend is compromised, this page still
 * shows what the chain holds.
 *
 * The backend is asked two things, and both only decorate:
 *
 * - `GET /providers/me/stake` — which wallet the signed-in provider staked
 *   from, to fill the address in. A provider can paste any address instead,
 *   and the page says whose address it is checking, so a backend that names
 *   the wrong wallet is visible rather than silent.
 * - the case lookup (`assay-match.ts`) — whether a Pending record matches a
 *   case Assay knows. A Pending record that Assay does not know is the
 *   signature of a forged slash. It runs only when the page shows the
 *   signed-in provider's own stake wallet, never a pasted address.
 *
 * Under Capital because it is about the stake, and it is linked from the case
 * screen and the dispute list, where a provider reading Assay's account of a
 * penalty is one click from the chain's.
 *
 * ## Dispute on chain
 *
 * On the provider's own stake wallet, Pending rows still inside their window
 * (their own `executableAt`, never a fixed 72 hours) can be selected, up to 64,
 * and disputed in one `disputeSlashBatch`. The backend builds the unsigned call
 * (`POST /providers/me/slash-requests/dispute-intent`); before the provider's
 * stake wallet signs it, the page checks it is exactly that call to the pinned
 * contract (`dispute-call.ts`). It works while the account is blocked and while
 * the contracts are paused: the chain allows a dispute in both, because it only
 * protects the provider.
 */

type DisputeStage = "idle" | "building" | "sending" | "refreshing";

/**
 * How an executed penalty is split: `ParamSet.slashAgentBps` /
 * `slashPlatformBps` on `X402Config`, the rest to the provider. This page
 * reads only the stake contract (no Config read exists on this path), so the
 * owner-decided split is stated: 6000 / 3000 bps, 10% kept. If the Config
 * params ever become part of this page's read, take them from there.
 */
const PENALTY_SPLIT = { agentPercent: 60, platformPercent: 30, providerPercent: 10 } as const;

const DEPLOYMENT = ROBINHOOD_TESTNET_STAKE;

const normalise = normaliseEvmAddress;

function PenaltiesOnChainContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nowSeconds = useNowSeconds();

  // ── Whose stake ───────────────────────────────────────────────────────────
  const stakeQuery = useQuery({
    queryKey: ["provider", "stake"],
    queryFn: getProviderStake,
    retry: 0,
  });
  const ownAuthority =
    stakeChains(stakeQuery.data).find((entry) => entry.chainId === DEPLOYMENT.chainId)
      ?.stakeAuthority ?? null;
  const ownAddress = ownAuthority ? normalise(addressOfAccount(ownAuthority)) : null;

  const pasted = normalise(searchParams.get("address") ?? "");
  const checking: HexString | null = pasted ?? ownAddress;
  const viewingOwnStake =
    checking !== null && ownAddress !== null && checking.toLowerCase() === ownAddress.toLowerCase();

  const [draft, setDraft] = React.useState(searchParams.get("address") ?? "");
  const [draftError, setDraftError] = React.useState<string | null>(null);

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const address = normalise(draft);
    if (!address) {
      setDraftError("That is not an EVM address. It should be 0x followed by 40 hex characters.");
      return;
    }
    setDraftError(null);
    router.replace(`/provider/capital/penalties?address=${address}`);
  };

  const backToOwn = () => {
    setDraft("");
    setDraftError(null);
    router.replace("/provider/capital/penalties");
  };

  // ── The chain read ────────────────────────────────────────────────────────
  // Matched against Assay's cases only on the provider's own stake wallet.
  const { chain, assay } = useChainSlashes(DEPLOYMENT, checking, viewingOwnStake);
  const [filters, setFilters] = React.useState<SlashFilters>(DEFAULT_FILTERS);

  const rows = React.useMemo(() => chain.data?.rows ?? [], [chain.data]);
  const visible = React.useMemo(
    () => applyFilters(rows, filters, nowSeconds),
    [rows, filters, nowSeconds],
  );
  const openCount = attentionCount(rows);

  // ── Dispute on chain ──────────────────────────────────────────────────────
  /*
    The provider's own stake wallet is the only account the contract takes a
    dispute from, so the signer is asked for that address and no other.
  */
  const connected = useConnectedAddresses();
  const signerState = useSigner({
    chainId: DEPLOYMENT.chainId,
    address: ownAddress ? connectedSpelling(connected, ownAddress) : undefined,
  });
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [refusals, setRefusals] = React.useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  const [justDisputed, setJustDisputed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [disputeError, setDisputeError] = React.useState<string | null>(null);
  const [disputeNotice, setDisputeNotice] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<DisputeStage>("idle");
  const busy = stage !== "idle";

  // A window that closes while the page is open, or a row that now reads Disputed, leaves the selection.
  React.useEffect(() => {
    setSelected((current) => pruneDisputeSelection(current, rows, nowSeconds, viewingOwnStake));
  }, [rows, nowSeconds, viewingOwnStake]);

  // Another address: nothing from the last one's dispute applies.
  React.useEffect(() => {
    setRefusals(new Map());
    setJustDisputed(new Set());
    setDisputeError(null);
    setDisputeNotice(null);
  }, [checking]);

  const selectableRows = React.useMemo(
    () => visible.filter((row) => isDisputeSelectable(row, nowSeconds, viewingOwnStake)),
    [visible, nowSeconds, viewingOwnStake],
  );
  const offerDispute = viewingOwnStake && ownAddress !== null;
  const limitReached = selected.size >= MAX_DISPUTE_SELECTION;

  const toggle = (row: (typeof rows)[number]) => {
    const result = toggleDisputeSelection(selected, row, nowSeconds, viewingOwnStake);
    setSelected(result.selected);
    setDisputeNotice(null);
  };

  const disputeSelected = async () => {
    if (!ownAddress || selected.size === 0) return;
    const requestIds = [...selected];
    setDisputeError(null);
    setDisputeNotice(null);
    setRefusals(new Map());

    setStage("building");
    let call;
    try {
      call = await createSlashDisputeIntent({ chainId: DEPLOYMENT.chainId, requestIds });
    } catch (error) {
      const refused = refusalsOf(error);
      if (refused && refused.length > 0) setRefusals(refusalsById(refused, "provider"));
      setDisputeError(disputeErrorMessage(error, DEPLOYMENT.displayName));
      setStage("idle");
      return;
    }

    const mismatch = disputeCallMismatch(call, DEPLOYMENT, ownAddress, requestIds);
    if (mismatch) {
      setDisputeError(
        `Nothing was sent: the transaction Assay prepared is not the dispute you asked for — ${mismatch}. Dispute from the case page or contact Assay support, and check this page again.`,
      );
      setStage("idle");
      return;
    }
    if (signerState.status !== "ready") {
      setDisputeError(
        signerState.status === "hydrating"
          ? "Your wallets are still loading. Nothing was sent; try again in a moment."
          : `Nothing was sent: connect your stake wallet ${ownAddress}. It is the only account the contract accepts a dispute from.`,
      );
      setStage("idle");
      return;
    }

    setStage("sending");
    try {
      await sendSlashContractCall(call, signerState.signer);
    } catch (error) {
      setDisputeError(
        isUserRejection(error)
          ? "Nothing was sent: the wallet prompt was closed or declined."
          : `The dispute did not go through. ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
      setStage("idle");
      return;
    }

    setJustDisputed(new Set(requestIds));
    setSelected(new Set());
    setDisputeNotice(
      `Disputed — awaiting Assay's arbiter. ${requestIds.length === 1 ? "The penalty" : `All ${requestIds.length} penalties`} can no longer be executed while the dispute stands.`,
    );
    setStage("refreshing");
    try {
      await chain.refetch();
    } finally {
      setStage("idle");
    }
  };
  // The address box holds something that is not an address: the list below is
  // still the previous address's, so it is dimmed and says so.
  const listIsStale = draftError !== null;
  const refreshing = chain.isFetching && !chain.isLoading;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Penalties on chain</h1>
          <p className="font-mono text-mono-12 text-03 [overflow-wrap:anywhere]">
            {DEPLOYMENT.displayName} · stake contract{" "}
            {shortAddress(DEPLOYMENT.chainId, DEPLOYMENT.stakeContract)}
            {chain.data ? ` · read up to block ${chain.data.scannedTo.toString()}` : ""}
          </p>
        </div>
        {checking ? (
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden="true" />}
            loading={chain.isFetching}
            onClick={() => void chain.refetch()}
          >
            {chain.isFetching ? "Refreshing…" : "Refresh from chain"}
          </Button>
        ) : null}
      </header>

      {/* ── Explainer ──────────────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-2 p-4 text-body-13 leading-[1.55] text-02 tablet:p-5">
          <p>
            <span className="font-semibold text-01">
              This list is read straight from the blockchain, not from Assay&apos;s servers.
            </span>{" "}
            Your browser asks the chain directly for every penalty proposed against the stake wallet
            below.
          </p>
          <p>
            A pending penalty only reserves part of your stake. It can be executed, and the money
            taken, once its timer ends — at the time shown on each penalty, which the chain fixed when
            it was proposed. If you think a penalty is wrong, dispute it before then.
          </p>
          <p>
            When a penalty is executed, {PENALTY_SPLIT.agentPercent}% goes to the harmed buyers,{" "}
            {PENALTY_SPLIT.platformPercent}% to Assay and {PENALTY_SPLIT.providerPercent}% stays with you.
            Every penalty is public on the blockchain, and you can dispute it to a person at Assay, not an
            automated system, before it can be executed.
          </p>
          <p>
            On your own stake wallet you can dispute pending penalties on chain: select them, up to{" "}
            {MAX_DISPUTE_SELECTION} at once, and choose &quot;Dispute selected on chain&quot;. Your
            stake wallet signs the transaction. A disputed penalty cannot be executed until Assay&apos;s
            arbiter rules; if nobody rules within 30 days, it can be expired and the stake released.
            This works even while your account is blocked or the contracts are paused.
          </p>
          <p>
            If this list ever disagrees with what Assay shows you elsewhere — in emails, in the case
            pages, anywhere — <span className="font-semibold text-01">the chain is right</span>. A
            pending penalty marked &quot;Not known to Assay&quot; is one Assay has no case for, and
            may be forged.
          </p>
        </PanelBody>
      </Panel>

      {/* ── Whose stake ────────────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Stake wallet</PanelTitle>
            <PanelDescription className="whitespace-normal [overflow-wrap:anywhere]">
              {viewingOwnStake
                ? "your stake wallet, as Assay reports it — check it is the wallet you staked from"
                : pasted
                  ? "an address you entered, checked read-only"
                  : "the wallet whose penalties are listed"}
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          {checking ? (
            <p className="font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{checking}</p>
          ) : stakeQuery.isLoading ? (
            <p className="text-body-13 text-03">Looking up your stake wallet…</p>
          ) : (
            <p className="text-body-13 text-02">
              {stakeQuery.isError
                ? "Your stake wallet could not be looked up. Paste the address you staked from below to check it."
                : `No stake wallet on ${DEPLOYMENT.displayName} is recorded for you. Paste an address below to check it.`}
            </p>
          )}

          <form onSubmit={check} className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-end">
            <label className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-label-13 text-01">Check another address</span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                className="w-full min-w-0 rounded-md border border-02 bg-01 px-3 py-2.5 font-mono text-mono-13 text-01 outline-none placeholder:text-03 focus:border-primary-500"
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Check
              </Button>
              {pasted && ownAddress ? (
                <Button type="button" variant="ghost" onClick={backToOwn}>
                  My stake wallet
                </Button>
              ) : null}
            </div>
          </form>
          {draftError ? <p className="text-body-xs text-danger-600">{draftError}</p> : null}
        </PanelBody>
      </Panel>

      {/* ── The list ───────────────────────────────────────────────────── */}
      {checking ? (
        <Panel className="w-full" aria-busy={chain.isFetching}>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Penalties</PanelTitle>
              <PanelDescription>
                {chain.data
                  ? `${openCount} need${openCount === 1 ? "s" : ""} attention · ${rows.length} in total · soonest executable first`
                  : "soonest executable first"}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
            {listIsStale ? (
              <p className="text-body-13 text-warning-700" role="status">
                The address you entered is not valid, so nothing new was checked. This list still
                belongs to the previous address,{" "}
                <span className="font-mono [overflow-wrap:anywhere]">{checking}</span>.
              </p>
            ) : null}
            {refreshing ? (
              <p className="text-body-13 text-03" role="status">
                Refreshing… reading the latest state from the chain.
              </p>
            ) : null}

            <div
              className={cn(
                "flex w-full min-w-0 flex-col gap-4 transition-opacity",
                (listIsStale || refreshing) && "opacity-50",
              )}
              inert={listIsStale}
            >
              {/* Filters */}
              <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2 tablet:grid-cols-3">
                <Select
                  label="Status"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((f) => ({ ...f, status: event.target.value as StatusFilter }))
                  }
                >
                  {STATUS_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Proposed"
                  value={filters.range}
                  onChange={(event) =>
                    setFilters((f) => ({ ...f, range: event.target.value as TimeRange }))
                  }
                >
                  {TIME_RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <label className="flex w-full min-w-0 flex-col gap-1.5 min-[480px]:col-span-2 tablet:col-span-1">
                  <span className="text-label-13 text-01">Search</span>
                  <Search
                    value={filters.query}
                    onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
                    placeholder="Request id or beneficiary"
                    aria-label="Search by request id or beneficiary"
                    shortcut={null}
                  />
                </label>
              </div>

              {viewingOwnStake &&
              assay.data?.status === "unavailable" &&
              rows.some((row) => row.status.needsAttention) ? (
                <p className="text-body-xs text-03">
                  Not checked against Assay: {assay.data.reason} The list itself is unaffected.
                </p>
              ) : null}
              {!viewingOwnStake && rows.some((row) => row.status.needsAttention) ? (
                <p className="text-body-xs text-03">
                  Not checked against Assay: these rows belong to an address you entered, and Assay
                  only matches penalties against your own cases on your own stake wallet. The list
                  itself is unaffected.
                </p>
              ) : null}

              {offerDispute && chain.data && (selectableRows.length > 0 || selected.size > 0 || disputeError || disputeNotice) ? (
                <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-01 bg-02 p-3">
                  <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-label-13 text-01" aria-live="polite">
                      {selected.size} of {MAX_DISPUTE_SELECTION} selected
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || selectableRows.length === 0 || limitReached}
                      onClick={() =>
                        setSelected(selectAllDisputable(selected, selectableRows, nowSeconds, viewingOwnStake))
                      }
                    >
                      Select all open
                    </Button>
                    {selected.size > 0 ? (
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                        Clear
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto"
                      disabled={selected.size === 0 || busy}
                      loading={busy}
                      onClick={() => void disputeSelected()}
                    >
                      {stage === "building"
                        ? "Preparing…"
                        : stage === "sending"
                          ? "Confirm in your wallet…"
                          : stage === "refreshing"
                            ? "Reading the chain…"
                            : "Dispute selected on chain"}
                    </Button>
                  </div>
                  {stage === "sending" ? (
                    <p className="text-body-xs text-02" role="status">
                      Sign the dispute in your stake wallet, then wait while the chain confirms it.
                    </p>
                  ) : null}
                  {signerState.status === "address-not-connected" || signerState.status === "no-wallet" ? (
                    <p className="text-body-xs text-03">
                      To dispute on chain, connect your stake wallet{" "}
                      <span className="font-mono [overflow-wrap:anywhere]">{ownAddress}</span>: it is the
                      only account the contract accepts a dispute from.
                    </p>
                  ) : null}
                  {disputeError ? (
                    <p className="text-body-13 text-danger-600" role="alert">
                      {disputeError}
                    </p>
                  ) : null}
                  {disputeNotice ? (
                    <p className="text-body-13 text-primary-700" role="status">
                      {disputeNotice}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {chain.isLoading ? (
                <p className="text-body-13 text-03">
                  Reading the chain… this scans every block since the stake contract was deployed, so
                  the first read can take a few seconds.
                </p>
              ) : chain.isError ? (
                <Banner
                  tone="danger"
                  title="The chain could not be read."
                  description={`We do not know whether there are penalties on this wallet — this is not the same as none. ${
                    chain.error instanceof Error ? chain.error.message.split("\n")[0] : ""
                  }`}
                  action={<BannerAction onClick={() => void chain.refetch()}>Try again</BannerAction>}
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  title="No penalties on chain"
                  description={`The chain holds no penalty, past or pending, against ${shortAddress(
                    DEPLOYMENT.chainId,
                    checking,
                  )}.`}
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  title="Nothing matches these filters"
                  description={
                    filters.status === "attention"
                      ? "No penalty needs your attention right now. Choose “All” to see past ones."
                      : "Try another status, a longer time range, or clear the search."
                  }
                />
              ) : (
                <ul className="flex w-full min-w-0 flex-col gap-3">
                  {visible.map((row) => (
                    <SlashRowCard
                      key={row.requestId}
                      row={row}
                      deployment={DEPLOYMENT}
                      asset={chain.data!.asset}
                      nowSeconds={nowSeconds}
                      match={assayMatchFor(row, viewingOwnStake ? (assay.data ?? null) : null)}
                      viewingOwnStake={viewingOwnStake}
                      selection={
                        offerDispute
                          ? {
                              notSelectable: notSelectableReason(row, nowSeconds, viewingOwnStake),
                              selected: selected.has(row.requestId.toLowerCase()),
                              limitReached,
                              locked: busy,
                              onToggle: () => toggle(row),
                            }
                          : null
                      }
                      refusals={refusals.get(row.requestId.toLowerCase()) ?? []}
                      justDisputed={justDisputed.has(row.requestId.toLowerCase())}
                    />
                  ))}
                </ul>
              )}

              {chain.data && !chain.data.asset.fromChain ? (
                <p className="text-body-xs text-03">
                  The stake token could not be read, so amounts assume {DEPLOYMENT.fallbackAssetSymbol} with{" "}
                  {DEPLOYMENT.fallbackAssetDecimals} decimals, as in the deployment record.
                </p>
              ) : null}
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <p className="text-body-xs text-03">
        Assay&apos;s own account of each case, with the evidence, is on the case pages and in{" "}
        <Link href="/provider/disputes" className="underline">
          Disputes
        </Link>
        .
      </p>
    </>
  );
}

export default function PenaltiesOnChainPage() {
  // `useSearchParams()` needs a Suspense boundary to build; same pattern as
  // `provider/disputes/new/page.tsx`.
  return (
    <React.Suspense fallback={null}>
      <PenaltiesOnChainContent />
    </React.Suspense>
  );
}
