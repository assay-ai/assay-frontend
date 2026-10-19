"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { DepositSheet } from "@/components/buyer-money/deposit-sheet";
import { agentPaySteps } from "@/components/buyer-money/let-agent-pay-sheet";
import { useBuyerMoney, useWalletBlocker } from "@/components/buyer-money/use-buyer-money";
import { EnablePaidView } from "@/components/delegation/enable-paid-view";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { capsToForm } from "@/features/buyer-money/caps";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import {
  ENABLE_PAID_MAX_DAYS,
  collectPages,
  depositRunsHere,
  enablePaidFailure,
  enablePaidState,
  initialDraft,
  pageExpiry,
  parseEnablePaidCaps,
  planSignatures,
  takePaymentKey,
  thisPageHref,
  type CapsDraft,
  type EnablePaidCredential,
} from "@/features/delegation/enable-paid";
import { loweredDelayNote } from "@/features/delegation/unsettled";
import { loadPage, useFullLoadLinks } from "@/features/oauth/strict-pages";
import { useSearchParam } from "@/hooks/useSearchParam";
import { evmRpcUrl } from "@/libs/chains/evm/chains";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { loginHref } from "@/libs/login-redirect";
import { listAgents, listCredentials } from "@/services/account.service";
import { listDelegates } from "@/services/delegation.service";
import { addressOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

const HEADING = "Turn on paid calls";

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
  // undefined: not read yet (before mount).
  const [fragmentKey, setFragmentKey] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setFragmentKey(credentialId ? takePaymentKey(credentialId) : null);
  }, [credentialId]);

  useFullLoadLinks();

  const signedOut = ready && !authenticated;
  React.useEffect(() => {
    if (signedOut) loadPage(loginHref({ next: thisPageHref() }));
  }, [signedOut]);

  const signedIn = ready && authenticated;
  const agentsQuery = useQuery({
    queryKey: ["agents", "enable-paid"],
    enabled: signedIn,
    retry: false,
    queryFn: () => collectPages((cursor) => listAgents({ limit: 50, cursor })),
  });
  const agents = React.useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const credentialsQuery = useQuery({
    queryKey: ["agent-keys", "enable-paid", agents.map((a) => a.agentId)],
    enabled: signedIn && agentsQuery.isSuccess,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const lists = await Promise.all(
        agents.map((a) =>
          collectPages(
            (cursor) =>
              listCredentials(a.agentId, { limit: 50, cursor }) as unknown as Promise<{
                items: EnablePaidCredential[];
                pageInfo: { nextCursor: string | null; hasMore: boolean };
              }>,
          ),
        ),
      );
      return Object.fromEntries(agents.map((a, i) => [a.agentId, lists[i]!]));
    },
  });
  const delegatesQuery = useQuery({
    queryKey: ["escrow-delegates", "live"],
    enabled: signedIn,
    retry: false,
    queryFn: () => listDelegates(Date.now()),
  });
  const money = useBuyerMoney();
  const queryClient = useQueryClient();
  const blocked = useAccountReadOnly();
  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);

  const nowMs = Date.now();
  const state =
    credentialsQuery.data && delegatesQuery.data && fragmentKey !== undefined
      ? enablePaidState({
          credentialId: credentialId || null,
          fragmentKey,
          agents,
          credentials: credentialsQuery.data,
          delegates: delegatesQuery.data.delegates,
          nowMs,
          servesPaid: servesPaidCalls,
        })
      : null;

  // The form starts on Light (a renewal: the grant's caps, never above Light), once. Never from the URL.
  const [draft, setDraft] = React.useState<CapsDraft | null>(null);
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

  const failed = agentsQuery.error ?? credentialsQuery.error ?? delegatesQuery.error ?? money.escrowQuery.error;
  if (!credentialId) return <Notice text="This link is missing which app it is for. Open the link your app showed again." />;
  if (failed) {
    return (
      <Notice
        text="That did not load. Try again."
        retry={() => {
          void agentsQuery.refetch();
          void credentialsQuery.refetch();
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
  const chosen = parsed.ok ? { maxVoucherAmount: parsed.maxVoucherAmount, maxPerWindow: parsed.maxPerWindow } : null;
  // The expiry shown is the expiry signed: this device's clock, checked against the server's.
  const expiry = parsed.ok
    ? pageExpiry({
        localNowMs: nowMs,
        serverTime: escrow?.serverTime,
        receivedAtMs: money.escrowQuery.dataUpdatedAt,
        days: parsed.days,
      })
    : null;
  const validUntil = expiry?.ok ? new Date(expiry.validUntil * 1000).toISOString() : null;
  const signatures = chosen ? planSignatures(openingCaps, chosen).length : 1;
  const steps = agentPaySteps({
    money,
    queryClient,
    agentName: state.agentLabel,
    delegateAccount: state.delegateAccount,
    chosen,
    form: { perCall: draft.perCall, perDay: draft.perDay, days: parsed.ok ? parsed.days : 0 },
    openingCaps,
    nowSeconds: Math.floor(nowMs / 1000),
    // SetLimits signs the ceiling the page shows: the person's caps, never values from the API.
    ceiling: chosen ?? undefined,
    expiry: expiry?.ok ? { validUntil: expiry.validUntil, maxDays: ENABLE_PAID_MAX_DAYS } : undefined,
  });
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
  const spendable = escrow?.spendable ?? escrow?.balance ?? null;
  const fundsShort =
    !escrow?.exists || !spendable || (chosen !== null && BigInt(spendable.amount || "0") < BigInt(chosen.maxPerWindow));
  const blocker: React.ReactNode | null =
    money.chainId && money.chainId !== state.chainId
      ? "This payment key is for another network than your escrow."
      : !escrow?.exists
        ? "Add funds first: your first deposit opens your escrow."
        : walletBlocker;

  return (
    <div className="flex w-full flex-1 justify-center px-4 py-8 tablet:py-12">
      <EnablePaidView
        state={state}
        draft={draft}
        onDraftChange={setDraft}
        parsed={parsed}
        chainName={money.chainName ?? state.chainId}
        validUntil={validUntil}
        expiryProblem={expiry && !expiry.ok ? expiry.text : null}
        boundDays={expiry?.ok ? expiry.boundDays : null}
        escrowAddress={escrow?.escrowPda ? addressOfAccount(escrow.escrowPda) : null}
        currentCeiling={capsToForm(escrow)}
        lowerNote={lowerNote}
        balance={escrow?.balance ? formatMoney(escrow.balance) : null}
        fundsShort={fundsShort}
        addFunds={
          depositRunsHere(rpc) ? { kind: "inline", onClick: () => setDepositOpen(true) } : { kind: "link", href: "/funding" }
        }
        signatures={signatures}
        blocked={blocked}
        walletBlocker={blocker}
        steps={steps}
        describeError={(error) => enablePaidFailure(error) ?? describeMoneyError(error)}
      />
      <DepositSheet open={depositOpen} onOpenChange={setDepositOpen} />
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
