"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { ArrowUpFromLine, Clock, Info, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PendingCountdown } from "@/components/common/PendingCountdown";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import { UNREADABLE_NOTE } from "@/features/chain-read/chain-read";
import { EscrowOnChain, escrowChainProps } from "@/features/escrow/escrow-on-chain";
import { escrowPresence } from "@/features/escrow/escrow-presence";
import { isEscrowDisarmed } from "@/features/escrow/limits-form";
import { RelayedDoneNotice, RelayedRefusalNotice } from "@/features/escrow/relayed-notices";
import { relayedRefusal, type RelayedRefusal } from "@/features/escrow/relayed-refusal";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { withdrawGasGrantNote } from "@/features/escrow/withdraw-gas-grant-note";
import { withdrawGasNote } from "@/features/escrow/withdraw-gas-note";
import { WITHDRAWAL_COPY } from "@/features/escrow/withdrawal-copy";
import { withdrawalFigures } from "@/features/escrow/withdrawal-figures";
import { ErrorBlock, KeyValueRow, NoteBox, PageHeader, PendingBlock } from "@/features/g30/ui";
import { useCountdown } from "@/hooks/useCountdown";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { BuyerEscrow, EscrowIntent, RelayedEscrowIntent } from "@/interfaces";
import { isTypedDataRequest } from "@/interfaces/chain-transaction";
import { ApiError } from "@/libs/ApiClient";
import {
  createEscrowClaimIntent,
  createEscrowWithdrawIntent,
  getEscrow,
} from "@/services/escrow.service";
import { unsignedPayloadSummary } from "@/libs/chains/unsigned-summary";
import { chainDisplayName, settlementSymbol } from "@/services/chains.service";
import { useChains } from "@/hooks/useChains";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { exceedsScale, formatMoney, toAtomic, toDecimal } from "@/utils/money";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";

/**
 * The buyer's escrow, and the two-step withdrawal out of it.
 *
 * ## What this screen is for
 *
 * It replaces `/funding/withdraw`, which showed a balance and a signing flow
 * that signed nothing — a browser-composed message against a placeholder
 * destination, thrown away, followed by a success state for a withdrawal that
 * had not happened. Every number here is read from the chain and every action
 * here is a transaction the buyer's own wallet signs and broadcasts.
 *
 * ## Two steps, and the reason for the gap between them
 *
 * `request_withdraw(amount)` writes a **ceiling** onto `BuyerEscrow` and starts
 * a clock. It reserves nothing: the escrow keeps redeeming vouchers signed before
 * the request, while the gateway refuses every NEW paid call until the request
 * is claimed or cancelled (see `features/escrow/withdrawal-copy.ts`). That is what the wait is for — it is a settlement window, not a
 * cooling-off period aimed at the buyer. Then `withdraw()` pays
 * `min(requested, escrow_ata.amount)`.
 *
 * The consequence is that the amount requested and the amount received are two
 * different figures and the second can only fall, so this screen prints both
 * and marks the payout "at most" while the clock runs. See
 * `features/escrow/withdrawal-figures.ts`.
 *
 * ## No duration arithmetic, anywhere
 *
 * The countdown is driven by `escrow.withdrawAvailableAt`, an instant the
 * program froze when the request was signed. The program compares against the
 * cluster's clock, and a browser adding an hour to its own would be wrong in
 * the direction that tells a buyer their money is ready before the chain will
 * pay it.
 *
 * `WITHDRAW_DELAY_SECONDS` used to appear once, as prose about the *next*
 * request. **It is gone**, and nothing replaces it: it is a constant of the
 * SOLANA settlement program, this screen is now per chain, and a sentence
 * naming a Solana delay on an eip155 withdrawal is a wrong number told to
 * somebody trying to get their money out. A chain-neutral figure has to come
 * from the API — a second constant here would be the same defect renamed.
 *
 * ## Per chain, and it says which one
 *
 * Withdrawal is per chain, from that chain's card — two withdrawals,
 * never one. The route carries `?chain=<caip2>` and the screen names the chain
 * it is acting on. The name is read off `escrow.account`, the chain the SERVER
 * answered for, not the one the URL asked for: `GET /escrow` takes the account
 * from the session and ignores the query parameter until per-chain
 * agent accounts exist.
 *
 * ## Refusals are statuses, not payloads
 *
 * `EscrowIntent.transaction` is never null (see `interfaces/escrow.ts`), so
 * there is no null branch here. Every refusal is an `ApiError`, and the three
 * materially different 409s share one status — so they are told apart by
 * `code`, never by `status`. The codes below were read off the assay-backend
 * repository, not guessed:
 * `settlement/errors/settlement.errors.ts` and `payment/errors/payment.errors.ts`.
 *
 * ## Nothing signed leaves the browser
 *
 * There is no submit endpoint and there must not be one. `runEscrowIntent`
 * hands the wallet the backend's unsigned bytes and the wallet broadcasts them
 * itself; the platform never holds a signature of the buyer's.
 */

