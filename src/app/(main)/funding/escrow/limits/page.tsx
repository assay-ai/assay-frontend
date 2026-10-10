"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Lock, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { percentOf, timestamp } from "@/components/g31/format";
import { UNREADABLE_NOTE } from "@/features/chain-read/chain-read";
import { escrowPresence } from "@/features/escrow/escrow-presence";
import { ErrorBlock, KeyValueRow, NoteBox, PageHeader, PendingBlock } from "@/features/g30/ui";
import {
  ESCROW_LIMITS_DECIMALS,
  isEscrowDisarmed,
  limitsLanded,
  limitsLandingInterval,
  parseLimitsForm,
  submitLimitsForm,
  type LimitsFormErrors,
} from "@/features/escrow/limits-form";
import { RelayedDoneNotice, RelayedRefusalNotice } from "@/features/escrow/relayed-notices";
import { relayedRefusal, type RelayedRefusal } from "@/features/escrow/relayed-refusal";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { EscrowIntent, EscrowLimitsBody, RelayedEscrowIntent } from "@/interfaces";
import { isTypedDataRequest } from "@/interfaces/chain-transaction";
import { ApiError } from "@/libs/ApiClient";
import { useChains } from "@/hooks/useChains";
import { settlementSymbol } from "@/services/chains.service";
import { createEscrowLimitsIntent, getEscrow } from "@/services/escrow.service";
import { unsignedPayloadSummary } from "@/libs/chains/unsigned-summary";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * On-chain escrow limits — the buyer's OWN defence, not the
 * platform's.
 *
 * **Why this is a separate screen from `/limits`.** `/limits` (the limits screen,
 * `src/components/g31/limits-view.tsx`) is the platform's spend policy: six
 * ceilings this backend checks in its own pre-flight, before a call is priced
 * or a hold is placed. That screen's own headline note already says the
 * quiet part out loud — "a bug in our software can defeat these — they are a
 * control, not a guarantee." `maxVoucherAmount` and `maxPerWindow` here are
 * the opposite kind of control: the program stores them on the buyer's escrow PDA,
 * and `redeem_voucher` on the settlement program checks them on chain, on
 * every redemption. No backend code, compromised or not, can raise them —
 * only a transaction signed by the buyer's own wallet can. Merging the two
 * screens would bury that distinction under one edit form; keeping them
 * apart is what lets each screen say plainly what it is and is not.
 *
 * **`0` is a real, dangerous value, not "unlimited".** `GetEscrowResponseDto`
 * and `SetEscrowLimitsBodyDto` both say so in `@/interfaces/escrow`: `"0"`
 * refuses every redemption; `u64::MAX` is what "no ceiling" actually looks
 * like on the wire. So an empty field is a validation error
 * (`parseLimitsForm` in `@/features/escrow/limits-form`, unit-tested apart
 * from this component), never a submitted `"0"`, and a *typed* `0` requires
 * an explicit tick before it can be sent at all.
 *
 * **One wallet-signed step, effective immediately.** `POST
 * /escrow/limits-intent` answers with `EscrowIntent`, whose `transaction` is
 * never null (a refusal is a 409/503, not a null-carrying 201 — see the
 * envelope's own doc comment) — so there is deliberately no null branch here,
 * unlike the stake withdrawal pattern this screen's sibling (`provider/exit`)
 * follows. `runEscrowIntent` puts the buyer's own signature on the bytes and
 * broadcasts; the platform never holds a key that could do either.
 */

const DASH = "—";

function windowLabel(windowSeconds: number): string {
  if (windowSeconds > 0 && windowSeconds % 3600 === 0) {
    const hours = windowSeconds / 3600;
    return `${hours}h`;
  }
  return `${windowSeconds}s`;
}

function EscrowLimitsPageContent() {
  const queryClient = useQueryClient();
  /*
    The same `?chain=<caip2>` the escrow screen takes, carried so that arriving
    here from a two-chain buyer's second card does not silently set limits on
    the first chain's escrow. The key includes it for the same reason: without
    it the second chain's screen is served the first chain's cached answer.

    The backend does not read it yet — `GET /escrow` takes the account from the
    session — so this is shaped for N and identical on one.
  */
  const requestedChain = useSearchParams().get("chain");
  /*
    The limits just signed, while a read has not shown them yet. A single
    refetch after the write was not enough: on eip155:46630 it read the
    pre-write 0 / 0 and the screen kept saying so until a reload. See
    `limitsLandingInterval`.
  */
  const [awaitingLimits, setAwaitingLimits] = React.useState<{
    body: EscrowLimitsBody;
    since: number;
  } | null>(null);
  const escrowQuery = useQuery({
    queryKey: ["escrow", requestedChain],
    queryFn: () => getEscrow(requestedChain),
    retry: 0,
    networkMode: "always" as const,
    refetchInterval: (query) => limitsLandingInterval(query.state.data, awaitingLimits, Date.now()),
  });
  const escrow = escrowQuery.data;
  /* Which of the three the chain said. Never `!escrow?.exists` — see the block below. */
  const presence = escrowPresence(escrow);

  /*
    Scoped to the escrow's OWNER, not to "sign as me", and this is the one line
    the whole relayed path stands on.

    `setEscrowLimits` is `msg.sender`-only on `eip155`, so the buyer's brake is
    reached through `setLimitsBySig`: the wallet signs an EIP-712 struct naming
    `buyer`, and the CONTRACT recovers the signer and compares the two. Privy
    composes its wallet list embedded-first and defaults to the first entry, so
    omitting the address here produces a real signature from the wrong account —
    refused 403 by the platform and `SignerIsNotBuyer` by the chain, in both
    cases after the buyer approved a prompt. On Solana the same address is the
    transaction's sole signer and fee payer, so naming it is right there too.

    `""` while the escrow is loading is deliberate: it is a defined address no
    wallet matches, and `chain-unknown` outranks it anyway until the query
    answers with the chain.
  */
  const owner = addressOfAccount(escrow?.account);
  const signerState = useSigner({
    chainId: chainIdOfAccount(escrow?.account),
    address: owner,
  });

  const decimals = escrow?.maxVoucherAmount?.decimals ?? ESCROW_LIMITS_DECIMALS;

  /*
    The ticker both amount fields are denominated in, off `GET /chains` and
    keyed on THIS escrow's own chain. Both fields carried the literal `USDC`,
    which is the wrong token on `eip155:46630` — and this is the screen where a
    buyer sets the two on-chain ceilings that decide whether any call of theirs
    can be paid at all.
  */
  const { chains } = useChains();
  const escrowChainId = chainIdOfAccount(escrow?.account);
  const assetSymbol =
    escrowChainId === null ? "" : (settlementSymbol(chains, escrowChainId) ?? "");

  const [maxVoucherAmount, setMaxVoucherAmount] = React.useState("");
  const [maxPerWindow, setMaxPerWindow] = React.useState("");
  const [confirmZero, setConfirmZero] = React.useState(false);
  const [errors, setErrors] = React.useState<LimitsFormErrors>({});
  const [intent, setIntent] = React.useState<EscrowIntent | null>(null);
  const [signature, setSignature] = React.useState<string | null>(null);
  /*
    The relayed answer is NOT a signature and must not be stored as one. It is a
    transaction that has already been mined, with a block and a gas figure the
    buyer did not pay — telling them to "wait for the network to confirm this"
    would be describing something that finished before the response came back.
  */
  const [relayed, setRelayed] = React.useState<RelayedEscrowIntent | null>(null);
  const [signError, setSignError] = React.useState<string | null>(null);
  /* A named refusal from a submit route, kept apart from a wallet error. */
  const [refusal, setRefusal] = React.useState<RelayedRefusal | null>(null);
  const [broadcasting, setBroadcasting] = React.useState(false);

  const disarmed = isEscrowDisarmed(escrow);

  // Seeds the two fields from the current on-chain values exactly once, so a
  // person opening this screen sees what is set today rather than a blank
  // form — but never overwrites what they are mid-typing on a later refetch.
  //
  // A DISARMED escrow is not seeded. Its on-chain values are the zeros
  // `open_escrow` left behind, and writing them into the form would put this
  // screen one click away from submitting "refuse everything" — behind the
  // confirmation tick that exists to make a zero deliberate, which a
  // pre-filled zero is exactly not. Blank fields fail validation outright
  // (`parseLimitsForm`), so the buyer has to name both numbers.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current) return;
    if (escrow?.exists && escrow.maxVoucherAmount && escrow.maxPerWindow && !disarmed) {
      setMaxVoucherAmount(toDecimal(escrow.maxVoucherAmount).toString());
      setMaxPerWindow(toDecimal(escrow.maxPerWindow).toString());
      seeded.current = true;
    }
  }, [escrow, disarmed]);

  // Live-previews whether the currently typed amounts would need the zero
  // confirmation, without waiting for a submit press.
  const preview = parseLimitsForm({ maxVoucherAmount, maxPerWindow, confirmZero: true }, decimals);
  const zeroFields = preview.ok ? preview.zeroFields : [];
  const needsZeroConfirm = zeroFields.length > 0;

  const setLimits = useMutation({
    mutationFn: (body: { maxVoucherAmount: string; maxPerWindow: string }) =>
      createEscrowLimitsIntent(body),
    onSuccess: (result) => {
      setIntent(result);
      setSignature(null);
      setRelayed(null);
      setSignError(null);
      setRefusal(null);
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIntent(null);
    setSignature(null);
    setRelayed(null);
    setSignError(null);
    setRefusal(null);

    const result = await submitLimitsForm(
      { maxVoucherAmount, maxPerWindow, confirmZero },
      (body) => setLimits.mutateAsync(body),
      decimals,
    );

    setErrors(result.ok ? {} : result.errors);
  }

  /**
   * Sign the request, then either broadcast it or hand it to the relayer —
   * whichever of the two this chain uses.
   *
   * The branch is inside `runEscrowAction` and keys off the payload's own
   * `kind`, never off the screen's chain: the backend answers `typed-data`
   * exactly when it built something for the relayer, and a screen deciding for
   * itself would be wrong about the one EVM escrow action that is an ordinary
   * transaction.
   */
  async function signAndSubmit() {
    if (!intent) return;
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
      /*
        "You have wallets, none of them is this one" needs the opposite
        instruction from "you have no wallet", and it is the likelier of the two
        here: the escrow answers to exactly one address and a browser can hold
        several.
      */
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
      const signed = setLimits.variables;
      const result = await runEscrowAction(intent, signerState.signer);
      if (result.kind === "relayed") {
        setRelayed(result.relayed);
        // The relayer's own post-transaction read, when it already shows the
        // new limits, is the freshest answer there is — use it straight away.
        if (signed && limitsLanded(result.relayed.escrow, signed)) {
          queryClient.setQueryData(["escrow", requestedChain], result.relayed.escrow);
        }
      } else {
        setSignature(result.signature);
      }
      // Takes effect the moment it lands; refetch so the meter and the
      // "currently set" figures below stop reading the pre-write state, and
      // keep polling until a read actually shows the signed limits.
      if (signed) setAwaitingLimits({ body: signed, since: Date.now() });
      queryClient.invalidateQueries({ queryKey: ["escrow"] });
    } catch (e) {
      if (isUserRejection(e)) {
        setSignError("Nothing was signed — the wallet prompt was closed or declined.");
      } else if (e instanceof ApiError) {
        /*
          The platform refused to relay, and it said which of five reasons. The
          sentence and the instruction both come from `relayedRefusal` — a
          single "something went wrong" here is the defect that makes a buyer
          guess between retrying, waiting and swapping wallets.
        */
        setRefusal(relayedRefusal(e));
      } else {
        setSignError(e instanceof Error ? e.message : "The wallet did not complete this.");
      }
    } finally {
      setBroadcasting(false);
    }
  }

  /** Throws the dead signature away and asks for a fresh request to sign. */
  function rebuildRequest() {
    setIntent(null);
    setRelayed(null);
    setSignature(null);
    setRefusal(null);
    setSignError(null);
  }

  /*
    Whether the bytes in hand are a relayed signature request rather than a
    transaction. Read off the PAYLOAD, never off the chain: `isTypedDataRequest`
    is the wire's own discriminant, and the backend sets it exactly when it
    built something for the relayer to submit.
  */
  const relayedRequest = intent !== null && isTypedDataRequest(intent.transaction);

  const windowPercent = percentOf(escrow?.spentInWindow, escrow?.maxPerWindow);

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="On-chain escrow limits"
        sub="two limits your wallet controls, not us"
      />

      {/*
        The onboarding branch. A disarmed escrow is the state EVERY escrow this
        platform opens starts in — `open_escrow` refuses a non-zero limit from
        anyone but the buyer — so for most people this is not an edge case, it
        is the first visit. It gets the warning tone and the "why" ahead of the
        "what", because a buyer whose calls are all failing needs the cause
        before the control.
      */}
      {disarmed ? (
        <NoteBox tone="warning" icon={<Lock width={15} height={15} strokeWidth={1.5} />}>
          Your escrow is set to refuse every paid call, and this is the transaction that changes
          that. We opened the account and paid its rent, but the program does not let whoever
          opened an escrow choose its spending limits — that would let us bound ourselves. Sign
          the two figures below and your calls start being paid.
        </NoteBox>
      ) : (
        <NoteBox tone="primary" icon={<ShieldCheck width={15} height={15} strokeWidth={1.5} />}>
          These two limits live on chain and only your wallet can change them. They cap what any
          single call can charge you and what can be charged in a rolling window — including by us.
        </NoteBox>
      )}

      {/*
        The other half of the cross-link. `/limits` carries the matching
        sentence pointing back here (see `src/components/g31/limits-view.tsx`).
      */}
      <p className="text-body-xs text-03">
        This is different from the platform&rsquo;s own{" "}
        <Link href="/limits" className="font-semibold text-primary-600 underline">
          spend policy
        </Link>
        , which we enforce and could ignore if this platform were compromised — these two limits
        cannot be.
      </p>

      {escrowQuery.isPending ? (
        <PendingBlock label="Loading your escrow…" />
      ) : escrowQuery.isError ? (
        <ErrorBlock
          code={escrowQuery.error instanceof ApiError ? escrowQuery.error.code : "UNKNOWN"}
          message={
            escrowQuery.error instanceof ApiError
              ? escrowQuery.error.message
              : "The request could not be completed."
          }
        />
      ) : presence === "unreadable" ? (
        /*
          The same `!escrow?.exists` defect this route's parent had: `exists` is
          `boolean | null` and `!null === true`, so an unreadable chain printed
          the definitive "No escrow yet" — and this screen's version of that is
          worse, because it also tells the buyer their calls are being refused
          and hands them a deposit button for an account that may already exist
          and already be armed.
        */
        <Panel data-testid="escrow-limits-unreadable">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>We could not read the chain</PanelTitle>
              <PanelDescription>unknown, not zero and not &ldquo;no escrow&rdquo;</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <p className="text-body-sm text-02">
              {UNREADABLE_NOTE} We do not know whether you have an escrow on this chain or what
              its limits are, so this screen is showing you neither rather than guessing. Nothing
              has changed on chain. Try again in a moment.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void escrowQuery.refetch();
              }}
            >
              Try again
            </Button>
          </PanelBody>
        </Panel>
      ) : presence === "absent" ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>No escrow yet</PanelTitle>
              <PanelDescription>a deposit opens one</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <p className="text-body-sm text-02">
              There is nothing to set limits on until an escrow exists. Depositing funds opens one
              automatically — there is no separate &ldquo;open an escrow&rdquo; step. Come back
              here straight afterwards: an escrow we open for you starts out refusing every paid
              call, and this screen is where you lift that.
            </p>
            <Button asChild type="button">
              <Link href="/funding/deposit">Make a deposit</Link>
            </Button>
          </PanelBody>
        </Panel>
      ) : presence === "open" && escrow ? (
        <>
          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Currently set</PanelTitle>
                {/*
                  `$0.00` is the one figure on this screen that reads as its own
                  opposite. Everywhere else in this product a zero limit would
                  mean "unbounded"; here it means "refuse everything", and it is
                  what the program writes at open. So the description says which
                  of the two a reader is looking at rather than leaving the
                  number to speak for itself.
                */}
                <PanelDescription>
                  {disarmed
                    ? "read straight off the chain — a zero here refuses every call, it does not mean unlimited"
                    : "read straight off the chain"}
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-4 pt-2">
              <KeyValueRow
                label="Max per call"
                sub="a single redemption above this is refused"
                value={
                  escrow.maxVoucherAmount
                    ? formatMoney(escrow.maxVoucherAmount, { decimals: 2 })
                    : DASH
                }
              />
              <KeyValueRow
                label="Max per window"
                sub={`the rolling ${windowLabel(escrow.windowSeconds)} window resets on a schedule the program keeps, not a fixed clock time`}
                value={
                  escrow.maxPerWindow ? formatMoney(escrow.maxPerWindow, { decimals: 2 }) : DASH
                }
              />
              <div className="pt-3">
                <Meter
                  label="Spent in this window"
                  amount={
                    escrow.spentInWindow && escrow.maxPerWindow
                      ? `${formatMoney(escrow.spentInWindow, { decimals: 2 })} of ${formatMoney(escrow.maxPerWindow, { decimals: 2 })}`
                      : DASH
                  }
                  percent={windowPercent ?? 0}
                  tone={
                    windowPercent !== null && windowPercent >= 90 ? "warning" : "primary"
                  }
                  note={
                    escrow.windowStartedAt
                      ? `window opened ${timestamp(escrow.windowStartedAt)} UTC`
                      : "the window has not opened yet — it starts at your next redemption"
                  }
                />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Change your limits</PanelTitle>
                <PanelDescription>one wallet signature, effective immediately</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-4 p-5">
              <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit}>
                <Field
                  label="Max per call"
                  id="max-voucher-amount"
                  inputMode="decimal"
                  suffix={assetSymbol}
                  value={maxVoucherAmount}
                  onChange={(event) => setMaxVoucherAmount(event.target.value)}
                  error={errors.maxVoucherAmount}
                  hint={
                    !errors.maxVoucherAmount
                      ? "the ceiling on any single redemption from this escrow"
                      : undefined
                  }
                />
                <Field
                  label="Max per rolling window"
                  id="max-per-window"
                  inputMode="decimal"
                  suffix={assetSymbol}
                  value={maxPerWindow}
                  onChange={(event) => setMaxPerWindow(event.target.value)}
                  error={errors.maxPerWindow}
                  hint={
                    !errors.maxPerWindow
                      ? `the ceiling on everything charged inside a ${windowLabel(escrow.windowSeconds)} window`
                      : undefined
                  }
                />

                {needsZeroConfirm ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-danger-20 bg-danger-10 p-3.5">
                    <p className="text-body-13 text-danger-700">
                      A limit of 0 does not mean unlimited — it refuses every paid call through
                      this escrow. If you want no ceiling, type a very large number instead of 0.
                    </p>
                    <Checkbox
                      label="I understand — set it to 0 anyway"
                      checked={confirmZero}
                      onChange={(event) => setConfirmZero(event.target.checked)}
                    />
                    {errors.confirmZero ? (
                      <p className="text-body-xs text-danger-700">{errors.confirmZero}</p>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  icon={<PenLine />}
                  loading={setLimits.isPending}
                  disabled={setLimits.isPending}
                >
                  Build the transaction
                </Button>

                {setLimits.isError ? (
                  <p className="text-body-13 text-danger-600">
                    {setLimits.error instanceof ApiError
                      ? `${setLimits.error.code} · ${setLimits.error.message}`
                      : "That request was refused."}
                  </p>
                ) : null}
              </form>
            </PanelBody>
          </Panel>

          {intent ? (
            <Panel>
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Sign to apply</PanelTitle>
                  <PanelDescription>
                    {relayedRequest
                      ? "we submit it and pay the fee — you sign, and that is all you do"
                      : "unsigned — the platform holds no key of yours"}
                  </PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="gap-3.5 p-5">
                <div className="flex items-start gap-2.5">
                  <Lock aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
                  <p className="text-body-13 text-02" data-testid="limits-payload-summary">
                    {unsignedPayloadSummary(intent.transaction)}{" "}
                    {relayedRequest
                      ? /*
                          This is the point of the whole relayed pair. On this
                          chain the buyer's brake is `msg.sender`-only, so a buyer
                          holding tokens and no native coin could not reach it at
                          all; the platform submits the call and pays for it, and
                          what binds the change to the buyer is the signature, not
                          who sent it. Saying "you need a fee" here would be false
                          in the one direction that strands somebody.
                        */
                        "We pay the network fee for this one — you need no ETH. What the platform can do is submit it or refuse to; it cannot change what you signed."
                      : "Your wallet signs and broadcasts this directly — the platform never sees a signed transaction of yours."}
                  </p>
                </div>

                {relayed ? (
                  <RelayedDoneNotice
                    testId="limits-relayed-done"
                    relayed={relayed}
                    title="Done — your new limits are on chain."
                    effect="Your balance was not touched: this writes two ceilings onto your escrow and moves no money."
                  />
                ) : signature ? (
                  <NoteBox tone="teal" icon={<ShieldCheck width={15} height={15} strokeWidth={1.5} />}>
                    Broadcast — signature {signature}. Your limits take effect as soon as the
                    network confirms this.
                  </NoteBox>
                ) : (
                  <Button
                    type="button"
                    icon={<PenLine />}
                    loading={broadcasting}
                    disabled={broadcasting}
                    onClick={() => void signAndSubmit()}
                  >
                    {relayedRequest ? "Sign in your wallet" : "Sign in your wallet and broadcast"}
                  </Button>
                )}

                {/*
                  A named refusal, with the one instruction that fits it. Kept
                  separate from `signError`: a wallet that would not sign and a
                  platform that would not relay are different failures, and the
                  second one has already consumed a signature.
                */}
                {refusal ? (
                  <RelayedRefusalNotice
                    testId="limits-relayed-refusal"
                    refusal={refusal}
                    title="Your limits were not changed"
                    onRebuild={rebuildRequest}
                  />
                ) : null}

                {signError ? (
                  <p role="alert" className="text-body-13 text-danger-600">
                    {signError}
                  </p>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}
        </>
      ) : null}

      <NoteBox tone="neutral" icon={<Info width={15} height={15} strokeWidth={1.5} />}>
        This screen is about your own escrow. For the balance, deposits and withdrawals, see{" "}
        <Link href="/funding/escrow" className="font-semibold text-primary-600 underline">
          Escrow →
        </Link>
        .
      </NoteBox>
    </div>
  );
}

/**
 * `useSearchParams()` opts a route out of static prerendering, and Next refuses
 * to build unless the component that reads it sits under a Suspense boundary.
 * The page has no server-rendered fallback worth drawing — every figure is
 * read from the chain through the API — so the boundary renders nothing and
 * exists only to mark the bail-out point. Same shape as
 * `funding/deposit/page.tsx`, for the same reason.
 */
export default function EscrowLimitsPage() {
  return (
    <React.Suspense fallback={null}>
      <EscrowLimitsPageContent />
    </React.Suspense>
  );
}
