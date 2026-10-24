"use client";

import { useConnectWallet } from "@privy-io/react-auth";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { PROVIDER_PENALTIES_TABS } from "@/components/layout/provider-nav-config";
import { SectionTabs } from "@/components/layout/section-tabs";
import { Button } from "@/components/ui/button";
import { connectedSpelling } from "@/features/chain-calls/send-contract-call";
import { disputeStep } from "@/features/provider-penalties/dispute";
import {
  PENALTY_TABS,
  countByTab,
  isPenaltyTab,
  type PenaltyRow,
  type PenaltyTab,
} from "@/features/provider-penalties/model";
import { isOffChainCase, OffChainProposals, offChainRows, useOffChainProposals } from "@/features/provider-penalties/off-chain";
import { DisputeSheet, PenaltyDrawer, PenaltyRowCard } from "@/features/provider-penalties/penalty-ui";
import { PENALTY_DEPLOYMENT, caseKey, usePenalties } from "@/features/provider-penalties/use-penalties";
import { trackSubmissions } from "@/features/provider-stake/pending-chain-tx";
import { ProviderPendingTxList, useProviderPendingTransactions } from "@/features/provider-stake/pending-chain-tx-list";
import { txLink } from "@/features/provider-stake/stake-steps";
import {
  WALLET_READING,
  WALLET_READ_STALLED,
  simulatedSteps,
  useStalled,
} from "@/features/provider-stake/wallet-readiness";
import { useSearchParam } from "@/hooks/useSearchParam";
import { useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import { cn } from "@/utils";

/**
 * Penalties — route `/provider/penalties`. One page for what used to be three
 * (the on-chain list, the case page, the disputes list):
 *
 * - tabs Needs action / Disputed / Closed (`?tab=`);
 * - each row: tool, amount, window as a date range, the deadline as a
 *   countdown, Dispute (one signature on chain, from the stake wallet) and
 *   "Why?" (`?case=<request or case id>`), a drawer with the lifecycle,
 *   what it costs, the failures in words and the derivation folded away.
 *
 * Status, amounts and deadlines come from the chain; tool names, windows and
 * failures from Assay's case for the record. A pending record Assay has no
 * case for is flagged: it may not be genuine.
 */
const EXPLORER = PENALTY_DEPLOYMENT.explorerBaseUrl ? { explorerBaseUrl: PENALTY_DEPLOYMENT.explorerBaseUrl } : null;

const EMPTY: Record<PenaltyTab, { title: string; description: string }> = {
  "needs-action": {
    title: "Nothing needs you",
    description: "No penalty is open against your stake. If one is proposed, it shows here with its dispute deadline.",
  },
  disputed: {
    title: "No disputes waiting",
    description: "Penalties you dispute on chain wait here for the arbiter's ruling.",
  },
  closed: { title: "No closed penalties", description: "Executed, cancelled and expired penalties are kept here." },
};

export default function PenaltiesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tabParam = useSearchParam("tab");
  const caseParam = useSearchParam("case").toLowerCase();
  const penalties = usePenalties({ withCases: "all" });
  const counts = countByTab(penalties.rows);
  // Known to Assay, not on chain yet (lot 1 B8): the chain list cannot show them. None on a demo or an older backend.
  const offChainQuery = useOffChainProposals(!penalties.demo);
  const offChain = offChainRows(offChainQuery.data);
  const caseOffChain = isOffChainCase(offChain, caseParam);

  const requested = caseParam
    ? (penalties.rows.find((row) => row.id === caseParam || row.proposalId?.toLowerCase() === caseParam) ?? null)
    : null;
  const tab: PenaltyTab = isPenaltyTab(tabParam)
    ? tabParam
    : requested
      ? requested.tab
      : counts["needs-action"] === 0 && counts.disputed > 0
        ? "disputed"
        : "needs-action";
  const visible = penalties.rows.filter((row) => row.tab === tab);

  const setQuery = (next: { tab?: PenaltyTab; case?: string | null }) => {
    const params = new URLSearchParams();
    params.set("tab", next.tab ?? tab);
    const nextCase = next.case === undefined ? caseParam : next.case;
    if (nextCase) params.set("case", nextCase);
    router.replace(`/provider/penalties?${params.toString()}`, { scroll: false });
  };

  // ── Dispute on chain, from the stake wallet only ───────────────────────
  const connected = useConnectedAddresses();
  const signerState = useSigner({
    chainId: PENALTY_DEPLOYMENT.chainId,
    address: penalties.ownAddress ? connectedSpelling(connected, penalties.ownAddress) : undefined,
  });
  const reading = signerState.status === "hydrating" || signerState.status === "chain-unknown";
  const stalled = useStalled(reading);
  // DEMO ONLY (build-time flag): the dispute is walked through without a wallet.
  const simulated = penalties.demo;
  const disputeBlocked = simulated
    ? null
    : !penalties.ownAddress
    ? "Disputes are recorded on chain against your stake, so they are sent from the wallet that holds it. Confirm that wallet on the Stake page first."
    : signerState.status === "ready"
      ? null
      : reading
        ? stalled
          ? WALLET_READ_STALLED
          : WALLET_READING
        : `Disputes are recorded on chain against your stake, so only the wallet that holds it can file one. Connect that wallet (${penalties.ownAddress.slice(0, 6)}…${penalties.ownAddress.slice(-4)}) in this browser.`;

  const { connectWallet } = useConnectWallet();
  const needsConnect =
    !simulated && Boolean(penalties.ownAddress) && signerState.status !== "ready" && (!reading || stalled);
  const onConnect = needsConnect ? () => connectWallet({ walletChainType: "ethereum-and-solana" }) : undefined;

  const [disputing, setDisputing] = React.useState<PenaltyRow | null>(null);
  const pending = useProviderPendingTransactions();
  const realSteps = disputing
    ? [
        disputeStep({
          requestId: disputing.requestId,
          deployment: PENALTY_DEPLOYMENT,
          ownAddress: penalties.ownAddress,
          signer: signerState.status === "ready" ? signerState.signer : null,
          explorerUrl: (hash) => txLink(EXPLORER, hash),
        }),
      ]
    : [];
  const disputingTool = disputing ? (penalties.caseFor(disputing)?.proposal.toolName ?? null) : null;
  const steps = simulated
    ? simulatedSteps(realSteps)
    : trackSubmissions(
        realSteps,
        {
          kind: "dispute",
          chainId: PENALTY_DEPLOYMENT.chainId,
          idPrefix: `dispute:${disputing?.requestId ?? ""}`,
          label: () => (disputingTool ? `Dispute the ${disputingTool} penalty` : "Dispute a penalty"),
        },
        pending,
      );

  const onDisputed = () => {
    void penalties.refetch();
    if (disputing?.proposalId) void queryClient.invalidateQueries({ queryKey: caseKey(disputing.proposalId) });
  };

  return (
    <>
      <SectionTabs tabs={PROVIDER_PENALTIES_TABS} label="Penalties" />
      <header className="flex w-full flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Penalties</h1>
          <p className="text-body-13 text-03">
            Read straight from the chain. Nothing is taken before its deadline, and you can dispute it until then.
          </p>
        </div>
        {!penalties.demo && penalties.ownAddress ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw aria-hidden="true" />}
            loading={penalties.isFetching}
            onClick={() => void penalties.refetch()}
          >
            Refresh
          </Button>
        ) : null}
      </header>

      <ProviderPendingTxList kinds={["dispute"]} />

      {penalties.updating ? (
        <p role="status" className="w-full text-body-xs text-03">
          Showing your penalties as last read. Updating from the chain…
        </p>
      ) : null}

      <div role="tablist" aria-label="Penalties" className="flex w-full gap-1 overflow-x-auto border-b border-01">
        {PENALTY_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setQuery({ tab: item.id, case: null })}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-label-13",
              tab === item.id ? "border-primary-500 text-01" : "border-transparent text-03 hover:text-01",
            )}
          >
            {item.label}
            {counts[item.id] > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-mono-2xs",
                  item.id === "needs-action" ? "bg-danger-500 text-on-color" : "bg-03 text-02",
                )}
              >
                {counts[item.id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {caseParam && !requested && caseOffChain ? (
        <p role="status" className="w-full rounded-lg border border-01 bg-01 px-4 py-3 text-body-13 text-02" data-testid="penalty-case-off-chain">
          That penalty is proposed but not on your stake on the chain yet, so it is listed under &ldquo;Proposed, not yet
          on chain&rdquo; below. Nothing can be taken before it is on chain.{" "}
          <button type="button" className="text-primary-600 underline-offset-2 hover:underline" onClick={() => setQuery({ case: null })}>
            Dismiss
          </button>
        </p>
      ) : caseParam && !requested && !penalties.isLoading && !penalties.isError ? (
        <p role="status" className="w-full rounded-lg border border-01 bg-01 px-4 py-3 text-body-13 text-02">
          We cannot open that penalty: it is not on your stake on the chain, which is where this page reads penalties
          from. If it was proposed just now, it can take a moment to appear there.{" "}
          <button type="button" className="text-primary-600 underline-offset-2 hover:underline" onClick={() => setQuery({ case: null })}>
            Dismiss
          </button>
        </p>
      ) : null}

      {penalties.isLoading ? (
        <PageState kind="loading" label="Reading your penalties from the chain" rows={3} />
      ) : penalties.noStakeWallet ? (
        <PageState
          kind="empty"
          title="No stake wallet yet"
          description={
            offChain.length > 0
              ? "Penalties are taken from a stake wallet, read from the chain. You have no stake wallet yet, so none is on chain; the proposals below are known to Assay only."
              : "This page lists the penalties on your stake wallet, read from the chain. You have no stake wallet yet, so it has nothing to list."
          }
          action={{ label: "Go to Stake", href: "/provider/capital" }}
        />
      ) : penalties.isError ? (
        <PageState
          kind="error"
          title="The chain could not be read"
          description="We do not know whether there are penalties right now — this is not the same as none."
          onRetry={() => void penalties.refetch()}
          details={penalties.error instanceof Error ? penalties.error.message.split("\n")[0] : null}
        />
      ) : visible.length === 0 ? (
        <PageState kind="empty" title={EMPTY[tab].title} description={EMPTY[tab].description} />
      ) : (
        <ul className="flex w-full flex-col gap-3">
          {visible.map((row) => (
            <PenaltyRowCard
              key={row.id}
              row={row}
              detail={penalties.caseFor(row)}
              nowSeconds={penalties.nowSeconds}
              onWhy={() => setQuery({ case: row.id })}
              onDispute={() => setDisputing(row)}
              disputeBlocked={disputeBlocked}
              onConnect={onConnect}
            />
          ))}
        </ul>
      )}

      <OffChainProposals rows={offChain} highlight={caseOffChain ? caseParam : undefined} />

      {penalties.lookupUnavailable ? (
        <p className="text-body-xs text-03">
          Assay could not be asked which tool each penalty is about, so some rows show no tool name. The amounts and
          deadlines come from the chain and are unaffected.
        </p>
      ) : null}

      <PenaltyDrawer
        row={requested}
        detail={requested ? penalties.caseFor(requested) : null}
        nowSeconds={penalties.nowSeconds}
        onOpenChange={(open) => {
          if (!open) setQuery({ case: null });
        }}
        onDispute={() => {
          if (!requested) return;
          setDisputing(requested);
          setQuery({ case: null });
        }}
        disputeBlocked={disputeBlocked}
              onConnect={onConnect}
      />

      <DisputeSheet
        row={disputing}
        toolName={disputingTool}
        steps={steps}
        onOpenChange={(open) => {
          if (!open) setDisputing(null);
        }}
        onDisputed={onDisputed}
      />
    </>
  );
}
