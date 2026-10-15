"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { CircleCheck, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DepositChainChoice } from "@/components/funding/deposit-chain-choice";
import { Select } from "@/components/ui/select";
import { assertRequirementsChain, depositChoice } from "@/features/funding/deposit-chain";
import {
  depositUnavailableOn,
  depositableChains,
  offeredChains,
} from "@/features/funding/depositable-chains";
import { depositNetworkFee } from "@/features/funding/deposit-network-fee";
import { depositSentNotice } from "@/features/funding/deposit-sent";
import { signEvmDeposit } from "@/features/funding/evm-deposit";
import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { KeyValueRow, NoteBox } from "@/features/g30/ui";
import { useChains } from "@/hooks/useChains";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { Chain } from "@/interfaces/chain";
import { ApiError } from "@/libs/ApiClient";
import { evmRpcUrl } from "@/libs/chains/evm/chains";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { shortAddress } from "@/libs/chains/format";
import { isRailNotOffered, railNotOfferedText } from "@/libs/chains/paid-rails";
import { isEvmChain } from "@/libs/chains/registry";
import { toBase64 } from "@/libs/chains/solana/base64";
import { buildDepositTransaction } from "@/libs/chains/solana/deposit-transaction";
import { getBalances } from "@/services";
import { chainDisplayName, findChain, settlementSymbol } from "@/services/chains.service";
import { getEscrow } from "@/services/escrow.service";
import {
  createDeposit,
  isEvmDepositRequirements,
  settleDeposit,
  settleDepositByBroadcast,
  type SettledDeposit,
} from "@/services/funding.service";
import { chainIdOfAccount } from "@/utils/chain";
import { exceedsScale, formatDecimal, toAtomic, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";

/**
 * Deposit.
 *
 * The minimum is a real rule, not decoration: below $5.00 the form refuses, and
 * the refusal names the number. Everything on the summary is arithmetic the
 * person can check — you pay X, the network fee is sponsored, X is credited.
 *
 * ## The round trip
 *
 * The submit is the whole deposit flow and it runs in one uninterrupted pass:
 *
 *   press → `POST /deposits` → build the transfer → wallet prompt → settle.
 *
 * The browser owns the middle because the backend holds no buyer key. It builds
 * the legacy 4-instruction transfer (`@/libs/chains/solana/deposit-transaction`) from
 * the requirements the create step answered with — including the blockhash, so
 * that what the facilitator verifies is what the user signed.
 *
 * ## The chain is the first question, before the amount
 *
 * A deposit is irreversible and unbridgeable, so a chain the buyer never read is a chain their money may
 * never leave. With exactly one enabled chain the step is a **stated fact** —
 * one radio, checked and disabled — because asking someone to choose between
 * one option is not a choice. With two or more, nothing is pre-selected and
 * the amount field stays disabled until one is picked.
 *
 * The value travels on the request either way. The BACKEND may infer the
 * chain while the buyer has one linked account (`resolveDepositChain` over
 * `sessionAccounts()`), so the field is optional on the wire; this screen
 * always sends it.
 *
 * ## Why `createDeposit` is called from the click and nowhere else
 *
 * A deposit intent lives **120 seconds** from the moment the API answers, and
 * the blockhash inside it expires sooner than that. Past the window `settle`
 * refuses with `402 PAYMENT_DEPOSIT_EXPIRED`.
 *
 * So the intent is minted *immediately before the wallet prompt* — never on
 * mount, never on an amount change, never from a `useEffect`. Creating it any
 * earlier means the clock runs while the buyer reads the screen, and the
 * failure then arrives as a `402` that reads like a chain problem when the real
 * cause is that they read slowly. Nothing slow goes between the four steps for
 * the same reason. There is deliberately no countdown drawn: the window is not
 * the buyer's problem to manage, it is ours not to waste.
 */

const MINIMUM = new Decimal("5");

/**
 * USDC's scale, needed **before** the create call rather than read off its
 * answer: `POST /deposits` takes atomic units, so the amount has to be scaled
 * on this side of the request. `created.requirements.decimals` is what the
 * transfer is actually built with — it is the mint's own figure, and
 * `TransferChecked` fails on chain if it disagrees with the mint.
 */
const DEPOSIT_DECIMALS = 6;

/**
 * One line, delegating, on purpose.
 *
 * This was a hand-copied reimplementation of `formatMoney`'s body — the third
 * of three copies of the same rounding convention in this codebase, agreeing
 * only because somebody pasted carefully. `/spend` had already broken step the
 * same way (`toFixed(4, ROUND_DOWN)` in one helper, bare `toFixed(4)` — which
 * is ROUND_HALF_UP — in another, on the same screen). A displayed figure that
 * disagrees with another displayed figure by half a cent is a reconciliation
 * ticket later, so there is now exactly one implementation and
 * `utils/money.ts` states the convention: truncate, never round.
 */
function money(value: Decimal, decimals = 2): string {
  return formatDecimal(value, { decimals });
}

/** Where the submit currently is. `signing` is the only one the buyer can act on. */
type Phase = "idle" | "creating" | "approving" | "signing" | "settling" | "done";

type Outcome =
  /** The prompt was closed or declined. Nothing was signed and no money moved. */
  | { readonly kind: "declined" }
  /** A real failure — the API, the chain, or the wallet. Always carries words. */
  | { readonly kind: "failed"; readonly message: string; readonly code?: string }
  /**
   * The signed transaction was accepted for submission.
   *
   * `chainId` is carried on the outcome rather than read off the picker when
   * the receipt renders. The picker is live again once the deposit is done, so
   * a buyer who changes it would otherwise be handed an explorer link for a
   * chain their transaction is not on — the same class of defect as a card
   * showing another chain's balance, wearing a receipt.
   */
  | { readonly kind: "settled"; readonly settled: SettledDeposit; readonly chainId: string }
  /** Something about the wallet stops the attempt before it starts. */
  | { readonly kind: "blocked"; readonly message: string };

/**
 * The settlement reference on the receipt — linked when the chain is known,
 * plain and copyable when it is not.
 *
 * `findChain` answers `null` when the chain list failed while a deposit
 * succeeded, and there is no `chains[0]` fallback here for the same reason
 * there is none anywhere else in the multi-chain screens: **a receipt that links to the
 * wrong chain's explorer is worse than one that does not link.** The reference
 * itself is the thing the buyer needs, so it is always rendered in full and
 * always copyable.
 */
function TxReference({ chain, reference }: { chain: Chain | null; reference: string }) {
  const [copied, setCopied] = React.useState(false);

  if (chain !== null) {
    return (
      <a
        className="break-all font-mono underline"
        href={explorerTxUrl(chain, reference)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {reference}
      </a>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className="break-all font-mono">{reference}</span>
      <button
        type="button"
        className="text-body-xs underline"
        onClick={() => {
          void navigator.clipboard
            .writeText(reference)
            .then(() => setCopied(true))
            /* An unavailable clipboard is not a failed deposit. Say nothing. */
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function DepositPageContent() {
  // Blocked by Assay: the main write action is disabled (the API refuses it anyway).
  const readOnly = useAccountReadOnly();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [amount, setAmount] = React.useState("25.00");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  /*
    No address argument — this is "sign as me". The deposit is paid out of the
    wallet the platform already knows as this agent's account, and there is no
    typed-in address for the backend to verify a signature against (that is the
    provider payout proof, which is the case `useSigner({ address })` exists
    for). Consequently `address-not-connected` cannot occur here; it is still
    handled below because the union is total and a state that "cannot happen"
    is not a state you may leave uncompiled.
  */
  /*
    The chain, from the API's enabled set and never from a constant in this
    bundle. `chains` is EMPTY while loading and on error, which is why
    `depositChoice` answers `none-offered` rather than "Solana" — a screen that
    filled the gap with a default would offer a chain the deployment may have
    off, and the refusal would arrive at the moment money moves.
  */
  const { chains, status: chainsStatus } = useChains();
  /*
    Which chains this buyer may be OFFERED — the enabled set narrowed to the
    account they hold.

    `GET /escrow` with no chain argument: the controller takes the account from
    the session and never from the request, so `escrow.account` is the
    authoritative CAIP-10 for "which chain is this buyer on". Measured before
    this narrowing existed: a buyer whose only account is `eip155:46630` was
    offered `Solana devnet`, selected it, and reached a fully-priced summary
    with a live `Deposit $25.00` button. `POST /deposits` answers that
    combination `409 PAYMENT_DEPOSIT_ACCOUNT_NOT_LINKED`, so nothing was ever
    at risk — but the refusal arrived after the buyer had priced a choice that
    never existed.
  */
  const accountQuery = useQuery({
    queryKey: ["escrow", null],
    queryFn: () => getEscrow(null),
    retry: 0,
    networkMode: "always" as const,
  });
  const depositable = depositableChains(chains, {
    status: accountQuery.isPending ? "loading" : accountQuery.isError ? "error" : "ready",
    chainId: chainIdOfAccount(accountQuery.data?.account),
  });
  const choice = depositChoice(offeredChains(depositable));
  const [pickedChainId, setPickedChainId] = React.useState<string | null>(null);
  /*
    One chain: the chain, stated. Two or more: whatever was picked, and `null`
    until something is. There is deliberately no `?? chains[0]` — that is the
    silent default the rule above exists to remove, and it is the exact shape
    (`balances[0]`) that was deleted from four other screens.
  */
  const chainId = choice.kind === "fixed" ? choice.chain.chainId : pickedChainId;
  const signerState = useSigner({ chainId });
  const walletAddress = signerState.status === "ready" ? signerState.signer.address : null;

  const balancesQuery = useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });
  const balances = chainBalances(balancesQuery.data?.balances);
  /*
    The row for the chain being deposited to, selected BY CHAIN ID and `null`
    until one is chosen — so the "balance after this deposit" hint is either
    this chain's arithmetic or absent, never another chain's figure.

    Was `primaryBalance(...)`, i.e. `balances[0]`: that line would have added a
    Solana deposit to an eip155 balance and printed the result.
  */
  const balance = chainId ? (balances.find((row) => row.chainId === chainId) ?? null) : null;

  const parsed = React.useMemo(() => {
    if (!/^\d*\.?\d*$/.test(amount.trim()) || amount.trim() === "") return null;
    try {
      return new Decimal(amount);
    } catch {
      return null;
    }
  }, [amount]);

  const error =
    parsed === null
      ? "Enter an amount."
      : parsed.lt(MINIMUM)
        ? "Minimum $5.00."
        : exceedsScale(parsed, DEPOSIT_DECIMALS)
          ? // Refused rather than rounded. USDC has no unit smaller than
            // 0.000001, so a seventh decimal place is an amount that cannot be
            // sent — and quietly sending a different number than the one on
            // screen is the failure this whole file is arranged against.
            //
            // This arm is the *wording*, not the guarantee: `toAtomic` refuses
            // the same amount itself, so removing this check degrades the copy
            // to a thrown error rather than turning truncation back on.
            `${settlementSymbol(chains, chainId ?? "") ?? "This chain's settlement token"} goes to ${DEPOSIT_DECIMALS} decimal places. Trim the amount.`
          : undefined;

  // No balance, no sentence about the balance. "$0.00" on a funded account is
  // an invented figure, and this screen is one click from moving money.
  const available = balance ? toDecimal(balance.available) : null;
  const after = available && parsed && !error ? available.plus(parsed) : available;

  const busy =
    phase === "creating" || phase === "approving" || phase === "signing" || phase === "settling";

  /**
   * Shown verbatim; the summary must name the exact amount, not a rounded one.
   *
   * `—` while no chain is chosen, **including when the amount box holds a
   * perfectly valid default**. Measured live with the chain list unreadable:
   * the screen printed "You pay $25.00", "Credited to balance $25.00" and
   * "Deposit $25.00" over a form with no amount field and no chain — a figure
   * with nothing behind it, on the screen where a figure means money is about
   * to move.
   */
  const exact =
    chainId !== null && parsed && !error ? money(parsed, Math.max(2, parsed.decimalPlaces())) : "—";

  /*
    Per chain, and it says something on BOTH. The `—` with no explanation that
    an `eip155` buyer used to read is the defect this replaces.
  */
  const networkFee = depositNetworkFee(
    chainId,
    chainId === null ? null : chainDisplayName(chains, chainId),
  );

  /*
    The refusal this screen already carried, moved from the CLICK to the read.

    `submitDeposit` has always blocked `eip155` — this page composes a Solana
    transfer and running it against an EVM chain would sign a valid signature
    over the wrong thing. It fired after the amount, the summary and a live
    `Deposit $25.00` button. Saying it while the buyer is still reading costs
    them nothing; saying it after they press costs them the whole screen.

    `POST /deposits` on `eip155:46630` no longer refuses: it answers `201` with
    an `eip155` `requirements` describing an `approve` + `depositFor` contract
    call. The guard is now entirely about what this screen can BUILD — see
    `depositUnavailableOn` for the whole story.
  */
  const unavailable = depositUnavailableOn(
    chainId,
    chainId === null ? null : chainDisplayName(chains, chainId),
    {
      kind: signerState.status === "ready" ? signerState.signer.kind : null,
      rpcConfigured: chainId !== null && isEvmChain(chainId) && evmRpcUrl(chainId) !== null,
    },
  );

  async function submitDeposit() {
    if (error || parsed === null || busy) return;

    /*
      The wallet is resolved BEFORE the intent is minted — the same order the
      payout-address proof uses (`features/m41/use-setup.ts` `signAndProve`).
      A deposit intent is a row with a 120-second clock; minting one for a
      browser that cannot sign burns the window and leaves litter behind, and
      tells the buyer nothing they could not be told first.
    */
    if (signerState.status === "chain-unknown" || chainId === null) {
      /*
        The real "you have not chosen a chain yet" branch. It must never say
        "no wallet" — a buyer told that has no button that fixes it, and the
        button they do need is three inches up the page.
      */
      setOutcome({
        kind: "blocked",
        message:
          choice.kind === "none-offered"
            ? "We could not read which chains we accept deposits on, so there is nowhere to deposit to yet."
            : "Choose the chain you are depositing on first.",
      });
      return;
    }
    if (signerState.status === "hydrating") {
      // NOT "you have no wallet" — Privy has not finished building the wallet
      // list. Saying the wrong thing here puts the buyer in a state no button
      // of theirs can fix, so say the true thing and let them press again.
      setOutcome({
        kind: "blocked",
        message: "Still connecting to your wallet. Press Deposit again in a moment.",
      });
      return;
    }
    if (signerState.status === "no-wallet") {
      setOutcome({
        kind: "blocked",
        message: "No wallet is connected, so there is nothing to pay from. Connect one and retry.",
      });
      return;
    }
    if (signerState.status === "address-not-connected") {
      // Unreachable — see the `useSigner()` call above. Handled anyway so the
      // union stays total; if a future change starts requesting an address,
      // this becomes the branch that has to say something useful.
      setOutcome({
        kind: "blocked",
        message: `Connect the wallet holding ${shortAddress(chainId, signerState.requested)} and retry.`,
      });
      return;
    }
    const signer = signerState.signer;
    /*
      The same refusal the screen already shows (no RPC for an eip155 chain in
      this build), re-checked at the click because the
      button is the last gate before a 120-second intent is minted.
    */
    if (unavailable !== null) {
      setOutcome({ kind: "blocked", message: unavailable });
      return;
    }

    // Retired only once the attempt is actually going ahead, so a press made
    // during hydration never wipes the result of the one before it.
    setOutcome(null);

    const atomicAmount = toAtomic(parsed, DEPOSIT_DECIMALS);

    try {
      setPhase("creating");
      // ── the 120-second window opens here ────────────────────────────────
      const created = await createDeposit(atomicAmount, chainId);
      /*
        The intent must be for the chain the buyer read. The backend may
        infer, and the deployment this build runs against ignores the field
        entirely — so this is checked here, before a wallet is asked to sign.
      */
      assertRequirementsChain(chainId, created.requirements.chainId);

      let settled: SettledDeposit;
      if (isEvmDepositRequirements(created.requirements)) {
        /*
          eip155: `approve` (only when the allowance is short) is signed and
          broadcast from this browser; `depositFor` is signed and handed to the
          settle route UNSENT, where `EvmFacilitator` verifies and broadcasts it.
          Every "you cannot" is raised inside before the wallet is asked.
        */
        setPhase("signing");
        const submission = await signEvmDeposit({
          signer,
          requirements: created.requirements,
          amountAtomic: BigInt(atomicAmount),
          onApproving: () => setPhase("approving"),
        });
        setPhase("settling");
        if (submission.kind === "signed") {
          settled = await settleDeposit(created.depositId, chainId, submission.rawTransaction);
        } else {
          /*
            An injected wallet SENT it — the money is already on chain. Two
            wallet prompts can outlast the intent's window, and an expired
            intent must not strand a transfer that landed: the hash is claimed
            against a fresh intent instead. The backend reads the chain either
            way, and one hash credits once.
          */
          try {
            settled = await settleDepositByBroadcast(
              created.depositId,
              submission.transactionHash,
            );
          } catch (caught) {
            if (!(caught instanceof ApiError) || caught.code !== "PAYMENT_DEPOSIT_EXPIRED") {
              throw caught;
            }
            const fresh = await createDeposit(atomicAmount, chainId);
            settled = await settleDepositByBroadcast(fresh.depositId, submission.transactionHash);
          }
        }
      } else {
        const solanaRequirements = created.requirements;
        const { transactionBytes } = await buildDepositTransaction({
          owner: signer.address,
          escrowAta: solanaRequirements.payTo,
          mint: solanaRequirements.asset,
          decimals: solanaRequirements.decimals,
          // `bigint` on this side, decimal string on the wire — JSON cannot
          // round-trip a bigint, so the conversion is this screen's job at both
          // ends rather than the service's.
          amountAtomic: BigInt(atomicAmount),
          feePayer: solanaRequirements.feePayer,
          memo: solanaRequirements.memo,
          blockhash: solanaRequirements.blockhash,
          lastValidBlockHeight: BigInt(solanaRequirements.lastValidBlockHeight),
        });

        setPhase("signing");
        /*
          The payload names its own chain and the signer is bound to one, so a
          mismatch is refused before the wallet is touched. That replaces the old
          required `chainId` argument, and it is stronger: omitting the chain used
          to make Privy default to `solana:mainnet`, and an external wallet then
          simulated this devnet deposit against mainnet and warned the buyer their
          transaction would fail — at the exact moment they were paying.
        */
        const signed = await signer.signTransaction({
          namespace: "solana",
          chainId,
          kind: "transaction",
          transactionBase64: toBase64(transactionBytes),
          feePayer: solanaRequirements.feePayer,
          signers: [signer.address],
          blockhash: solanaRequirements.blockhash,
          lastValidBlockHeight: solanaRequirements.lastValidBlockHeight,
        });
        /*
          The one transaction in this app the BROWSER builds, so it is also the
          one place the signing envelope is composed here rather than received. Every
          field is the server's own (`created.requirements`) except `signers`,
          which is the wallet that is about to sign — the deposit has no fee-payer
          separation on this side.
        */
        if (signed.namespace !== "solana") {
          // Total by construction: the signer is bound to a solana chain above.
          throw new Error(`Expected a Solana signature, got ${signed.namespace}.`);
        }

        setPhase("settling");
        settled = await settleDeposit(created.depositId, chainId, signed.transactionBase64);
      }
      // ── window closed; nothing after this is on the clock ───────────────

      setPhase("done");
      setOutcome({ kind: "settled", settled, chainId });

      // The balance and the deposits table both just went stale. `["deposits"]`
      // is /funding's own key — see `app/(main)/funding/page.tsx`.
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });

      /*
        Straight back to /funding, where the deposit is now a row and its
        pending amount is on the balance card. The result box's three facts —
        sent, which transaction, and the first-deposit limits step — travel in
        the notice, with the limits step as its action.
      */
      const notice = depositSentNotice({
        amount: formatDecimal(parsed),
        chainId,
        reference: settled.chainTxRef,
      });
      toast.success(notice.message, {
        description: notice.description,
        action: { label: "Set limits", onClick: () => router.push(notice.limitsHref) },
        duration: 12_000,
      });
      router.push("/funding");
    } catch (caught) {
      setPhase("idle");

      if (caught instanceof ApiError) {
        setOutcome({
          kind: "failed",
          // 409 CHAIN_RAIL_NOT_OFFERED: the chain serves free calls only. Plain words, not its id.
          message: isRailNotOffered(caught)
            ? railNotOfferedText(chainId === null ? null : chainDisplayName(chains, chainId))
            : caught.message,
          code: caught.code,
        });
        return;
      }
      if (isUserRejection(caught)) {
        // Cancelling in the wallet is a decision, not a fault. No red banner,
        // no error code — the intent simply expires unused.
        setOutcome({ kind: "declined" });
        return;
      }
      /*
        The embedded wallet and an external one throw two different error
        shapes, so "anything thrown means declined" would fold a real RPC or
        build failure into "you declined" — a sentence that is both wrong and
        impossible to act on. Everything that is not a rejection lands here
        with its own words, and never with none: a wallet that throws an empty
        message would otherwise render a blank banner, which is the same silent
        dead end.
      */
      const detail = (caught instanceof Error ? caught.message : String(caught)).trim();
      setOutcome({
        kind: "failed",
        message: detail || "The wallet returned an error with no message. Nothing was sent.",
      });
    }
  }

  const buttonLabel = busy
    ? phase === "creating"
      ? "Preparing…"
      : phase === "approving"
        ? "Approving the token in your wallet…"
        : phase === "signing"
          ? "Waiting for your wallet…"
          : "Settling…"
    : /*
         `exact`, not `parsed`, decides whether the button names a figure — it
         already carries the "no chain chosen" case. Measured live: with two
         chains and nothing picked the button read `Deposit —`.
       */
      exact !== "—"
      ? `Deposit ${exact}`
      : "Deposit";

  return (
    <div className="flex w-full justify-center bg-02 px-4 py-6 tablet:py-[34px]">
      <form
        className="flex w-full max-w-[660px] flex-col gap-5 rounded-xl border border-01 bg-01 p-6 shadow-soft tablet:p-[30px]"
        onSubmit={(e) => {
          e.preventDefault();
          // `void`, not `await`: a form submit handler cannot be async without
          // the event being pooled out from under `preventDefault`, and every
          // outcome of the flow is already reported through `outcome`.
          void submitDeposit();
        }}
      >
        <div className="flex w-full flex-col gap-1.5">
          <h1 className="text-heading-sm text-01">Add funds</h1>
          <p className="text-body-sm text-02">
            Minimum $5.00. The finality disclosure below is shown once and acknowledged before the
            first deposit.
          </p>
        </div>

        {/*
          THE FIRST QUESTION, above the amount.

          Three renderings, and the difference between them is the whole rule:

            - `none-offered` blocks. No amount field, no button. The chain list
              is empty while loading and on error, and both of those are states
              in which this screen does not know where the money would go.
            - `fixed` states it. One radio, checked and DISABLED — a fact, not
              a question — and the value still travels on the request.
            - `choose` offers it with NOTHING checked, and the amount stays
              disabled until one is picked.

          `data-testid` on the group so a DOM proof can count the radios and
          read `checked` off them without depending on the label copy.
        */}
        {choice.kind === "none-offered" ? (
          <NoteBox tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
            {/*
              Four states now, not two. The narrowing added two of them, and
              collapsing either into "we could not read the chain list" would
              send a buyer to reload a page that is working.
            */}
            {depositable.kind === "not-offered"
              ? `This account is on ${depositable.accountChainId}, which we do not take deposits on. Nothing else is offered instead — a deposit on a chain you hold no account on is refused, and it would be refused after you had priced it.`
              : depositable.kind === "reading-account"
                ? "Reading which chain this account is on…"
                : chainsStatus === "loading"
                  ? "Reading which chains we accept deposits on…"
                  : "We could not read which chains we accept deposits on. Reload, or try again in a moment."}
          </NoteBox>
        ) : (
          <DepositChainChoice
            choice={choice}
            picked={pickedChainId}
            onPick={setPickedChainId}
            busy={busy}
          />
        )}

        {unavailable ? (
          <NoteBox tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
            <span data-testid="deposit-unavailable">{unavailable}</span>
          </NoteBox>
        ) : null}

        {choice.kind === "none-offered" ? null : (
          <Field
            id="deposit-amount"
            label="Amount"
            inputMode="decimal"
            suffix="USD"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={chainId === null ? undefined : error}
            disabled={busy || chainId === null}
            hint={
              /*
                Four states, because "Reading your balance…" was a permanent
                sentence for anybody whose ledger has no row on this chain.
                Measured in Chrome under the Robinhood-testnet buyer, whose
                `GET /balances` is `{"balances":[]}`: the request had long
                since succeeded and the field still said it was reading. A
                spinner that never resolves is the same defect as a loading
                state that reads like a fact — it describes work that is not
                happening.
              */
              chainId === null
                ? "Choose a chain first — a deposit cannot be moved between chains."
                : after
                  ? `Balance after this deposit: ${money(after)}`
                  : balancesQuery.error
                    ? "We could not read your balance, so we cannot show what it becomes."
                    : balancesQuery.isPending
                      ? "Reading your balance…"
                      : "This platform's ledger holds no balance on this chain yet, so there is nothing to add to."
            }
          />
        )}

        {/*
          One option, because one is all this screen can pay from.

          The transfer is built out of the connected wallet's own token account
          and signed by it — there is no deposit-address flow behind the other
          option this used to carry, and a bare memo-less transfer to an address
          could never be reconciled back to an intent anyway.

          The only option is also the default, so the select always has a
          matching value, whatever `?method=` says. The label
          is the wallet Privy actually handed us — the literal `7xKX…9pQr` that
          stood here before was an address nobody in this codebase holds.
        */}
        <Select
          label="Pay from"
          defaultValue="wallet"
          disabled={walletAddress === null || busy}
          hint={
            chainId === null
              ? "The wallet you pay from depends on the chain."
              : `The chain's registered ${settlementSymbol(chains, chainId) ?? "settlement token"}, on ${chainDisplayName(chains, chainId)}. No other asset.`
          }
        >
          <option value="wallet">
            {walletAddress && chainId
              ? `${shortAddress(chainId, walletAddress)} · connected wallet`
              : signerState.status === "chain-unknown"
                ? "Choose a chain first"
                : signerState.status === "hydrating"
                  ? "Connecting your wallet…"
                  : "No wallet connected"}
          </option>
        </Select>

        <div className="flex w-full flex-col rounded-lg border border-01 bg-02 px-4 pb-3.5 pt-1">
          {/*
            The chain, restated in WORDS on the confirmation — the
            display name `GET /chains` served, never the CAIP-2 id and never a
            string this bundle assembled. `chainDisplayName` falls back to the
            id's label rather than to a namespace, because "solana" alone
            collapses devnet and mainnet into one word on the screen where that
            difference is whether the money is real.
          */}
          <KeyValueRow
            label="Chain"
            sub="this money can only be spent on this chain"
            value={chainId === null ? "—" : chainDisplayName(chains, chainId)}
          />
          <KeyValueRow label="You pay" value={exact} />
          {/*
            Both arms say something, and they say DIFFERENT things — see
            `features/funding/deposit-network-fee.ts`.

            This row was two ternaries on `!isEvmChain(chainId)`: Solana got
            "$0.00 · paid by us — the facilitator sponsors the transaction",
            and `eip155:46630` got a bare `—` with no sentence at all, read in
            Chrome under a Robinhood-testnet buyer. Exactly backwards — the
            chain where the fee is solved explained itself, and the chain where
            the buyer has to find native gas said nothing. The EVM sentence
            deliberately does NOT offer the platform's gas grant: that grant
            requires a matured withdrawal (`NO_MATURED_WITHDRAWAL` is one of
            its eight refusals), so promising it on a deposit would be a
            promise refused by construction.
          */}
          <KeyValueRow
            label="Network fee"
            sub={networkFee.note ?? undefined}
            value={networkFee.value}
          />
          <KeyValueRow label="Credited to balance" value={exact} total />
        </div>

        {/*
          Stated as soon as it is certain, which is after hydration — never
          during it. The submit says the same thing if pressed, but a buyer who
          has no wallet should not have to press a money button to find out.
        */}
        {signerState.status === "no-wallet" ? (
          <NoteBox tone="warning" icon={<Wallet className="h-full w-full" />}>
            No wallet is connected, so there is nothing to pay from yet.
          </NoteBox>
        ) : null}

        {outcome?.kind === "settled" ? (
          <NoteBox tone="teal" icon={<CircleCheck className="h-full w-full" />}>
            Sent — the deposit is <strong>{outcome.settled.status}</strong>. Your balance updates
            once the transfer is observed on chain.
            {outcome.settled.chainTxRef ? (
              <>
                {" "}
                Transaction{" "}
                {/*
                  The reference, in full. The buyer just moved real money;
                  "it worked, trust us" is not an acceptable receipt.

                  The explorer comes from the chain the deposit was settled on
                  — `outcome.chainId`, not the picker, which is live again by
                  now — and the URL is built by `explorerTxUrl` from the base
                  `GET /chains` served. It was a `https://explorer.solana.com/
                  tx/…?cluster=devnet` template literal, which on any other
                  chain is a receipt pointing at a transaction that is not
                  there.
                */}
                <TxReference
                  chain={findChain(chains, outcome.chainId)}
                  reference={outcome.settled.chainTxRef}
                />
              </>
            ) : null}
            {/*
              THE ONBOARDING SEAM. The first deposit is what opens the escrow,
              and `open_escrow` cannot arm it: the program refuses a non-zero
              limit from anyone but the buyer, so an escrow this platform opened
              refuses every paid call until a `set_escrow_limits` signed by the
              buyer's own wallet lifts it.

              Written unconditionally rather than behind a `GET /escrow` read.
              This screen holds no escrow state and would need a round trip to
              tell a first deposit from a fifth — and the sentence is phrased so
              it costs a returning buyer nothing to read. Pointing everyone at
              the step is cheaper than letting a first-time buyer discover it
              from calls that silently fail.
            */}
            {" "}
            <>
              If this was your first deposit it also opened your escrow, and an escrow we open
              starts out refusing every paid call — the program does not let us choose your
              spending limits.{" "}
              <Link href="/funding/escrow/limits" className="font-semibold underline">
                Set your limits
              </Link>{" "}
              to start paying for calls.
            </>
          </NoteBox>
        ) : null}

        {outcome?.kind === "declined" ? (
          <NoteBox tone="neutral" icon={<Wallet className="h-full w-full" />}>
            You closed the wallet prompt, so nothing was signed and no money moved.
          </NoteBox>
        ) : null}

        {outcome?.kind === "blocked" ? (
          <NoteBox tone="neutral" icon={<Wallet className="h-full w-full" />}>
            {outcome.message}
          </NoteBox>
        ) : null}

        {outcome?.kind === "failed" ? (
          <NoteBox tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
            {outcome.message}
            {outcome.code ? <> ({outcome.code})</> : null}
          </NoteBox>
        ) : null}

        <NoteBox tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
          {chainId === null
            ? "Payments settle on-chain and are final — there is no card, no fiat on-ramp and no chargeback. You can withdraw unspent balance at any time, on the chain it is held on."
            : `${settlementSymbol(chains, chainId) ?? "The chain's settlement token"} on ${chainDisplayName(chains, chainId)}. Payments settle on-chain and are final — there is no card, no fiat on-ramp and no chargeback. You can withdraw unspent balance at any time, on the chain it is held on.`}
        </NoteBox>

        <div className="flex w-full justify-end gap-2.5">
          <Button variant="secondary" asChild>
            <Link href="/funding">Cancel</Link>
          </Button>
          {/*
            Not disabled while Privy hydrates. A hook that never flips `ready`
            would leave a permanently dead money button with nothing explaining
            it; pressing during hydration says so in words instead.
          */}
          <Button
            type="submit"
            disabled={readOnly || Boolean(error) || busy || chainId === null || unavailable !== null}
            loading={busy}
          >
            {buttonLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * `useSearchParams()` opts a route out of static prerendering, and Next refuses
 * to build unless the component that reads it sits under a Suspense boundary —
 * `next build` failed on this page with "useSearchParams() should be wrapped in
 * a suspense boundary". The page has no server-rendered fallback worth drawing
 * (the whole deposit view is client-fetched), so the boundary renders nothing and
 * exists only to mark the bail-out point.
 */
export default function DepositPage() {
  return (
    <React.Suspense fallback={null}>
      <DepositPageContent />
    </React.Suspense>
  );
}
