"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { DepositSheet } from "@/components/buyer-money/deposit-sheet";
import { enablePaidSteps } from "@/components/buyer-money/let-agent-pay-sheet";
import { useBuyerMoney, useWalletBlocker } from "@/components/buyer-money/use-buyer-money";
import { EnablePaidView } from "@/components/delegation/enable-paid-view";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { capsToForm } from "@/features/buyer-money/caps";
import { confirmingLine, escrowLedgerRow, readyForPaidCalls } from "@/features/buyer-money/confirming";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import {
  collectPages,
  depositRunsHere,
  enablePaidFailure,
  enablePaidState,
  enablePaidPlan,
  enablePaidReturnHref,
  initialDraft,
  parseEnablePaidCaps,
  planSignatures,
  takePaymentKey,
  type CapsDraft,
  type EnablePaidCredential,
} from "@/features/delegation/enable-paid";
import { loweredDelayNote } from "@/features/delegation/unsettled";
import { loadPage, useFullLoadLinks } from "@/features/oauth/strict-pages";
import { useSearchParam } from "@/hooks/useSearchParam";
import { evmRpcUrl } from "@/libs/chains/evm/chains";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { firstDepositOpensEscrow } from "@/libs/chains/registry";
import { loginHref } from "@/libs/login-redirect";
import { listAgents, listCredentials, type Agent } from "@/services/account.service";
import { listDelegates } from "@/services/delegation.service";
import { addressOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

const HEADING = "Turn on paid calls";

type AgentWithCredentials = Agent & { credentials?: { items: EnablePaidCredential[]; hasMore: boolean } };

/**
 * Every agent and every one of its keys. `GET /agents?include=credentials`
 * carries each agent's first 50 keys; an agent with more (`hasMore`) has its
 * whole list read again from `GET /agents/:id/credentials`, page by page, so
 * the key this link names is found however many keys there are.
 */
async function readAgentsAndKeys(): Promise<{
  agents: AgentWithCredentials[];
  credentials: Record<string, EnablePaidCredential[]>;
}> {
  const agents = await collectPages(
    (cursor) =>
      listAgents({ limit: 50, cursor, include: "credentials" }) as unknown as Promise<{
        items: AgentWithCredentials[];
        pageInfo: { nextCursor: string | null; hasMore: boolean };
      }>,
  );
  const lists = await Promise.all(
    agents.map((agent) => {
      if (!agent.credentials) throw new Error("The agents came back without their keys");
      if (!agent.credentials.hasMore) return agent.credentials.items;
      return collectPages(
        (cursor) =>
          listCredentials(agent.agentId, { limit: 50, cursor }) as unknown as Promise<{
            items: EnablePaidCredential[];
            pageInfo: { nextCursor: string | null; hasMore: boolean };
          }>,
      );
    }),
  );
  return { agents, credentials: Object.fromEntries(agents.map((agent, i) => [agent.agentId, lists[i]!])) };
}

/**
 * `{WEB}/agents/enable-paid?credential={id}#key={address}`: the buyer approves,
 * with their wallet, the payment key `assay-mcp` made on their computer
 * (spec F4 step 5, R-PAY-1, R-PAY-2).
 *
 * The key in the fragment comes from the local app, never from a server, and
 * must equal the key bound to the credential; only the built-in app's grant or
 * an API key may hold one. Nothing is signed here but by the person's wallet,
 * with Privy's confirmation shown (R-WEB-5).
 *
 * A strict page (`_headers`: strict CSP, `frame-ancestors 'none'`, no
 * referrer; no analytics). Leaving it, sign-in included, is a full page load.
 */
export default function EnablePaidPage() {
  const { ready, authenticated } = usePrivy();
  const credentialId = useSearchParam("credential");
  const queryClient = useQueryClient();
  // undefined: not read yet (before mount).
  const [fragmentKey, setFragmentKey] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!credentialId) {
      setFragmentKey(null);
      return;
    }
    setFragmentKey(takePaymentKey(credentialId));
    // A new link pasted in this tab changes only the fragment: read the key again, and the
    // credential and its on-chain state with it, so every check runs on the new key (BUG-M3-02).
    const onHashChange = () => {
      setFragmentKey(takePaymentKey(credentialId));
      void queryClient.invalidateQueries({ queryKey: ["agents", "enable-paid"] });
      void queryClient.invalidateQueries({ queryKey: ["escrow-delegates", "live"] });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [credentialId, queryClient]);

  useFullLoadLinks();

  const signedOut = ready && !authenticated;
  React.useEffect(() => {
    if (signedOut) loadPage(loginHref({ next: (credentialId && enablePaidReturnHref(credentialId)) || "/agents/enable-paid" }));
  }, [signedOut, credentialId]);

  const signedIn = ready && authenticated;
  // Every agent with every key: one read for the agents and their first 50
  // keys, then the rest only for an agent that has more.
  const keysQuery = useQuery({
    queryKey: ["agents", "enable-paid"],
    enabled: signedIn,
    retry: false,
    staleTime: 0,
    queryFn: readAgentsAndKeys,
  });
  const agents = React.useMemo(() => keysQuery.data?.agents ?? [], [keysQuery.data]);
  const delegatesQuery = useQuery({
    queryKey: ["escrow-delegates", "live"],
    enabled: signedIn,
    retry: false,
    queryFn: () => listDelegates(Date.now()),
  });
  const money = useBuyerMoney();
  const blocked = useAccountReadOnly();
  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);

  const nowMs = Date.now();
  const state =
    keysQuery.data && delegatesQuery.data && fragmentKey !== undefined
      ? enablePaidState({
          credentialId: credentialId || null,
          fragmentKey,
          agents,
          credentials: keysQuery.data.credentials,
          delegates: delegatesQuery.data.delegates,
          nowMs,
          servesPaid: servesPaidCalls,
        })
      : null;

  // The form starts on Light (a renewal: the grant's caps, never above Light), once. Never from the URL.
  const [draft, setDraft] = React.useState<CapsDraft | null>(null);
  // Another key: the form starts again from that key's state.
  const [draftFor, setDraftFor] = React.useState(fragmentKey);
  if (draftFor !== fragmentKey) {
    setDraftFor(fragmentKey);
    setDraft(null);
  }
  if (state?.kind === "ready" && draft === null) setDraft(initialDraft(state));
  // The escrow ceiling when the page first read it, frozen so a retry resumes the same steps.
  const [openingCaps, setOpeningCaps] = React.useState<{ perCall: string; perWindow: string } | null | undefined>(
    undefined,
  );
  const escrow = money.escrow;
  if (openingCaps === undefined && money.escrowQuery.isSuccess) {
    setOpeningCaps(
      escrow?.maxVoucherAmount && escrow.maxPerWindow
        ? { perCall: escrow.maxVoucherAmount.amount || "0", perWindow: escrow.maxPerWindow.amount || "0" }
        : null,
    );
  }
  const [depositOpen, setDepositOpen] = React.useState(false);

  const failed = keysQuery.error ?? delegatesQuery.error ?? money.escrowQuery.error;
  if (!credentialId) return <Notice text="This link is missing which app it is for. Open the link your app showed again." />;
  if (failed) {
    return (
      <Notice
        text="That did not load. Try again."
        retry={() => {
          void keysQuery.refetch();
          void delegatesQuery.refetch();
          void money.escrowQuery.refetch();
        }}
      />
    );
  }
  if (!state || !money.escrowQuery.isSuccess || openingCaps === undefined) return <Notice text="Loading…" busy />;
  if (state.kind === "refused") return <Notice text={state.text} />;
  if (!draft) return <Notice text="Loading…" busy />;

  const parsed = parseEnablePaidCaps(draft, money.decimals);
  // What is signed is what is shown: the caps on the form (the grant and the ceiling) and
  // an expiry from this device's clock, checked against the server's (enablePaidPlan).
  const plan = enablePaidPlan({
    parsed,
    serverTime: escrow?.serverTime,
    receivedAtMs: money.escrowQuery.dataUpdatedAt,
    localNowMs: nowMs,
  });
  const chosen = plan.ok ? plan.chosen : null;
  const signatures = plan.ok ? planSignatures(openingCaps, plan.chosen).length : 1;
  const steps = plan.ok
    ? enablePaidSteps({
        money,
        queryClient,
        agentName: state.agentLabel,
        delegateAccount: state.delegateAccount,
        form: { perCall: draft.perCall, perDay: draft.perDay, days: parsed.ok ? parsed.days : 0 },
        openingCaps,
        plan,
      })
    : [];
  const current = state.grant.kind === "none" ? null : state.grant.delegation;
  const lowerNote =
    current && chosen
      ? loweredDelayNote(
          delegatesQuery.data?.tightenDelaySeconds,
          { maxVoucherAmount: current.maxVoucherAmount.amount, maxPerWindow: current.maxPerWindow.amount },
          chosen,
        )
      : null;
  const rpc = money.chainId ? evmRpcUrl(money.chainId) : null;
  const returnHref = enablePaidReturnHref(credentialId);
  const spendable = escrow?.spendable ?? escrow?.balance ?? null;
  const fundsShort =
    !escrow?.exists || !spendable || (chosen !== null && BigInt(spendable.amount || "0") < BigInt(chosen.maxPerWindow));
  // Shown, not used for the caps: a deposit the chain has not finalised is not spendable yet (BUG-A-06).
  const ledgerRow = escrowLedgerRow(money.balancesQuery.data?.balances, money.chainId);
  const shownBalance = readyForPaidCalls(escrow?.balance ?? null, ledgerRow);
  const blocker: React.ReactNode | null =
    money.chainId && money.chainId !== state.chainId
      ? "This payment key is for another network than your escrow."
      : !escrow?.exists && firstDepositOpensEscrow(money.chainId ?? state.chainId)
        ? "Add funds first: your first deposit opens your escrow."
        : walletBlocker;

  return (
    <div className="flex w-full flex-1 justify-center px-4 py-8 tablet:py-12">
      {/* Keyed by the key: a new one is ticked and signed afresh, never on the old one's progress. */}
      <EnablePaidView
        key={fragmentKey ?? ""}
        state={state}
        draft={draft}
        onDraftChange={setDraft}
        parsed={parsed}
        chainName={money.chainName ?? state.chainId}
        validUntil={plan.ok ? plan.validUntil : null}
        expiryProblem={plan.ok ? null : plan.problem}
        boundDays={plan.ok ? plan.boundDays : null}
        escrowAddress={escrow?.escrowPda ? addressOfAccount(escrow.escrowPda) : null}
        currentCeiling={capsToForm(escrow)}
        lowerNote={lowerNote}
        balance={shownBalance ? formatMoney(shownBalance) : escrow && !escrow.exists ? "$0.00" : null}
        confirming={confirmingLine(ledgerRow)}
        fundsShort={fundsShort}
        addFunds={
          depositRunsHere(rpc)
            ? { kind: "inline", onClick: () => setDepositOpen(true) }
            : {
                kind: "link",
                // Back here afterwards: the credential only, never the key. This tab's storage
                // still holds the key for this credential (takePaymentKey).
                href: returnHref
                  ? `/funding?action=deposit&returnTo=${encodeURIComponent(returnHref)}`
                  : "/funding?action=deposit",
              }
        }
        signatures={signatures}
        blocked={blocked}
        walletBlocker={blocker}
        steps={steps}
        describeError={(error) => enablePaidFailure(error) ?? describeMoneyError(error)}
      />
      {/* Only the escrow's own chain: the page's policy reaches only its RPC. */}
      <DepositSheet open={depositOpen} onOpenChange={setDepositOpen} onlyChainId={state.chainId} />
    </div>
  );
}

function Notice({ text, busy = false, retry }: { text: string; busy?: boolean; retry?: () => void }) {
  return (
    <div className="flex w-full flex-1 justify-center px-4 py-8 tablet:py-12">
      <section className="flex w-full max-w-[600px] flex-col gap-3 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
        <h1 className="text-heading-md text-01">{HEADING}</h1>
        <p role="status" aria-busy={busy || undefined} className="text-body-sm text-02">
          {text}
        </p>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            className="self-start text-label-13 font-semibold text-primary-600 hover:underline"
          >
            Try again
          </button>
        ) : null}
      </section>
    </div>
  );
}