/* ------------------------------------------------------------- refusal copy */

/**
 * One sentence per refusal the escrow routes can answer with.
 *
 * Read off the assay-backend repository:
 *
 *   - `SETTLEMENT_WITHDRAWALS_FROZEN` (409) — `withdrawal.service.ts:107`,
 *     thrown for `REQUEST_WITHDRAW` and `WITHDRAW` when the last reconciliation
 *     found the vault below its liabilities.
 *   - `SETTLEMENT_WITHDRAWAL_NOT_YET_AVAILABLE` (409) — the builder, for a
 *     `withdraw` before `withdraw_available_at` **or** with no request
 *     outstanding. The backend deliberately collapses those two into one code.
 *   - `SETTLEMENT_WITHDRAWAL_DESTINATION_INVALID` (409) — the destination named
 *     the escrow's own token account.
 *   - `PAYMENT_ESCROW_NOT_OPEN` (409) — no `BuyerEscrow` for this account.
 *   - `PAYMENT_ESCROW_BALANCE_UNAVAILABLE` (503) — the chain could not be read
 *     and the backend fails closed rather than serving a stale balance.
 *   - `CHAIN_PROGRAM_NOT_CONFIGURED` / `CHAIN_ACCOUNT_LAYOUT_UNEXPECTED` — the
 *     deployment is misconfigured or the account layout moved under the
 *     backend. Neither is the buyer's to fix, and both must not read as "your
 *     money is gone".
 *
 * Two codes are **not** here on purpose. `ESCROW_SHORTFALL`
 * and `ESCROW_MIRROR_DRIFT` are members of `ReconciliationFindingCode`
 * (`settlement/ports/reconciliation.types.ts`) — they name what a
 * reconciliation *found*, they are never an `ApiError.code`, and the HTTP face
 * of a finding on this path is `SETTLEMENT_WITHDRAWALS_FROZEN`.
 */
const REFUSALS: Record<string, string> = {
  SETTLEMENT_WITHDRAWALS_FROZEN:
    "Withdrawals are frozen while the last reconciliation is investigated — it found the vault holding less than it owes. This is not specific to your escrow and nothing has been taken from it; paying out during a known shortfall would make it a race between users over money that is already not all there.",
  SETTLEMENT_WITHDRAWAL_NOT_YET_AVAILABLE:
    "There is nothing to claim yet — either no request is standing, or the one that is has not finished its wait. The figures above refresh from the chain; reload to see which of the two it is.",
  SETTLEMENT_WITHDRAWAL_DESTINATION_INVALID:
    "That destination is the escrow's own token account, so the withdrawal would pay the escrow back into itself. The program refuses it too.",
  PAYMENT_ESCROW_NOT_OPEN:
    "There is no escrow open for this account. A deposit opens one — nothing can be withdrawn from an account that does not exist yet.",
  PAYMENT_ESCROW_BALANCE_UNAVAILABLE:
    "The chain could not be read, so no figure here can be trusted right now. Nothing was built and nothing was signed. Try again in a moment.",
  CHAIN_PROGRAM_NOT_CONFIGURED:
    "Escrow is not set up on this chain yet, so no transaction can be built. Your escrow is untouched; this is ours to fix.",
  CHAIN_ACCOUNT_LAYOUT_UNEXPECTED:
    "We could not read your escrow account on chain correctly, so no transaction was built. Your escrow is untouched; this is ours to fix — please contact support.",
};

function refusalSentence(error: ApiError): string {
  return (
    REFUSALS[error.code] ??
    // The fallback prints the server's own message rather than inventing one:
    // an unknown code on a money path is exactly when a made-up sentence is
    // most likely to be wrong.
    `${error.message} Quote ${error.code} if you contact support.`
  );
}

/* ------------------------------------------------------------------ helpers */

/** Which button produced the intent currently on screen. */
type Purpose = "REQUEST" | "REPLACE" | "CANCEL" | "CLAIM";

const PURPOSE_TITLE: Record<Purpose, string> = {
  REQUEST: "Withdrawal request",
  REPLACE: "Replacement request",
  CANCEL: "Cancellation of the pending request",
  CLAIM: "Withdrawal",
};

const PURPOSE_DONE: Record<Purpose, string> = {
  REQUEST: "Requested. The wait has started.",
  REPLACE: "Replaced. The wait has restarted from now.",
  CANCEL: "Cancelled. Your escrow is serving calls again.",
  CLAIM: "Withdrawn. The tokens are in your wallet.",
};

/* --------------------------------------------------------------------- page */

