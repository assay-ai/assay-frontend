"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpFromLine, Download, PenLine, ShieldCheck, Wallet } from "lucide-react";
import * as React from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { signProofChallenge } from "@/features/provider-proof/sign-proof-challenge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, type TableColumn } from "@/components/ui/table";
import { dateOnly } from "@/components/g31/format";
import { runStakeIntent } from "@/features/provider-stake/run-stake-intent";
import { isUserRejection, useSigner, type UseSignerResult } from "@/hooks/useSigner";
import type {
  ProviderPayoutAccount,
  ProviderStake,
  SlaWindow,
  StakeIntent,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { describeChainRefusal } from "@/libs/chains/status-labels";
import { getProviderRegistration } from "@/services/provider-registration.service";
import { exportProviderCalls } from "@/services/provider-reports.service";
import { listSlaWindows } from "@/services/provider-sla-windows.service";
import { stakeActionChain, withProvedStakeAuthority } from "@/features/provider-stake/chain-stake";
import {
  createStakeAuthorityChallenge,
  proveStakeAuthority,
} from "@/services/provider-stake-authority.service";
import {
  createStakeWithdrawIntent,
  createUnstakeIntent,
  getProviderStake,
} from "@/services/provider-stake.service";
import { isSolanaTransaction } from "@/interfaces/chain-transaction";
import { unsignedPayloadSummary } from "@/libs/chains/unsigned-summary";
import { chainIdOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

/**
 * Exit checklist.
 *
 * Page Header (two secondary buttons) / Panel "What has to close first" /
 * primary Note, straight down the frame. The shell, its 16px gap and its
 * [22, 26] padding come from the `(console)` layout.
 *
 * ## There is no exit endpoint. This screen is an assembly.
 *
 * No `/providers/me/exit`, no close-account route, no "pending payout
 * balance", no published unbonding-period length. The five checklist rows are
 * joined here from four reads:
 *
 * | Row                   | State                              | When                          |
 * |-----------------------|------------------------------------|-------------------------------|
 * | Open windows close    | `sla-windows` status != CLOSED     | earliest `deadlineAt`         |
 * | Unbonding period      | `stake.unbondingStartedAt/…At` gap | `unbondingCompletesAt`        |
 * | Pending earnings paid | **no source — `—`**                | `terms.commercialTerms` payout|
 * | Data export           | what `calls/export` actually is    | synchronous                   |
 * | Stake returned        | `stake.staked`                     | after unbonding               |
 *
 * The **Step** and **Why** columns are the design's words verbatim: they are
 * rationale, identical for every provider, and they are the reason the row is
 * on the list. The **State** and **When** cells are data, so the frame's
 * `$18.22` / `w_4482 in ~4 days` are mock values, not copy — they are read.
 *
 * ## The one row that cannot be honest, and the dash it renders
 *
 * "Pending earnings paid" has no endpoint. `GET /providers/me/earnings` is
 * earned-in-a-window, `GET /providers/me/payouts` is paid-in-batches, and
 * subtracting one from the other would put a real-looking dollar figure under
 * a label that means "what you are still owed" — on the single screen a
 * provider reads to find out whether leaving costs them money. It renders the
 * design's own unknown treatment instead.
 *
 * ## Why the exit is currently a dead end, and why the screen says so
 *
 * The goal is that leaving and withdrawing stake must be genuinely possible.
 * It is not, today, for the seeded provider: `stake.stakeAuthority` is `null`,
 * so every one of the four stake intents answers
 * `409 PROVIDER_STAKE_AUTHORITY_UNPROVEN` — measured on the wire. A checklist
 * that drew five neat rows over that would be exactly the lie this screen
 * exists to prevent, so the unproven case raises a banner and the banner
 * carries the flow that clears it (challenge → sign in your wallet → prove).
 *
 * The frame draws no such flow. It is added deliberately:
 * without it, both of the frame's own buttons 409 and the provider has no
 * route from this screen to a state where they do not.
 *
 * ## Nothing here signs on the platform's behalf
 *
 * The backend cannot sign a stake intent by construction — it holds no
 * provider key — so both buttons build **unsigned** bytes and hand them to
 * `IntentResult`, which now carries the signing control itself: the
 * provider's own wallet (scoped by address to the stake authority, see
 * `authorityAddress`) signs AND broadcasts via `runStakeIntent`. There is no
 * submit endpoint and there must never be one. Gas is a fixed ceiling in the
 * chain's native asset, which is deliberately absent from the asset registry,
 * so it is printed with no `$`.
 *
 * A blocked withdrawal is a **201 with `transaction: null`**, not an error;
 * `blockedBy` is read before `transaction`, and when both limits bite the
 * program reports `UNBONDING_NOT_MATURED` because it checks maturity first.
 */

const DASH = "—";

/** "in ~4 days" / "in ~7h" / "in ~22m". Coarse on purpose — the design writes ~. */
function untilLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return DASH;
  const ms = then - now;
  if (ms <= 0) return "now";
  if (ms < 3_600_000) return `in ~${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 172_800_000) return `in ~${Math.round(ms / 3_600_000)}h`;
  return `in ~${Math.round(ms / 86_400_000)} days`;
}

/** Whole days between two stamps, which is the only place the period length exists. */
function periodDays(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  const days = Math.round((b - a) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} after request`;
}

/**
 * The CAIP-2 chain to prove a stake authority on.
 *
 * There is **no deployment-chain-id endpoint** — so none is invented. Two
 * real values on the wire already carry the chain, so the field is seeded from
 * one of them and stays editable rather than being hardcoded: the proved
 * payout address is CAIP-10 (`solana:<genesis>:<addr>`) and the stake asset is
 * CAIP-19 (`solana:<genesis>/token:<mint>`).
 */
function chainIdFrom(payoutAccountId: string | null | undefined, asset: string | undefined): string {
  return chainIdOfAccount(payoutAccountId) ?? (asset ? asset.split("/")[0] : "");
}

/**
 * The chain to seed from, out of the provider's payout enrolments.
 *
 * Payout addresses are a list, one per chain, so "the"
 * address no longer exists and something has to choose. An **`ACTIVE`**
 * enrolment is preferred over any other: a suspended or unbonding chain is one
 * the platform is not paying on, and seeding a stake-authority proof with it
 * would point a provider at the chain least worth staking on. The first proved
 * chain is the fallback rather than nothing, because a wrong-looking prefill
 * in an editable field is recoverable and an empty one still costs the provider
 * the same typing it always did.
 */
function seedAccountId(payoutAccounts: readonly ProviderPayoutAccount[]): string | null {
  const active = payoutAccounts.find((account) => account.status === "ACTIVE");
  return (active ?? payoutAccounts[0])?.accountId ?? null;
}

/**
 * `stake.stakeAuthority` is CAIP-10 (`solana:<genesis>:<address>`); `useSigner`
 * needs the bare base58 address. Mirrors `authorityAddress` in
 * `provider/capital/page.tsx` — duplicated rather than shared for the same
 * reason `chainIdFrom` above is not imported from there: it is a five-line
 * pure function, not a module worth coupling two routes to.
 *
 * Returns `""` (never `undefined`) for "no known authority", which is the
 * point: passed to `useSigner({ address })` this becomes a **defined**,
 * unmatchable address, so the hook answers `address-not-connected` rather than
 * falling back to "the first wallet" — see `hooks/useSigner.ts`'s module doc.
 */
function authorityAddress(stakeAuthority: string | null | undefined): string {
  if (!stakeAuthority) return "";
  const segments = stakeAuthority.split(":");
  return segments.length >= 3 ? segments[segments.length - 1] : stakeAuthority;
}

/**
 * What the last press of "Sign in your wallet and prove" ended as.
 *
 * Four failure states, not one, and they are `useSigner`'s own distinctions
 * carried through to the copy: "no wallet is connected", "no *connected* wallet
 * holds the address you typed", "you closed the prompt" and "the wallet threw"
 * need four different next actions. Platform refusals are not in here — those
 * are an `ApiError` with its own code and sentence, and they land in `error`.
 */
type SheetWalletState =
  | "idle"
  | "prompting"
  | "no-wallet"
  | "address-not-connected"
  | "declined"
  | "rejected";

interface ChecklistRow {
  id: string;
  step: string;
  state: string;
  when: string;
  why: string;
}

const COLUMNS: TableColumn<ChecklistRow>[] = [
  {
    key: "step",
    header: "Step",
    mono: true,
    // The frame sets the identity cell at 600 while every other cell is
    // normal; Table carries no per-column weight, so it rides on the value.
    cell: (row) => <span className="font-semibold">{row.step}</span>,
  },
  {
    key: "state",
    header: "State",
    width: 200,
    align: "end",
    mono: true,
    // The frame's own longest value ("$50.00 less any executed penalty") is
    // wider than the 200px it sits in, and the frame lets it bleed left into
    // the Step column's slack rather than clipping. Ellipsising it here turned
    // the stake figure into "$500.00 less any execute…".
    noTruncate: true,
    cell: (r) => <span className="whitespace-nowrap">{r.state}</span>,
  },
  { key: "when", header: "When", width: 230, align: "end", mono: true, cell: (r) => r.when },
  {
    key: "why",
    header: "Why",
    width: 420,
    align: "end",
    mono: true,
    // Sentences the design deliberately lets run to the full column width.
    noTruncate: true,
    cell: (r) => r.why,
  },
];

/**
 * What one intent response says, and the control that signs and broadcasts
 * it.
 *
 * The stake authority address and the signer scoped to it are threaded in as
 * props — this component has no query and no signer of its own, and the
 * signer MUST be scoped by address (never "the first wallet"): see
 * `authorityAddress` and `hooks/useSigner.ts`'s module doc. The platform never
 * sees the signed bytes; `runStakeIntent` decodes `transaction.transactionBase64`,
 * derives the chain from `intent.account`, and the provider's own wallet both
 * signs and broadcasts — there is no submit endpoint and there must never be
 * one (`provider/capital/page.tsx` is the working precedent for this shape).
 */
function IntentResult({
  intent,
  stakeAuthorityAddress,
  signerState,
}: {
  intent: StakeIntent;
  stakeAuthorityAddress: string;
  signerState: UseSignerResult;
}) {
  const gas = formatMoney(intent.preflight.requiredGas, { decimals: 4, symbol: "" });
  const [broadcasting, setBroadcasting] = React.useState(false);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [signError, setSignError] = React.useState<string | null>(null);

  // `blockedBy` is read FIRST. A blocked withdrawal is a 201 whose
  // `transaction` is null, and reading the transaction first turns the
  // answer into a missing-field bug.
  if (intent.blockedBy) {
    return (
      <Banner
        tone="warning"
        title={
          intent.blockedBy === "UNBONDING_NOT_MATURED"
            ? "Nothing can be withdrawn yet — the unbonding period has not matured"
            : "Nothing can be withdrawn yet — stake is still backing calls that have not settled"
        }
        description={`${
          intent.withdrawable
            ? `${formatMoney(intent.withdrawable, { decimals: 2 })} would go through today.`
            : "Nothing would go through today."
        } No transaction was built, so this cost you no network fee. (${intent.blockedBy})`}
      />
    );
  }

  if (!intent.transaction) {
    return (
      <Banner
        tone="warning"
        title="No transaction was built"
        description="The request was answered and the answer carried no bytes to sign."
      />
    );
  }

  /*
   * Four `useSigner` states, handled distinctly rather than folded into one
   * "can't sign" branch — see `hooks/useSigner.ts`'s module doc.
   *   - `hydrating`  — Privy is still building the wallet list; not an answer,
   *     do nothing and let the provider press again.
   *   - `address-not-connected` — a real wallet is connected, just not the one
   *     that holds the stake authority; name the address so the fix is
   *     obvious rather than leaving the provider to guess.
   *   - anything else non-`ready` (`no-wallet`) — ask them to connect one.
   *   - `ready` — sign and broadcast.
   */
  async function signAndBroadcast() {
    if (signerState.status === "chain-unknown") {
      /*
        Not "connect a wallet". The chain has not been read yet, so there is
        nothing to connect and no sentence about wallets that is true — the
        button re-enables the moment the query answers.
      */
      setSignError("Still reading which chain this is on. Try again in a moment.");
      return;
    }
    if (signerState.status === "hydrating") return;
    if (signerState.status === "address-not-connected") {
      setSignError(
        stakeAuthorityAddress
          ? `Connect the wallet that holds ${stakeAuthorityAddress}, or correct the address.`
          : "Connect the wallet that holds the stake authority for this account.",
      );
      return;
    }
    if (signerState.status !== "ready") {
      setSignError("Connect a wallet to sign this.");
      return;
    }
    setSignError(null);
    setBroadcasting(true);
    try {
      // Throws a readable sentence when `intent.transaction` is null — a
      // legitimate 201 carrying `blockedBy`, not an error path. Unreachable
      // here (guarded above), but `runStakeIntent` still owns that check.
      const result = await runStakeIntent(intent, signerState.signer);
      setSignature(result.signature);
    } catch (e) {
      if (isUserRejection(e)) {
        // The prompt was closed or declined. Nothing was signed and nothing
        // was broadcast.
        setSignError("Nothing was signed — the wallet prompt was closed or declined.");
      } else {
        setSignError(e instanceof Error ? e.message : "The wallet did not complete this.");
      }
    } finally {
      setBroadcasting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2.5">
      <Banner
        tone="primary"
        title={`${intent.kind === "UNSTAKE" ? "Unstake" : "Withdraw"} of ${formatMoney(intent.amount, {
          decimals: 2,
        })} is ready for your wallet`}
        description={`Unsigned — the platform holds no key of yours and cannot sign this. ${unsignedPayloadSummary(intent.transaction)} Gas budget ${gas} in the chain's native asset (a ceiling, not a quote). ${intent.preflight.gasNotSponsoredReason}`}
      />
      {signature ? (
        <Banner
          tone="primary"
          title={`${intent.kind === "UNSTAKE" ? "Unstake" : "Withdrawal"} was broadcast`}
          description={`Signature ${signature}. Your wallet sent this, not the platform. The checklist above reads from the chain when the stake source next observes it, so it will not move immediately.`}
        />
      ) : (
        <Button
          type="button"
          icon={<PenLine />}
          loading={broadcasting}
          disabled={broadcasting}
          onClick={signAndBroadcast}
        >
          Sign in your wallet and broadcast
        </Button>
      )}
      {signError ? <p className="text-body-13 text-danger-600">{signError}</p> : null}
    </div>
  );
}

export default function ProviderExitPage() {
  const queryClient = useQueryClient();
  const [intent, setIntent] = React.useState<StakeIntent | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);
  const [exportNote, setExportNote] = React.useState<string | null>(null);
  const [proving, setProving] = React.useState(false);

  const stake = useQuery({ queryKey: ["provider", "stake"], queryFn: getProviderStake });
  const registration = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    retry: false,
  });
  const windows = useQuery({
    queryKey: ["provider", "sla-windows", "exit"],
    queryFn: () => listSlaWindows({ limit: 50 }),
  });

  /*
    The stake is per chain now, and every action on this screen acts on ONE
    chain — `unstake` and `withdraw` name that chain's stake authority as fee
    payer and sole signer. `stakeActionChain` resolves it by a stated rule and
    answers `null` when there is no unambiguous one, which disables the actions
    rather than building a transaction for a chain the provider did not choose.
    These three lines used to read the top level of the response, where the
    fields no longer are — every one of them was `undefined`.
  */
  const actionChain = stakeActionChain(stake.data);
  const staked = actionChain?.staked ?? null;
  const unbonding = actionChain?.unbonding ?? null;
  const authorityProven = Boolean(actionChain?.stakeAuthority);

  /*
    Scoped to the stake authority, not to "me" — see `IntentResult`'s
    docstring and `hooks/useSigner.ts`'s module doc. Computed once here,
    the same way `provider/capital/page.tsx` does it, so the sign control
    below can never disagree with what the rest of the page knows about which
    wallet is available.
  */
  const stakeAuthority = authorityAddress(actionChain?.stakeAuthority);
  /* The chain the stake account is on, read off its CAIP-10 authority. */
  const signerState = useSigner({
    chainId: chainIdOfAccount(actionChain?.stakeAuthority),
    address: stakeAuthority,
  });

  /* `OPEN` is the only non-closed status `SlaWindowStatus` has (per-binding windows made
     it a real two-value enum, `OPEN | CLOSED` — `IN_PROGRESS` was the
     earlier name). The filter is still written as "not CLOSED" rather than
     "is OPEN" so a future status is not silently counted as closed on the
     screen that says when you may leave. */
  const openWindows: SlaWindow[] = React.useMemo(
    () => (windows.data?.items ?? []).filter((w) => w.status !== "CLOSED"),
    [windows.data],
  );
  const earliestOpen = React.useMemo(
    () =>
      openWindows
        .slice()
        .sort((a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime())[0] ??
      null,
    [openWindows],
  );

  /* The payout cadence is the platform's own sentence, already assembled on the
     registration's commercial terms. It is the only
     published answer to "when" for the earnings row, and printing the server's
     copy beats inventing a countdown to a batch nothing exposes. */
  const payoutCadence =
    registration.data?.terms.commercialTerms.find((t) => t.key === "payouts")?.value ?? null;

  const rows: ChecklistRow[] = [
    {
      id: "windows",
      step: "Open windows close",
      state: windows.isSuccess
        ? openWindows.length === 0
          ? "0 open"
          : `${openWindows.length} open · ${openWindows.map((w) => w.label).join(", ")}`
        : DASH,
      when: earliestOpen ? `${earliestOpen.label} ${untilLabel(earliestOpen.deadlineAt)}` : DASH,
      why: "a window that has not closed has not been measured",
    },
    {
      id: "unbonding",
      step: "Unbonding period",
      /* The length of the unbonding period is published NOWHERE — not on the
         stake response, not in the commercial terms, not in an economic
         parameters endpoint (there is none). The only place it exists is the
         gap between a running clock's two ends, so it is stated when a clock
         is running and dashed when one is not. A documented "7 days" is not a
         source. */
      state: periodDays(actionChain?.unbondingStartedAt ?? null, actionChain?.unbondingCompletesAt ?? null) ??
        /*
          "not requested" only when there IS a chain to say it about. With no
          unambiguous chain the honest answer is the dash: this row cannot tell
          a provider nothing is unbonding on a chain it has not identified.
        */
        (stake.isSuccess && actionChain ? "not requested" : DASH),
      when: actionChain?.unbondingCompletesAt
        ? `earliest ${dateOnly(actionChain.unbondingCompletesAt)}`
        : DASH,
      why: "without it a provider could serve bad data and withdraw before the window that measures it closes",
    },
    {
      id: "earnings",
      step: "Pending earnings paid",
      // No endpoint states what is earned and not yet paid. See the docstring.
      state: DASH,
      when: payoutCadence ?? DASH,
      why: "paid as usual, not held",
    },
    {
      id: "export",
      step: "Data export",
      /*
        DELIBERATE, RULED DEPARTURE from the verbatim-copy rule — the second in
        this project, after the portfolio screen's dropped `Phase 2 · ` prefix.

        The design writes this row's two data cells as
        "receipts, verdicts, evidence packs" and "on request, ~10 min". Both
        are replaced here, on purpose.

        What the API actually has is `GET /providers/me/calls/export`, whose own
        summary is "CSV export of every call served, one row per call, for a
        time window". It is returned synchronously, in the response body, as
        `text/csv` — there is no job, no ~10 minutes, and no receipt, verdict or
        evidence-pack artefact anywhere in it. The three the frame names have no
        export endpoint at all.

        This is the checklist a provider reads while deciding whether leaving
        costs them their record. Printing the frame's scope would promise three
        artefacts on their way out that they will not receive, which is the
        precise failure this screen exists to prevent — the same reason
        "Pending earnings paid" renders `—` two rows above rather than a
        subtraction that looks like a number.

        Keep what is here; the frame's words do not come back. This is a
        decision, not a transcription slip. Do not "fix" it back to match the design.
      */
      state: "one CSV row per call served",
      when: "on request, immediate",
      why: "yours to keep",
    },
    {
      id: "stake",
      step: "Stake returned",
      state: staked ? `${formatMoney(staked, { decimals: 2 })} less any executed penalty` : DASH,
      when: "after unbonding",
      why: "on-chain, to your proved payout address",
    },
  ];

  const unstake = useMutation({
    mutationFn: (amount: string) => createUnstakeIntent({ amount }),
    onSuccess: (result) => {
      setActionError(null);
      setIntent(result);
    },
    onError: (error) => {
      setIntent(null);
      setActionError(error instanceof ApiError ? error : null);
    },
  });

  const withdraw = useMutation({
    mutationFn: (amount: string) => createStakeWithdrawIntent({ amount }),
    onSuccess: (result) => {
      setActionError(null);
      setIntent(result);
    },
    onError: (error) => {
      setIntent(null);
      setActionError(error instanceof ApiError ? error : null);
    },
  });

  const exportAll = useMutation({
    mutationFn: async () => {
      /*
        The export requires an explicit window and "everything" has to mean
        everything. It is NOT bounded below by `registeredAt`: the seeded org's
        registration row is younger than the calls it served, and a floor there
        silently cut the file from 148 rows to 2.5KB — measured.
      */
      const to = new Date(Date.now() + 86_400_000).toISOString();
      return exportProviderCalls({ from: "2020-01-01T00:00:00.000Z", to });
    },
    onSuccess: (file) => {
      setActionError(null);
      /*
        The export caps itself and says so in three response headers. They are
        readable here — the API now sets `Access-Control-Expose-Headers` for
        all three, contrary to `provider-reports.service.ts`'s docstring
        (checked on the wire) — so a capped file is announced rather than
        handed over as if it were the whole record. `meta: null` means the cap
        is UNKNOWN, never "not truncated".
      */
      setExportNote(
        file.meta === null
          ? "The export was downloaded, but we could not confirm it is complete. Treat it as possibly incomplete."
          : file.meta.truncated
            ? `The export was capped at ${file.meta.rowCount} of ${file.meta.totalMatching} rows. It is not your whole record.`
            : null,
      );
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename ?? "assay-calls.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => setActionError(error instanceof ApiError ? error : null),
  });

  const loadError = [stake.error, windows.error].find((e): e is ApiError => e instanceof ApiError);

  return (
    <>
      {/* Page Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Leaving</h1>
          <p className="font-mono text-mono-12 text-03">
            nothing here is a lock-up on your earnings — those are paid on the normal schedule
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            icon={<Download />}
            type="button"
            loading={exportAll.isPending}
            onClick={() => exportAll.mutate()}
          >
            Export everything
          </Button>
          <Button
            variant="secondary"
            icon={<ArrowUpFromLine />}
            type="button"
            loading={unstake.isPending}
            /* Disabled rather than enabled-and-inert when there is nothing to
               unstake: the intent needs an amount and there is none. */
            disabled={!staked || staked.amount === "0"}
            onClick={() => staked && unstake.mutate(staked.amount)}
          >
            Request unstake
          </Button>
          {/*
            NOT ON THE FRAME. Added because withdrawing stake
            must be possible from this screen, and `Request unstake` only starts
            the clock — `withdraw-intent` is the call that returns the money.
            Enabled only while something is unbonding, because that is the only
            state in which an amount exists to withdraw.
          */}
          <Button
            variant="secondary"
            icon={<ArrowUpFromLine />}
            type="button"
            loading={withdraw.isPending}
            disabled={!unbonding || unbonding.amount === "0"}
            onClick={() => unbonding && withdraw.mutate(unbonding.amount)}
          >
            Withdraw unbonded
          </Button>
        </div>
      </header>

      {loadError ? (
        <Banner
          tone="danger"
          title="The exit checklist could not be loaded in full"
          description={describeChainRefusal(loadError)}
        />
      ) : null}

      {/*
        The dead end, named. Without a proved stake authority there is no
        account to unstake from and every intent answers 409, so the checklist's
        last row can never complete. The banner's action opens the flow that
        clears it; the frame draws neither.
      */}
      {stake.isSuccess && !authorityProven ? (
        <Banner
          tone="warning"
          title="You cannot withdraw stake yet — no stake authority has been proved"
          description="Your stake account is identified by the wallet that signs a challenge, never by an address you type. Until one is proved, both buttons above are refused."
          action={
            <BannerAction onClick={() => setProving(true)}>Prove stake authority</BannerAction>
          }
        />
      ) : null}

      {actionError ? (
        <Banner
          tone="danger"
          title="That request was refused"
          description={describeChainRefusal(actionError)}
        />
      ) : null}

      {exportNote ? <Banner tone="warning" title="Your export may be incomplete" description={exportNote} /> : null}

      {intent ? (
        <IntentResult
          // Forces a remount — and so a reset of the signature/broadcasting
          // state below — when a NEW intent replaces this one (e.g. pressing
          // "Withdraw unbonded" right after signing an unstake). Without this,
          // a stale signature from the previous intent would still show under
          // the new one: `intent` prop changes, but React reuses the same
          // component instance and its `useState`.
          key={
            intent.transaction && isSolanaTransaction(intent.transaction)
              ? intent.transaction.transactionBase64
              : `${intent.kind}:${intent.blockedBy}`
          }
          intent={intent}
          stakeAuthorityAddress={stakeAuthority}
          signerState={signerState}
        />
      ) : null}

      {/* Panel. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What has to close first</PanelTitle>
            <PanelDescription>in this order, and why</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        {/* Body — padding [6, 10, 10, 10]. */}
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          <div className="min-w-0 overflow-x-auto">
            <Table columns={COLUMNS} rows={rows} caption="What has to close first" />
          </div>
        </PanelBody>
      </Panel>

      {/* Note — primary-10 on primary-20, gap 10, padding 15. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-[15px]">
        <ShieldCheck
          width={15}
          height={15}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-primary-600"
        />
        <p className="min-w-0 flex-1 text-body-13 text-primary-700">
          The unbonding period is not a lock-up on your earnings. It exists so a provider cannot
          serve bad data and withdraw before the window that measures it closes. Your earnings keep
          being paid as calls settle.
        </p>
      </div>

      <ProveAuthoritySheet
        open={proving}
        onOpenChange={setProving}
        stake={stake.data}
        payoutAccountId={seedAccountId(registration.data?.registration.payoutAccounts ?? [])}
        onProved={(stakeAuthority) => {
          setProving(false);
          /*
            Seeded from the mutation's own response rather than refetched. The
            API answers every provider GET with `private, max-age=10,
            stale-while-revalidate=3600`, so a refetch here can be served the
            pre-write body straight from the BROWSER's HTTP cache for up to an
            hour — invalidating the React Query key does not reach it.
            Seeded onto the per-chain entry: `stakeActionChain` reads nothing
            else, and a top-level `stakeAuthority` left the banner up.
          */
          queryClient.setQueryData<ProviderStake>(["provider", "stake"], (previous) =>
            withProvedStakeAuthority(previous, stakeAuthority),
          );
        }}
      />
    </>
  );
}

/**
 * Challenge → sign in your wallet → prove.
 *
 * Two calls, never one: nothing in the prove request names the account being
 * claimed. If it could, provider A could name provider B's pubkey and have a
 * later slash attestation point at B's collateral. The account comes off the
 * challenge row, where the platform put it.
 *
 * The message is displayed, never constructed here — the stored row is the
 * only copy the prove call verifies against.
 *
 * ## The signer is address-scoped, and that is the whole correctness of it
 *
 * `useSigner({ address })`, never a bare `useSigner()`. With no address
 * `pickWallet` (`hooks/useSigner.ts:184-192`) hands back the **embedded**
 * wallet, and this proof is verified server-side against the challenge row's
 * `accountId` — the address the provider typed, which for a stake authority is
 * typically an org or cold wallet. Signing with the embedded wallet therefore
 * fails 100% of the time, and it fails as "your signature is invalid" with
 * nothing on the screen pointing at wallet selection.
 *
 * ## The wallet is looked for BEFORE the challenge is minted
 *
 * A challenge is a row with a nonce and an expiry. Minting one for a browser
 * that cannot sign leaves litter behind and tells the provider nothing they
 * could not be told first. Transposed from `features/m41/use-setup.ts:338-428`,
 * the payout-address proof, which is the working precedent for all of this.
 *
 * ## The paste box stays
 *
 * A cold wallet that cannot connect to a browser is a real case, and pasting a
 * base58 signature produced elsewhere is the only route that provider has. It
 * moves behind a disclosure; it does not go away.
 */
const FIELDS_REQUIRED = "Enter the chain and the wallet address that will hold the stake account.";

function ProveAuthoritySheet({
  open,
  onOpenChange,
  stake,
  payoutAccountId,
  onProved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stake: ProviderStake | undefined;
  payoutAccountId: string | null;
  onProved: (stakeAuthority: string) => void;
}) {
  const suggestedChain = chainIdFrom(payoutAccountId, stakeActionChain(stake)?.staked?.asset);
  const [chainId, setChainId] = React.useState(suggestedChain);
  const [address, setAddress] = React.useState("");
  const [signature, setSignature] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [wallet, setWallet] = React.useState<SheetWalletState>("idle");
  const [walletDetail, setWalletDetail] = React.useState<string | null>(null);
  const [signing, setSigning] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);

  React.useEffect(() => {
    if (suggestedChain) setChainId((current) => current || suggestedChain);
  }, [suggestedChain]);

  /*
    Scoped to the typed address — see the docstring. `address` is trimmed here
    and nowhere else in the request path, because `pickWallet` matches base58
    exactly and deliberately does no normalising of its own.
  */
  const signerState = useSigner({
    /*
      The chain the provider is proving ON, from this sheet's own field — the
      same string the challenge is minted with. Empty means the field has not
      been filled, which is `chain-unknown` and not `no-wallet`: there is
      nothing to connect until a chain is named.
    */
    chainId: chainId.trim() === "" ? null : chainId.trim(),
    address: address.trim(),
  });

  const ready = chainId.trim() !== "" && address.trim() !== "";

  // The "enter the chain and the address" message is about empty fields only; drop it as soon as they are filled.
  React.useEffect(() => {
    if (ready) setError((current) => (current === FIELDS_REQUIRED ? null : current));
  }, [ready]);

  const challenge = useMutation({
    mutationFn: () => createStakeAuthorityChallenge({ chainId, address: address.trim() }),
    onSuccess: () => setError(null),
    onError: (e) => setError(e instanceof ApiError ? `${e.code} · ${e.message}` : "The challenge could not be issued"),
  });

  const prove = useMutation({
    mutationFn: () =>
      proveStakeAuthority({
        challengeId: challenge.data!.challengeId,
        signature: signature.trim(),
      }),
    onSuccess: (result) => {
      setError(null);
      setSignature("");
      challenge.reset();
      onProved(result.stakeAuthority);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? `${e.code} · ${e.message}` : "The signature was not accepted"),
  });

  /** Challenge → sign → prove, in one press, without a nonce reaching the screen. */
  async function signAndProve() {
    if (!ready) {
      setError(FIELDS_REQUIRED);
      return;
    }
    // Any earlier validation or press-time message is stale once the fields are valid.
    setError(null);

    /*
      The three signer states are checked BEFORE `createStakeAuthorityChallenge`
      — that ordering is the point, see the docstring.

      `hydrating` is "Privy has not finished building the wallet list", not
      "there is no wallet". Return quietly and let the provider press again,
      rather than nailing the sheet to a state that is false.
    */
    /*
      `chain-unknown` is NOT `no-wallet`. The chain has not been named yet
      (here: the sheet's own chain field, or a query that has not answered), so
      there is nothing for the provider to connect and no sentence about
      wallets that would be true. Return quietly; the button re-enables the
      moment a chain is known.
    */
    if (signerState.status === "chain-unknown") {
      setError(
        "That chain is not recognised yet, so no wallet can be matched to it. Check the chain id, or use the offline route below.",
      );
      return;
    }
    if (signerState.status === "hydrating") {
      setError(
        "Still reading the wallets connected in this browser. Press again in a moment, or use the offline route below.",
      );
      return;
    }
    if (signerState.status === "no-wallet") {
      setWallet("no-wallet");
      return;
    }
    /*
      Reachable here in a way it barely is elsewhere: a provider proving a stake
      authority usually HAS wallets connected, just not the org or cold wallet
      whose address they typed. "Connect a wallet" and "connect the wallet that
      holds 7xKX…, or fix the address" are opposite instructions, so this state
      gets its own.
    */
    if (signerState.status === "address-not-connected") {
      setWallet("address-not-connected");
      return;
    }
    const signer = signerState.signer;

    // Cleared here rather than at the top: above the three checks it would blank
    // a previous attempt's outcome for a press that then does nothing at all.
    setWalletDetail(null);
    setError(null);
    setSigning(true);
    setWallet("prompting");
    try {
      const issued = await createStakeAuthorityChallenge({
        chainId: chainId.trim(),
        address: address.trim(),
      });

      /*
        `issued.message` goes to the wallet EXACTLY as the platform wrote it.
        `provider-stake-authority.service.ts:339-346` rebuilds the challenge
        from the stored row and verifies against that, so a string rebuilt in
        the browser is the one string that is never checked.
      */
      const result = await proveStakeAuthority({
        challengeId: issued.challengeId,
        // Typed data on eip155 (hex back), the message on Solana (base58 back).
        signature: await signProofChallenge(signer, issued, "STAKE_AUTHORITY"),
      });
      setWallet("idle");
      setSignature("");
      challenge.reset();
      onProved(result.stakeAuthority);
    } catch (e) {
      if (e instanceof ApiError) {
        // The platform refused — a used or expired challenge, an account another
        // provider already claimed, a still-funded authority. Its own code and
        // sentence are the whole message; there is nothing to add.
        setWallet("idle");
        setError(`${e.code} · ${e.message}`);
      } else if (isUserRejection(e)) {
        // The prompt was closed or declined. Nothing was proved and nothing
        // was written.
        setWallet("declined");
      } else {
        /*
          The embedded wallet and an external one throw two different shapes, so
          "anything thrown means declined" folds a real failure into "you
          declined" — a sentence that is both wrong and impossible to act on.
        */
        setWallet("rejected");
        // Never blank: the outcome below renders only when there is a detail,
        // so a wallet that throws with an empty message would otherwise show
        // the provider nothing at all.
        const detail = (e instanceof Error ? e.message : String(e)).trim();
        setWalletDetail(detail || "The wallet returned an error with no message. Nothing was proved.");
      }
    } finally {
      setSigning(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>Prove stake authority</SheetTitle>
          <SheetDescription>
            This link decides whose collateral a slash points at, so it is proved by a wallet
            signature and never declared. The platform reads the account off the challenge it
            issued, not off anything you send it.
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          <Field
            label="Chain"
            id="stake-authority-chain"
            value={chainId}
            onChange={(event) => setChainId(event.target.value)}
            hint="The chain id, in CAIP-2 form. Suggested from your proved payout address."
          />
          <Field
            label="Wallet address"
            id="stake-authority-address"
            placeholder="wallet address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            hint="The wallet that will hold the stake account. Connect this exact wallet — the signature is verified against it, not against whichever wallet you are logged in with."
          />

          {/*
            Not disabled. A control that refuses silently teaches nothing; this
            one is pressable and answers with the reason underneath.
          */}
          <Button
            type="button"
            icon={<PenLine />}
            loading={signing}
            onClick={signAndProve}
          >
            Sign in your wallet and prove
          </Button>

          {wallet === "no-wallet" ? (
            <p className="text-body-13 text-warning-600">
              Nothing was signed — no wallet is connected in this browser, so no challenge was
              issued.
              <ConnectWalletAction />
            </p>
          ) : null}
          {wallet === "address-not-connected" ? (
            <p className="text-body-13 text-warning-600">
              Nothing was signed — no connected wallet holds{" "}
              <span className="break-all font-mono text-mono-13">{address.trim()}</span>. Connect
              the wallet that holds it, or correct the address above. No challenge was issued.
              <ConnectWalletAction />
            </p>
          ) : null}
          {wallet === "declined" ? (
            <p className="text-body-13 text-warning-600">
              Nothing was signed — the wallet prompt was closed or declined, so no authority was
              claimed.
            </p>
          ) : null}
          {wallet === "rejected" && walletDetail ? (
            <p className="text-body-13 text-danger-600">{walletDetail}</p>
          ) : null}

          {/*
            The fallback, behind a disclosure rather than deleted. An org's cold
            wallet may never touch a browser at all; pasting a signature produced
            somewhere else is the only route that provider has, and the two-call
            shape above is exactly what makes it safe to offer — the account
            still comes off the challenge row.
          */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPasteOpen((current) => !current)}
          >
            {pasteOpen ? "Hide the offline route" : "My wallet cannot connect to this browser"}
          </Button>

          {pasteOpen ? (
            <>
              <p className="text-body-13 text-02">
                Issue a challenge here, sign it wherever the key lives, and paste the signature
                back. The challenge expires, so do not issue it until you are ready to sign.
              </p>
              <Button
                type="button"
                variant="secondary"
                loading={challenge.isPending}
                disabled={!ready}
                onClick={() => challenge.mutate()}
              >
                Get a challenge to sign
              </Button>

              {challenge.data ? (
                <>
                  <CodeBlock title="sign this message in your wallet" code={challenge.data.message} />
                  <p className="text-body-13 text-02">
                    Claiming {challenge.data.accountId}. This challenge expires{" "}
                    {new Date(challenge.data.expiresAt).toISOString()}.
                  </p>
                  <Field
                    label="Signature"
                    id="stake-authority-signature"
                    placeholder="signature from your wallet"
                    value={signature}
                    onChange={(event) => setSignature(event.target.value)}
                    hint="Paste exactly what your wallet returned."
                  />
                  <Button
                    type="button"
                    loading={prove.isPending}
                    disabled={!signature.trim()}
                    onClick={() => prove.mutate()}
                  >
                    Prove it
                  </Button>
                </>
              ) : null}
            </>
          ) : null}

          {error ? <p className="text-body-13 text-danger-600">{error}</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The product's only route from "wallet installed" to "wallet connected".
 *
 * `useWallets()` returns *connected* wallets, so neither `no-wallet` nor
 * `address-not-connected` can be escaped from inside the signing surface —
 * `useSigner()` selects a wallet and deliberately never connects one. A twin of
 * this lives in `features/m41/steps.tsx`; it is duplicated rather than shared
 * because importing that module would pull the whole provider-setup feature
 * into this route's bundle for twelve lines.
 *
 * `walletChainType` is passed explicitly even though `appearance.walletChainType`
 * now sets the same value: a connect modal that silently follows a
 * global default is one config edit away from offering a namespace this screen
 * cannot use, and the failure is a user who connects a wallet and is then told
 * it is not connected.
 *
 * `"ethereum-and-solana"` and not `"solana-only"`, because a provider's stake
 * and payout addresses are per chain and this button is how they connect
 * either one. The literal is the package's: `"solana-and-ethereum"` is not one of the three values Privy accepts.
 */
function ConnectWalletAction() {
  const { connectWallet } = useConnectWallet();

  return (
    <span className="mt-2.5 block">
      <Button
        variant="secondary"
        size="sm"
        icon={<Wallet />}
        // Called through an arrow: `connectWallet` also accepts a MouseEvent in
        // this position, and handing it the event silently drops the filter.
        onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
      >
        Connect a wallet
      </Button>
    </span>
  );
}