function EscrowPageContent() {
  // Blocked by Assay: the main write action is disabled (the API refuses it anyway).
  const readOnly = useAccountReadOnly();
  const queryClient = useQueryClient();

  /*
    Withdrawal is per chain, from that chain's card — two withdrawals,
    never one. The chain arrives on the route (`?chain=<caip2>`), which is
    what makes two balance cards two links to two different screens rather than
    one screen that quietly picks.

    `null` when the route names none, which is the direct-navigation case; the
    backend then answers for the session's account exactly as it always has.
  */
  const requestedChain = useSearchParams().get("chain");
  const { chains } = useChains();

  const escrowQuery = useQuery<BuyerEscrow, ApiError>({
    /*
      The requested chain is part of the key. Without it, opening the second
      card's link would be served the first chain's escrow out of cache — the
      two-chain bug the per-chain cards exist to remove, hiding in a cache key.
    */
    queryKey: ["escrow", requestedChain],
    queryFn: () => getEscrow(requestedChain),
    /*
      No retries, and `networkMode: "always"` — the same setting every other
      funding screen carries, and for the reason written down there: with the
      defaults React Query PAUSES a pending retry when the request rejects with
      ERR_NETWORK, so the screen sits on "Loading…" forever with the API down.
      A money screen that cannot read its figures has to say so immediately.
    */
    retry: 0,
    networkMode: "always" as const,
  });

  const escrow = escrowQuery.data ?? null;
  /*
    The ONE decision on this page about which of the three things the chain
    said. `null` while the query is pending. Never `!escrow.exists`.
  */
  const presence = escrowPresence(escrow);

  /*
    One clock for the whole screen. `PendingCountdown` renders the label from
    the same hook and the same instant, so the qualifier on the payout figure
    and the words under it can never disagree. Never a duration: see the file
    doc.
  */
  const { hasPassed: matured } = useCountdown(escrow?.withdrawAvailableAt);

  const figures = escrow ? withdrawalFigures(escrow, { matured }) : null;
  const decimals = escrow?.balance?.decimals ?? 6;

  /*
    Scoped to the escrow's own owner, not to "sign as me".

    The deposit screen uses a bare `useSigner()` because a deposit is paid out
    of whatever wallet is connected. A withdrawal is not: the program checks
    the signer against the escrow's owner, and the backend builds the
    transaction with that address as the sole signer AND the fee payer. Passing
    the address turns "connected the wrong wallet" into a sentence naming the
    right one, instead of a broadcast that fails on chain after a fee.
  */
  const owner = addressOfAccount(escrow?.account);
  /*
    The chain comes from the escrow's own CAIP-10 account, and it is `null`
    until the query answers — which lands on `chain-unknown`, a real state with
    its own sentence. There is deliberately no default: this screen exists on
    every chain the deployment offers, and a signer bound to the wrong one
    would sign a withdrawal for a network the escrow is not on.
  */
  /*
    The chain the SERVER answered for, never the one asked for. `GET /escrow`
    reports `account` (CAIP-10) and documents it as taken from the session and
    never from the request, so this is the chain the transaction was actually
    built for — the same reasoning `run-stake-intent.ts` gives for reading the
    chain off `intent.account`. Until per-chain agent accounts exist those two can
    differ: the route ignores `?chain=` and answers for the one account there
    is, and this screen must then say the chain it is really acting on.
  */
  const chainId = chainIdOfAccount(escrow?.account);
  const signerState = useSigner({
    chainId,
    address: owner,
  });
  /*
    On EVM the claim is a transaction the buyer sends themselves, so it costs
    gas they may not have. The note states that mechanism and does NOT promise
    the platform's gas grant — see `withdraw-gas-note.ts`.
  */
  const gasNote = withdrawGasNote(chainId ?? "");

  const [amount, setAmount] = React.useState("");
  const [purpose, setPurpose] = React.useState<Purpose | null>(null);
  const [intent, setIntent] = React.useState<EscrowIntent | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);
  const [signError, setSignError] = React.useState<string | null>(null);
  const [signature, setSignature] = React.useState<string | null>(null);
  /*
    The relayed answer is a transaction that has ALREADY been mined — a block
    and a gas figure the buyer did not pay — and it is kept apart from
    `signature` for that reason. Folding it into the broadcast state would put
    "broadcast by your wallet, not by us" under a call the platform sent, and
    would tell a buyer to wait for a confirmation that has already happened.
  */
  const [relayed, setRelayed] = React.useState<RelayedEscrowIntent | null>(null);
  /* A named refusal from the submit route, distinct from a wallet error. */
  const [refusal, setRefusal] = React.useState<RelayedRefusal | null>(null);
  const [broadcasting, setBroadcasting] = React.useState(false);

  function begin(next: Purpose) {
    setPurpose(next);
    setIntent(null);
    setActionError(null);
    setSignError(null);
    setSignature(null);
    setRelayed(null);
    setRefusal(null);
  }

  const build = useMutation<EscrowIntent, ApiError, { purpose: Purpose; atomic?: string }>({
    mutationFn: ({ purpose: p, atomic }) =>
      p === "CLAIM"
        ? // No destination: omitting it pays the buyer's own ATA for the escrow
          // mint, and the program pays `min(requested, balance)` — the browser
          // controls neither figure and must not imply that it does.
          createEscrowClaimIntent()
        : createEscrowWithdrawIntent({ amount: atomic ?? "0" }),
    onMutate: ({ purpose: p }) => begin(p),
    onSuccess: (built) => setIntent(built),
    onError: (error) => setActionError(error instanceof ApiError ? error : null),
  });

  /**
   * The typed amount, as atomic units, or an error sentence.
   *
   * **`"0"` is valid here.** The server's regex is `/^\d+$/` and a zero
   * *cancels* a standing request — it is the only route back to serving traffic
   * without withdrawing. A validator that rejected it would remove that route
   * from the screen entirely.
   */
  const parsed = React.useMemo<{ atomic: string } | { error: string }>(() => {
    const raw = amount.trim();
    if (raw === "") return { error: "" };
    if (!/^\d*\.?\d*$/.test(raw)) return { error: "Digits and one decimal point only." };
    let value: Decimal;
    try {
      value = new Decimal(raw);
    } catch {
      return { error: "That is not an amount." };
    }
    if (value.isNegative()) return { error: "An amount cannot be negative." };
    if (exceedsScale(value, decimals)) {
      return { error: `This asset goes to ${decimals} decimal places. Trim the amount.` };
    }
    return { atomic: toAtomic(value, decimals) };
  }, [amount, decimals]);

  const amountError = "error" in parsed && parsed.error !== "" ? parsed.error : undefined;
  const atomic = "atomic" in parsed ? parsed.atomic : null;
  const cancelsByAmount = atomic !== null && new Decimal(atomic).isZero();

  /**
   * Sign this action, then either broadcast it or hand it to the relayer.
   *
   * Which of the two is the PAYLOAD's decision, not the screen's. On `eip155`
   * `requestWithdraw` is `msg.sender`-only, so the relayed path reaches it through
   * `requestWithdrawBySig` and the backend answers with an EIP-712 request the
   * platform submits — while `withdraw()` on the very same chain is an ordinary
   * transaction the buyer sends themselves, because past the maturity gate
   * there is no remaining brake and a phished signature would empty the escrow.
   * A screen that branched on "is this EVM" would get the second one wrong.
   */
  async function signAndSubmit() {
    if (!intent || !purpose) return;
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
        owner
          ? `Connect the wallet that holds ${owner} — it is the only key this escrow answers to.`
          : "Connect the wallet that owns this escrow.",
      );
      return;
    }
    if (signerState.status !== "ready") {
      setSignError("Connect a wallet to sign this.");
      return;
    }
    setSignError(null);
    setRefusal(null);
    setBroadcasting(true);
    try {
      // Signed only if the payload is the action and amount this form built.
      const result = await runEscrowAction(
        intent,
        signerState.signer,
        purpose === "CLAIM"
          ? { kind: "WITHDRAW" }
          : { kind: "REQUEST_WITHDRAW", amount: build.variables?.atomic ?? "0" },
      );
      if (result.kind === "relayed") {
        setRelayed(result.relayed);
      } else {
        setSignature(result.signature);
      }
      setIntent(null);
      setAmount("");
      /*
        The chain is the source of truth for every figure on this page, and it
        has just moved. Refetching is not cosmetic: leaving the pre-signature
        snapshot up would show a stale ceiling and a stale countdown for a
        request that has already been replaced.
      */
      void queryClient.invalidateQueries({ queryKey: ["escrow"] });
    } catch (e) {
      if (isUserRejection(e)) {
        setSignError("Nothing was signed — the wallet prompt was closed or declined.");
      } else if (e instanceof ApiError) {
        /*
          The platform refused to relay, and named which of five reasons. One
          "something went wrong" here would leave a buyer who has just approved
          a wallet prompt choosing at random between retrying, waiting, and
          connecting a different wallet — and only one of those ever works.
        */
        setRefusal(relayedRefusal(e));
      } else {
        setSignError(e instanceof Error ? e.message : "The wallet did not complete this.");
      }
    } finally {
      setBroadcasting(false);
    }
  }

  /*
    The grant is a property of the INTENT the backend just built, not of the
    screen's chain: `null` on Solana and on every kind but the claim, both of
    which the note module renders as silence.
  */
  const grantNote = withdrawGasGrantNote(intent?.gasGrant);

  const busy = build.isPending || broadcasting;

  return (
    <div className="flex w-full flex-col gap-[18px] bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Escrow"
        sub="your own on-chain account — the platform holds no key to it"
        actions={
          <>
            <Button variant="secondary" asChild>
              {/*
                The chain travels with the link. Limits are set on ONE escrow,
                and a two-chain buyer who arrived here from their second card
                must not be handed a limits screen for the first.
              */}
              <Link
                href={
                  chainId === null
                    ? "/funding/escrow/limits"
                    : `/funding/escrow/limits?chain=${encodeURIComponent(chainId)}`
                }
              >
                <SlidersHorizontal aria-hidden="true" />
                Limits
              </Link>
            </Button>
            <Button asChild>
              <Link href="/funding/deposit">
                <Wallet aria-hidden="true" />
                Add funds
              </Link>
            </Button>
          </>
        }
      />

      {/*
        Which chain this screen is acting on, said in words and impossible to
        miss. Read off the escrow's own CAIP-10 account, so it names the
        chain the transaction will be built for rather than the one the URL
        asked for — those are the same today and stop being the same the moment
        a buyer has two accounts.

        Absent, not guessed, while the escrow is still loading: a chain name
        printed before the answer arrives is a claim about where money is,
        made by a screen that does not know yet.
      */}
      {chainId === null ? null : (
        <p data-testid="escrow-chain-line" className="text-body-sm text-02">
          Withdrawing from <strong>{chainDisplayName(chains, chainId)}</strong>. Balances on other
          chains are withdrawn separately.
        </p>
      )}

      {escrowQuery.isPending ? <PendingBlock label="Reading your escrow from the chain…" /> : null}

      {escrowQuery.error ? (
        <>
          <ErrorBlock code={escrowQuery.error.code} message={escrowQuery.error.message} />
          {REFUSALS[escrowQuery.error.code] ? (
            <NoteBox tone="warning" icon={<Info aria-hidden="true" />}>
              {refusalSentence(escrowQuery.error)}
            </NoteBox>
          ) : null}
        </>
      ) : null}

      {/*
        THREE states, three blocks, and they used to be two.

        `exists: false` is not "a balance of zero", and the two need opposite
        instructions. No escrow means there is no account to withdraw from and
        a deposit opens one. An empty escrow means the account is there and
        waiting for money. Collapsing them would send a buyer with no account
        looking for a withdraw button that could never work for them.

        And `exists: null` is neither. It is the chain refusing to answer, and
        the branch below it used to read `!escrow.exists` — `!null === true` —
        so an outage printed the definitive "you do not have an escrow" at a
        buyer who had $9.96 and, quite possibly, an escrow. `escrowPresence`
        is the only thing on this page allowed to decide which of the three
        this is.
      */}
      {presence === "unreadable" ? (
        <div
          data-testid="escrow-unreadable"
          className="flex w-full flex-col gap-3.5 rounded-xl border border-warning-20 bg-warning-10 p-5 tablet:p-6"
        >
          <h2 className="text-heading-sm text-01">We could not read the chain just now</h2>
          <p className="text-body-sm leading-[1.6] text-02">
            {UNREADABLE_NOTE} We do not know whether you have an escrow on{" "}
            {chainId === null ? "this chain" : chainDisplayName(chains, chainId)}, what it holds,
            or whether a withdrawal is standing — so none of those is shown. Nothing has changed on chain, and your money is where
            it was. Try again in a moment.
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void escrowQuery.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {presence === "absent" ? (
        <div className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
          <h2 className="text-heading-sm text-01">You do not have an escrow yet</h2>
          <p className="text-body-sm leading-[1.6] text-02">
            An escrow is an account on chain that only your wallet can withdraw from. Yours has not
            been opened — your first deposit opens it, and there is nothing to withdraw until then.
          </p>
          <div>
            <Button asChild>
              <Link href="/funding/deposit">
                <Wallet aria-hidden="true" />
                Make a deposit
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      {/*
        THE ONBOARDING STEP, and it is deliberately the first thing on the
        screen rather than a line inside the limits panel.

        `open_escrow` lets any signer pay the rent — the platform fronts it —
        but refuses to let that signer set a non-zero limit, because the limits
        are the thing that bounds a compromised backend. So every escrow this
        platform opens comes up DISARMED: it exists, it can hold money, and
        `redeem_voucher` refuses every single call against it.

        Nothing else on this page reveals that. The balance reads correctly,
        the escrow exists, no withdrawal is pending — a buyer whose calls are
        all failing would find nothing here to explain it. Hence a block above
        the fold, in the warning tone, naming the one transaction that fixes it.
      */}
      {presence === "open" && escrow && isEscrowDisarmed(escrow) ? (
        <div className="flex w-full flex-col gap-3.5 rounded-xl border border-warning-20 bg-warning-10 p-5 tablet:p-6">
          <div className="flex w-full flex-col gap-1">
            <h2 className="text-heading-sm text-01">
              One step left — your escrow cannot pay for anything yet
            </h2>
            <p className="text-body-sm leading-[1.6] text-02">
              Your escrow is open{escrow.balance ? " and funded" : ""}, and it is set to refuse
              every paid call. That is not a fault: we opened the account for you, and the
              program does not let us choose your spending limits — only a transaction signed by
              your own wallet can. Until you set them, nothing can be charged to this escrow,
              including by us.
            </p>
          </div>
          <div>
            <Button asChild>
              <Link href="/funding/escrow/limits">
                <SlidersHorizontal aria-hidden="true" />
                Set your limits
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      {presence === "open" && escrow && figures ? (
        <>
          {/* ---------------------------------------------------- addresses */}
          {/*
            The explorer named here is the one `GET /chains` served for THIS
            escrow's chain — never "Solana", which is what this block said until
            an eip155 buyer was told to go and check their money on the wrong
            network. `chain` is null while the chain list is loading or after it
            failed, and the component then links nothing rather than guessing.
          */}
          <EscrowOnChain escrow={escrow} {...escrowChainProps(chains, chainId)} />

          {/* ------------------------------------------------------ balance */}
          <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
            <h2 className="text-heading-sm text-01">Balance</h2>
            <div className="flex w-full flex-col">
              <KeyValueRow
                label="In the escrow"
                sub="what the token account holds right now"
                value={formatMoney(escrow.balance, { decimals: 2 })}
              />
              <KeyValueRow
                label="Held by calls in flight"
                sub="reserved against work already started"
                value={`−${formatMoney(escrow.openHolds, { decimals: 2 })}`}
              />
              <KeyValueRow
                label="Spendable"
                sub="what a new call can draw on"
                value={formatMoney(escrow.spendable, { decimals: 2 })}
                total
              />
            </div>
            <p className="text-body-xs leading-[1.55] text-03">
              A withdrawal pays out of the escrow balance, not out of the spendable figure — the
              program reads the token account and knows nothing about holds this platform is
              tracking.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/funding/escrow/limits">
                  <SlidersHorizontal aria-hidden="true" />
                  Per-call and per-window limits
                </Link>
              </Button>
            </div>
          </section>

          {/* --------------------------------------------------- withdrawal */}
          <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
            <div className="flex w-full flex-col gap-1">
              <h2 className="text-heading-sm text-01">Withdraw</h2>
              <p className="text-body-sm leading-[1.6] text-02">
                Two steps, both signed by your wallet. You ask first, wait, then claim — the wait is
                there so a provider holding a voucher you already signed can still be paid out of
                this escrow before the money leaves it.
              </p>
            </div>

            {figures.pending ? (
              <>
                {/*
                  Three figures, design F-6. The ceiling that was signed for,
                  what the escrow actually holds, and what `withdraw()` would
                  pay — which is `min` of the two and can still fall while the
                  clock runs, which is what "at most" says.
                */}
                <div className="flex w-full flex-col rounded-lg border border-01 bg-02 px-4 pb-3.5 pt-1">
                  <KeyValueRow
                    label="You requested"
                    sub="the ceiling your wallet signed for"
                    value={formatMoney(figures.requested, { decimals: 2 })}
                  />
                  <KeyValueRow
                    label="The escrow holds"
                    sub="live, at the reading above"
                    value={formatMoney(figures.balance, { decimals: 2 })}
                  />
                  <KeyValueRow
                    label={figures.qualifier ? "You will receive at most" : "You will receive"}
                    sub={
                      figures.cappedByBalance
                        ? "the balance, not the request — earlier calls have settled since you asked"
                        : "the request, in full"
                    }
                    value={formatMoney(figures.payout, { decimals: 2 })}
                    total
                  />
                </div>

                <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 px-4 py-3.5">
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-03">
                    <Clock width={15} height={15} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-body-sm text-01">
                        {matured ? "Ready to claim" : "Waiting"}
                      </span>
                      <PendingCountdown
                        at={escrow.withdrawAvailableAt}
                        passedLabel="the wait is over"
                      />
                    </div>
                    <p className="text-body-xs leading-[1.55] text-02">
                      {matured ? WITHDRAWAL_COPY.whenMatured : WITHDRAWAL_COPY.whilePending}
                    </p>
                  </div>
                </div>

                {gasNote.kind === "evm" ? (
                  /*
                    Scoped to the CLAIM, out loud. The note sits above two
                    buttons and only one of them costs the buyer anything:
                    starting, replacing and cancelling a request all go through
                    `requestWithdrawBySig`, which the platform submits and pays
                    for. An unscoped fee warning here is the exact sentence that
                    tells a buyer holding no ETH they cannot do something they
                    can — at the moment they are trying to get their money out.
                  */
                  <NoteBox tone="neutral" icon={<Info aria-hidden="true" />}>
                    <span data-testid="withdraw-gas-note">
                      Claiming is the one step you send yourself. {gasNote.text} Starting,
                      replacing and cancelling a request are submitted by us and we pay the fee
                      for those — they cost you nothing.
                    </span>
                  </NoteBox>
                ) : null}

                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    disabled={readOnly || busy || !matured}
                    onClick={() => build.mutate({ purpose: "CLAIM" })}
                  >
                    <ArrowUpFromLine aria-hidden="true" />
                    Claim {formatMoney(figures.payout, { decimals: 2 })}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={readOnly || busy}
                    onClick={() => build.mutate({ purpose: "CANCEL", atomic: "0" })}
                  >
                    Cancel the pending request
                  </Button>
                </div>
                <p className="text-body-xs leading-[1.55] text-03">
                  {WITHDRAWAL_COPY.cancel}
                </p>
              </>
            ) : null}

            {/*
              The request form. Secondary once a request stands, because
              `request_withdraw` OVERWRITES rather than adds — and the copy has
              to say that, since a buyer who reads it as "request another $20"
              would be replacing a matured $500 request with an immature $20
              one and restarting the clock on the difference.
            */}
            <form
              className="flex w-full flex-col gap-3.5 rounded-lg border border-01 bg-02 px-4 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (atomic === null) return;
                /*
                  A typed zero is submitted, never refused. The server's regex
                  is `/^\d+$/` and a zero is the instruction that CANCELS a
                  standing request — the only way back to serving traffic
                  without withdrawing. A validator that rejected it would
                  delete that route from the screen. With nothing standing it
                  is a harmless no-op the chain will accept, so it is still not
                  this form's business to refuse.
                */
                build.mutate({
                  purpose:
                    cancelsByAmount && figures.pending
                      ? "CANCEL"
                      : figures.pending
                        ? "REPLACE"
                        : "REQUEST",
                  atomic,
                });
              }}
            >
              <div className="flex w-full flex-col gap-1">
                <h3 className="text-label-sm text-01">
                  {figures.pending ? "Replace the pending request" : "Request a withdrawal"}
                </h3>
                <p className="text-body-xs leading-[1.55] text-02">
                  {/*
                    No figure for the wait, on purpose. `WITHDRAW_DELAY_SECONDS`
                    stood here and it is a SOLANA PROGRAM constant — wrong on
                    every eip155 chain, and this screen is now per chain. The
                    only instant that is true is `withdrawAvailableAt`, which
                    the program froze when the request was signed and which the
                    countdown above already renders; a *future* request has no
                    such instant yet and nothing serves the delay per chain.
                    Nothing replaces the constant: a chain-neutral figure has to
                    come from the API, and inventing a second constant here
                    would be the same defect with a different number.
                  */}
                  {figures.pending
                    ? "A new request replaces the one above rather than adding to it, and the wait starts again from zero — including for the amount you have already waited for."
                    : WITHDRAWAL_COPY.beforeRequest}
                </p>
              </div>

              <Field
                id="escrow-withdraw-amount"
                label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                /*
                  The ticker of the asset THIS escrow settles in, off
                  `GET /chains`. It was the literal `USDC`, which labels a
                  Robinhood-testnet buyer's USDG as a token that does not exist
                  on their chain — on the field where they type how much of it
                  to withdraw. Empty rather than a guess when the chain list
                  has not answered: a blank suffix asks nothing of the reader,
                  a wrong one tells them something false.
                */
                suffix={chainId === null ? "" : (settlementSymbol(chains, chainId) ?? "")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                error={amountError}
                hint={
                  cancelsByAmount && figures.pending
                    ? "Zero cancels the standing request instead of withdrawing anything."
                    : `The escrow holds ${formatMoney(figures.balance, { decimals: 2 })}. You may ask for more than that — you will be paid whatever is there when you claim.`
                }
              />

              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="submit"
                  variant={figures.pending ? "secondary" : "primary"}
                  disabled={readOnly || busy || atomic === null}
                >
                  {cancelsByAmount && figures.pending
                    ? "Cancel the pending request"
                    : figures.pending
                      ? "Replace the request"
                      : "Request a withdrawal"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setAmount(toDecimal(figures.balance).toFixed(decimals, Decimal.ROUND_DOWN))
                  }
                >
                  Use the whole balance
                </Button>
              </div>
            </form>

            {/* ------------------------------------------------- refusals */}
            {/*
              A refusal from the SUBMIT route, and it is a different event from
              the one below. `actionError` is the platform declining to BUILD —
              nothing was signed and no counter moved. This one arrives after
              the buyer approved a wallet prompt, so it has to say what became
              of that signature and whether re-signing can work at all.
            */}
            {refusal ? (
              <RelayedRefusalNotice
                testId="withdraw-relayed-refusal"
                refusal={refusal}
                title={
                  purpose ? `${PURPOSE_TITLE[purpose]} was not submitted` : "That was not submitted"
                }
              />
            ) : null}

            {actionError ? (
              <div
                role="alert"
                className="flex w-full flex-col gap-1 rounded-lg border border-danger-20 bg-danger-10 px-4 py-3.5"
              >
                <p className="text-label-sm text-01">
                  {purpose ? `${PURPOSE_TITLE[purpose]} was refused` : "That was refused"}
                </p>
                <p className="text-body-13 leading-[1.55] text-02">
                  {refusalSentence(actionError)}
                </p>
                <p className="font-mono text-mono-12 text-03">{actionError.code}</p>
              </div>
            ) : null}

            {/* --------------------------------------------------- signing */}
            {intent && purpose ? (
              <div className="flex w-full flex-col gap-3">
                <Banner
                  tone="primary"
                  title={`${PURPOSE_TITLE[purpose]} is ready for your wallet`}
                  description={
                    isTypedDataRequest(intent.transaction)
                      ? `The platform holds no key of yours and cannot sign this. ${unsignedPayloadSummary(intent.transaction)} We pay the network fee — you need none of the chain's own coin for this step.`
                      : `Unsigned — the platform holds no key of yours and cannot sign this. ${unsignedPayloadSummary(intent.transaction)}`
                  }
                />
                {/*
                  The gas grant, once the backend has actually acted on it. NOT a promise made before the click — `withdrawGasNote`
                  above is still the pre-click copy and still promises nothing,
                  because before this request there is nothing to report.

                  Every branch lives in `withdraw-gas-grant-note.ts` and none of
                  them is written inline here: a list-branching line in a page
                  component has no guard at all, since no test can render it.

                  Nothing here disables the signing button. The transaction is
                  valid in all three states, the wallet is the judge of whether
                  it can pay the fee, and a screen that withheld a signature
                  because it believed the wallet was empty would be wrong for
                  every buyer who topped up in another tab.
                */}
                {grantNote ? (
                  <NoteBox
                    tone={grantNote.tone === "blocked" ? "warning" : "neutral"}
                    icon={
                      grantNote.tone === "wait" ? (
                        <Clock aria-hidden="true" />
                      ) : (
                        <Info aria-hidden="true" />
                      )
                    }
                  >
                    <span data-testid="withdraw-gas-grant-note">{grantNote.text}</span>
                    {grantNote.transactionHash ? (
                      <span className="mt-1.5 block font-mono text-mono-12 text-03 break-all">
                        {grantNote.transactionHash}
                      </span>
                    ) : null}
                  </NoteBox>
                ) : null}
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button disabled={broadcasting} onClick={() => void signAndSubmit()}>
                    <ShieldCheck aria-hidden="true" />
                    {broadcasting ? "Waiting for your wallet…" : "Sign in your wallet"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={broadcasting}
                    onClick={() => {
                      setIntent(null);
                      setPurpose(null);
                    }}
                  >
                    Not now
                  </Button>
                </div>
                {signerState.status === "no-wallet" ? (
                  <p className="text-body-xs text-02">
                    No wallet is connected. Connect the one that owns this escrow to sign.
                  </p>
                ) : null}
                {signError ? (
                  <p role="alert" className="text-body-13 text-danger-600">
                    {signError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {relayed && purpose ? (
              <RelayedDoneNotice
                testId="withdraw-relayed-done"
                relayed={relayed}
                title={PURPOSE_DONE[purpose]}
                /*
                  No money moved, said out loud. Both relayed doors write a rule
                  — a ceiling and a clock — and a green block after a
                  *withdrawal request* that omitted this would read as a payout.
                  The payout is `withdraw()`, which is a separate button and a
                  transaction the buyer sends themselves.
                */
                effect="No money moved: this writes a ceiling and a clock onto your escrow, and the payout is the separate claim step once the wait is over."
              />
            ) : null}

            {signature && purpose ? (
              <div className="flex w-full flex-col gap-2.5 rounded-lg border border-teal-20 bg-teal-10 px-4 py-4">
                <p className="text-label-sm text-01">{PURPOSE_DONE[purpose]}</p>
                <p className="text-body-13 leading-[1.55] text-02">
                  Broadcast by your wallet, not by us. The figures above refresh from the chain and
                  may lag the transaction by a few seconds.
                </p>
                <CodeBlock title="Transaction signature" code={signature} />
              </div>
            ) : null}
          </section>

          <NoteBox tone="neutral" icon={<ShieldCheck aria-hidden="true" />}>
            {/*
              "signs and broadcasts" was true of every action here until the
              relayed doors were wired, and it is now false for three of the
              four on `eip155`: the platform submits those and pays for them.
              What survives unchanged — and is the only part that was ever load
              bearing — is that nothing moves without the buyer's signature.
              Saying "broadcasts" on a screen whose Cancel button is relayed
              would be describing a submit path this browser does not have.
            */}
            {gasNote.kind === "evm"
              ? "Every action on this page carries your own wallet's signature, and the contract checks it against your address. We submit the ones we pay for and you send the claim yourself. Either way, the escrow contract only pays out or withdraws against your wallet's signature. The contracts are upgradeable, so this holds for the deployed version."
              : "Every action on this page is a transaction your own wallet signs and broadcasts. The escrow program only pays out or withdraws against your wallet's signature. The program is upgradeable, so this holds for the deployed version."}
          </NoteBox>
        </>
      ) : null}
    </div>
  );
}

/**
 * `useSearchParams()` opts a route out of static prerendering, and Next refuses
 * to build unless the component that reads it sits under a Suspense boundary —
 * `next build` failed on this page with a prerender error the moment `?chain=`
 * was read. The page has no server-rendered fallback worth drawing (every
 * figure is read from the chain through the API), so the boundary renders
 * nothing and exists only to mark the bail-out point. Same shape and same
 * reason as `funding/deposit/page.tsx`.
 */
export default function EscrowPage() {
  return (
    <React.Suspense fallback={null}>
      <EscrowPageContent />
    </React.Suspense>
  );
}
