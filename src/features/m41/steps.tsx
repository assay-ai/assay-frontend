"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import {
  CircleCheck,
  CircleX,
  Info,
  PenLine,
  Plug,
  ShieldAlert,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import type {
  ConnectivityCheckResult,
  OnboardingStepStatus,
  ProviderPayoutAccount,
} from "@/interfaces";
import { cn } from "@/utils";
import { isEvmChain } from "@/libs/chains/registry";
import { chainLabel } from "@/utils/chain";

import { termValue } from "./terms";
import type { ProviderSetup } from "./use-setup";

/**
 * The pieces provider setup and provider registration share.
 *
 * Both designs draw the account step and the payout-wallet step; only the setup design
 * draws the endpoint and terms steps. Everything below is built from the design
 * the copy belongs to — where the two designs word the same field differently
 * (they do, on all three contact hints), the caller passes its own copy rather
 * than one of them being picked as "the" wording.
 */

/* ---------------------------------------------------------------- status pill */

const PILL: Record<OnboardingStepStatus, { label: string; box: string; dot: string | null }> = {
  DONE: { label: "DONE", box: "bg-success-10 text-success-700", dot: "bg-success-500" },
  IN_PROGRESS: { label: "IN PROGRESS", box: "bg-primary-10 text-primary-700", dot: "bg-primary-500" },
  NOT_STARTED: { label: "NOT STARTED", box: "bg-03 text-02", dot: null },
};

/**
 * The step badge from the design heads.
 *
 * NOT `@/components/ui/badge` — that component's vocabulary is closed on
 * purpose (design-system rule: no caller-supplied text, so a raw verdict can
 * never be handed through) and it has no onboarding-step variants. Adding
 * three would mean adding the `label` prop the component exists to withhold,
 * so the shape is reproduced here instead. See the report.
 */
export function StepStatusPill({ status }: { status: OnboardingStepStatus }) {
  const pill = PILL[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold",
        pill.box,
      )}
    >
      {pill.dot ? (
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", pill.dot)} />
      ) : null}
      {pill.label}
    </span>
  );
}

/* ------------------------------------------------------------------ step card */

export interface StepCardProps {
  /** Verbatim, including the numeral and the middot: "1 · Account". */
  title: string;
  caption: string;
  status?: OnboardingStepStatus;
  children: React.ReactNode;
}

/**
 * One card from the design's left column: `$bg-01` body,
 * `$radius-xl`, 1px `$border-01`, over a `$bg-02` head with a bottom hairline.
 * `Panel` is that shape apart from the head fill and the shadow — the design
 * draws neither a `$bg-01` head nor any shadow on these cards.
 */
export function StepCard({ title, caption, status, children }: StepCardProps) {
  return (
    <Panel className="shadow-none">
      <PanelHeader className="bg-02">
        <PanelTitles>
          <PanelTitle>{title}</PanelTitle>
          <PanelDescription className="whitespace-normal">{caption}</PanelDescription>
        </PanelTitles>
        {status ? <StepStatusPill status={status} /> : null}
      </PanelHeader>
      <PanelBody className="gap-3.5 p-5">{children}</PanelBody>
    </Panel>
  );
}

/* ------------------------------------------------------- step 1 · the account */

export interface AccountCopy {
  technicalHint: string;
  ownerHint: string;
  timezoneHint: string;
}

/**
 * The four account fields.
 *
 * **The design draws one field per contact and the API needs two.** `Technical
 * contact` and `Owner contact` are single fields holding an email address in
 * both `pM65r` and `lWSNd`, but `ProviderContactInputDto` requires `name` AND
 * `email` and rejects a body without the name. So each contact renders as the
 * design's field plus a second one for the person; the added label, placeholder
 * and hint are the DTO's own words, not new copy. See the report.
 *
 * `fontFamily` is overridden to `$font-sans` on all four of these fields in
 * both designs — they are the only fields on either screen that are
 * not mono.
 */
export function AccountFields({ setup, copy }: { setup: ProviderSetup; copy: AccountCopy }) {
  const { account, setAccountField, accountErrors, touch } = setup;
  const sans = "font-sans text-body-sm";

  return (
    <>
      <Field
        label="Legal or trading name"
        className={sans}
        placeholder="Acme Maritime AS"
        value={account.legalName}
        error={accountErrors.legalName}
        onChange={(e) => setAccountField("legalName", e.target.value)}
        onBlur={() => touch("legalName")}
      />

      <Field
        label="Technical contact"
        className={sans}
        placeholder="alex@acme-maritime.example"
        hint={copy.technicalHint}
        value={account.technicalEmail}
        error={accountErrors.technicalEmail}
        onChange={(e) => setAccountField("technicalEmail", e.target.value)}
        onBlur={() => touch("technicalEmail")}
      />
      <Field
        label="Technical contact name"
        className={sans}
        placeholder="Alex Example"
        hint="The human. Not a role alias."
        value={account.technicalName}
        error={accountErrors.technicalName}
        onChange={(e) => setAccountField("technicalName", e.target.value)}
        onBlur={() => touch("technicalName")}
      />

      <Field
        label="Owner contact"
        className={sans}
        placeholder="founder@acme-maritime.example"
        hint={copy.ownerHint}
        value={account.ownerEmail}
        error={accountErrors.ownerEmail}
        onChange={(e) => setAccountField("ownerEmail", e.target.value)}
        onBlur={() => touch("ownerEmail")}
      />
      <Field
        label="Owner contact name"
        className={sans}
        placeholder="Ada Okonkwo"
        hint="The human. Not a role alias."
        value={account.ownerName}
        error={accountErrors.ownerName}
        onChange={(e) => setAccountField("ownerName", e.target.value)}
        onBlur={() => touch("ownerName")}
      />

      <Field
        label="Timezone"
        className={sans}
        placeholder="Europe/Oslo"
        hint={copy.timezoneHint}
        value={account.timezone}
        error={accountErrors.timezone}
        onChange={(e) => setAccountField("timezone", e.target.value)}
        onBlur={() => touch("timezone")}
      />
    </>
  );
}

/* -------------------------------------------------- step 2 · the payout wallet */

/**
 * The address field and the signing button, shared by both designs. The notes
 * differ between them and stay with the page that draws them.
 */
export function PayoutWalletFields({
  setup,
  addressPlaceholder,
  addressHint,
  buttonLabel,
  buttonClassName,
}: {
  setup: ProviderSetup;
  addressPlaceholder: string;
  /** Verbatim — the two designs word this differently. */
  addressHint: string;
  buttonLabel: string;
  buttonClassName?: string;
}) {
  const {
    address,
    setAddress,
    wallet,
    walletDetail,
    walletBlockedBy,
    walletStructuralBlock,
    walletAttempted,
    signing,
    signAndProve,
    payoutAccounts,
    pendingProvedAccountId,
    pendingProvedIsNewChain,
    chainId,
  } = setup;

  /*
    The designs were drawn when every payout was on Solana, and this label said
    "Solana address" on eip155:46630 too. The chain comes from the session's
    agent row (`setup.chainId`); until it answers, the label names no chain
    rather than guessing one.
  */
  const evm = chainId !== null && isEvmChain(chainId);
  const label =
    chainId === null
      ? "Wallet address"
      : `${evm ? "EVM" : "Solana"} address · ${chainLabel(chainId)}`;

  return (
    <>
      <Field
        label={label}
        placeholder={evm ? "0x…" : addressPlaceholder}
        hint={addressHint}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        aria-label={label}
      />

      <Button
        variant="secondary"
        className={cn("w-full justify-center px-3.5 py-3", buttonClassName)}
        icon={<PenLine />}
        loading={signing}
        onClick={signAndProve}
      >
        {buttonLabel}
      </Button>

      {/*
        The button is not disabled. A control that refuses silently teaches
        nothing; this one is pressable and answers with the reason.
      */}
      {walletStructuralBlock || walletAttempted ? (
        walletBlockedBy ? <Refusal>{walletBlockedBy}</Refusal> : null
      ) : null}

      {payoutAccounts.map((account) => (
        <ProvedChain key={account.chainId} account={account} />
      ))}

      {/*
        An address this session proved that the cached read does not carry yet.
        It is drawn as a tick ONLY when it enrolled a chain that was not already
        on the list — that is the branch where the platform inserts the row, and
        it inserts it payable. A re-proof on a chain already listed changes the
        address and nothing else: the row above keeps whatever status it has,
        because proving deliberately cannot lift a suspension.
      */}
      {pendingProvedAccountId ? (
        pendingProvedIsNewChain ? (
          <Outcome tone="teal" icon={<CircleCheck />}>
            Proved. Payouts settle to{" "}
            <span className="font-mono text-mono-13 break-all">{pendingProvedAccountId}</span>.
          </Outcome>
        ) : (
          <Outcome tone="neutral" icon={<Info />}>
            Signed and accepted — payouts on this chain settle to{" "}
            <span className="font-mono text-mono-13 break-all">{pendingProvedAccountId}</span>.
            Proving an address does not change an enrolment&apos;s status, so whatever is written
            above about this chain still applies.
          </Outcome>
        )
      ) : null}

      {wallet === "no-wallet" ? (
        <Outcome tone="warning" icon={<TriangleAlert />}>
          Nothing was signed — no wallet is connected in this browser, so no address was claimed
          and no nonce was issued.
          <ConnectWalletAction />
        </Outcome>
      ) : null}
      {wallet === "address-not-connected" ? (
        <Outcome tone="warning" icon={<TriangleAlert />}>
          Nothing was signed — no connected wallet holds{" "}
          <span className="font-mono text-mono-13 break-all">{address.trim()}</span>. Connect the
          wallet that holds it, or correct the address above. No nonce was issued.
          <ConnectWalletAction />
        </Outcome>
      ) : null}
      {wallet === "declined" ? (
        <Outcome tone="warning" icon={<TriangleAlert />}>
          Nothing was signed — the wallet prompt was closed or declined, so no address was claimed.
        </Outcome>
      ) : null}
      {wallet === "rejected" && walletDetail ? (
        <Outcome tone="danger" icon={<CircleX />}>
          {walletDetail}
        </Outcome>
      ) : null}
    </>
  );
}

/**
 * One proved chain, and whether it is actually payable.
 *
 * **A proved address is not a tick.** The backend had exactly this bug: the
 * step read "Payout wallet ✓" on any enrolment status, so a provider whose only
 * enrolment was `SUSPENDED` was reassured by their own console while every paid
 * binding they owned was refused. The address answers "where", the status
 * answers "whether", and the second is the half that decides whether money
 * arrives — so `SUSPENDED` and `UNBONDING` draw as a warning that says the
 * money is not moving, not as a green line with a caveat.
 *
 * The chain is named on every row, including the first. With one enabled chain
 * that is one line and reads as it always did; with two it is the only thing
 * saying which address is true where.
 */
function ProvedChain({ account }: { account: ProviderPayoutAccount }) {
  const address = <span className="font-mono text-mono-13 break-all">{account.accountId}</span>;
  const chain = <span className="font-mono text-mono-13">{chainLabel(account.chainId)}</span>;

  if (account.status === "ACTIVE") {
    return (
      <Outcome tone="teal" icon={<CircleCheck />}>
        Proved on {chain}. Payouts settle to {address}.
      </Outcome>
    );
  }

  return (
    <Outcome tone="warning" icon={<ShieldAlert />}>
      Proved on {chain}, and settling to {address} — but this chain&apos;s enrolment is{" "}
      <span className="font-mono text-mono-13">{account.status}</span>, so nothing is paid out on
      it and every paid binding offered on it is refused. Re-signing will not change that:{" "}
      {account.status === "UNBONDING"
        ? "an unbonding enrolment is on its way out and is not taken back by proving an address again."
        : "a suspension is lifted by the platform, never by the provider."}
    </Outcome>
  );
}

/**
 * The product's ONLY route from "wallet installed" to "wallet connected".
 *
 * `useWallets()` returns *connected* wallets, so neither `no-wallet` nor
 * `address-not-connected` can be escaped from inside the signing surface: a
 * provider whose payout address lives in Phantom, Solflare or an org cold
 * wallet reads "connect the wallet that holds it" and has nowhere to go. The
 * banner is where that sentence is, so the control belongs beside it —
 * `useSigner()` stays pure, selecting a wallet and never connecting one.
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
        // Called through an arrow: `connectWallet` also accepts a MouseEvent
        // in this position, and handing it the event instead of the options
        // silently drops the chain filter.
        onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
      >
        Connect a wallet
      </Button>
    </span>
  );
}

/* ------------------------------------------------------- step 3 · the endpoint */

export function EndpointFields({ setup }: { setup: ProviderSetup }) {
  const {
    endpoint,
    setEndpoint,
    probe,
    check,
    declare,
    checking,
    declaring,
    checkError,
    endpointBlockedBy,
    endpointAttempted,
    canWriteEndpoint,
    savedEndpoint,
  } = setup;

  const reachable = probe?.outcome === "REACHABLE" && probe.endpoint === endpoint.trim();
  const saved = Boolean(endpoint.trim() && savedEndpoint === endpoint.trim());

  return (
    <>
      <Field
        label="Your HTTPS endpoint"
        placeholder="https://api.acme-maritime.example/v2/ais"
        hint="Any shape. JSON in, JSON out. We map it onto the tool schema — you change nothing."
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
      />

      <Button
        variant="secondary"
        className="w-full justify-center px-3.5 py-3"
        icon={<Plug />}
        loading={checking}
        onClick={check}
      >
        Check we can reach it
      </Button>

      {endpointAttempted && endpointBlockedBy ? <Refusal>{endpointBlockedBy}</Refusal> : null}

      {checkError ? (
        <Outcome tone="danger" icon={<CircleX />}>
          {endpointErrorMessage(checkError)}
        </Outcome>
      ) : null}

      {probe ? <ProbeOutcome probe={probe} /> : null}

      {/*
        Saving is a second, separate act. The probe writes nothing — it is a
        201 with a result in it — and `PUT /providers/me/endpoint` re-runs the
        check server-side and refuses to write anything that is not REACHABLE.
      */}
      {reachable && !saved ? (
        <Button
          className="w-full justify-center px-3.5 py-3"
          loading={declaring}
          // Not while a re-check runs: saving re-runs the check server-side,
          // and one provider gets one connectivity check at a time.
          disabled={!canWriteEndpoint || checking}
          onClick={declare}
        >
          Save this endpoint
        </Button>
      ) : null}
      {reachable && !saved && !canWriteEndpoint ? (
        <Refusal>
          Finish step 1 first — an endpoint is stored on a provider record, and there is not one
          yet.
        </Refusal>
      ) : null}
      {saved ? (
        <Outcome tone="teal" icon={<CircleCheck />}>
          Saved. This is the endpoint we will call.
        </Outcome>
      ) : null}
    </>
  );
}

/**
 * `checkError` covers two calls that fail for different reasons, and a raw
 * `error.message` reads as the same sentence for both. `PROVIDER_NOT_FOUND`
 * here is not the pre-flight case above — that one is caught before the click
 * by `canWriteEndpoint` and never reaches this mutation. Reaching it means
 * the record was there when the page loaded and is not now: another tab, a
 * deletion, a session pointed at a different org. A `status` of `0` never
 * reached our API at all — that is a local connectivity problem, not
 * anything the provider's own endpoint did.
 */
function endpointErrorMessage(error: NonNullable<ProviderSetup["checkError"]>): string {
  if (error.code === "PROVIDER_NOT_FOUND") {
    return "Your provider record is gone — it was there when this page loaded and isn't now. Reload the page before trying again.";
  }
  if (error.status === 0) {
    return "We couldn't reach our own server to run this. Check your connection and try again.";
  }
  return error.message;
}

/** What a probe concluded, in the vocabulary the outcome actually distinguishes. */
function ProbeOutcome({ probe }: { probe: ConnectivityCheckResult }) {
  if (probe.outcome === "REACHABLE") {
    return (
      <Outcome tone="teal" icon={<CircleCheck />}>
        We reached it — HTTP {probe.statusCode}
        {probe.latencyMs === null ? "" : ` in ${probe.latencyMs} ms`}. Any answer counts, including
        a 401: we are checking that something is listening, not that it likes us.
      </Outcome>
    );
  }

  if (probe.outcome === "BLOCKED") {
    return (
      <Outcome tone="danger" icon={<ShieldAlert />}>
        <span className="font-semibold">We refused to dial this address.</span> It is not a failure
        to reach you — we never sent a packet. Private, loopback, link-local and cloud-metadata
        addresses are blocked outright, and so is any scheme other than <code>https:</code>, because
        an endpoint we can be pointed at from the outside must not be able to reach inside our own
        network. Give a publicly resolvable <code>https://</code> address.
        {probe.detail ? <span className="mt-1.5 block text-body-xs opacity-80">{probe.detail}</span> : null}
      </Outcome>
    );
  }

  return (
    <Outcome tone="warning" icon={<TriangleAlert />}>
      <span className="font-semibold">We could not reach it.</span> Nothing answered from our egress
      addresses. Nothing has been saved.
      {probe.detail ? <span className="mt-1.5 block text-body-xs opacity-80">{probe.detail}</span> : null}
    </Outcome>
  );
}

/* ---------------------------------------------------------- step 4 · the terms */

/**
 * The commercial terms, printed on the page.
 *
 * This table is the screen's one non-negotiable: not a link, not a modal, not
 * a checkbox standing in for text nobody sees. Every row is the server's own
 * copy where the server publishes one — key, value and caption all come off
 * `terms.commercialTerms`, and the sentence beside the checkbox is
 * `terms.acceptanceLine`, already assembled, never rebuilt here.
 */
export function TermsBody({ setup }: { setup: ProviderSetup }) {
  const { terms, termsFromDesign, accepted, setAccepted, registered } = setup;

  return (
    <>
      <div className="flex w-full flex-col">
        {terms.commercialTerms.map((term) => (
          <div
            key={term.key}
            className="flex w-full items-center gap-3.5 border-t border-01 py-2.5"
          >
            <span className="w-60 shrink-0 text-body-13 text-01">{term.label}</span>
            <span className="w-[180px] shrink-0 font-mono text-mono-13 font-semibold text-01">
              {termValue(term)}
            </span>
            <span className="min-w-0 flex-1 text-body-xs text-03">{term.caption}</span>
          </div>
        ))}
      </div>

      <Checkbox
        checked={accepted}
        disabled={registered}
        onChange={(e) => setAccepted(e.target.checked)}
        label={terms.acceptanceLine}
      />

      {termsFromDesign ? (
        <Outcome tone="neutral" icon={<Info />}>
          These are the published terms as this console has them. The platform only serves its own
          copy to an organisation that has already registered, so if the versions have moved since,
          registration will refuse and name both — nothing is accepted on your behalf that you were
          not shown.
        </Outcome>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- primitives */

/**
 * A refusal: why a control will not act. Never a colour on its own — the
 * sentence is the whole point, and it names what to do.
 */
export function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="text-body-xs text-03">
      {children}
    </p>
  );
}

type Tone = "neutral" | "teal" | "warning" | "danger" | "primary";

const TONE_SURFACE: Record<Tone, string> = {
  neutral: "bg-02 border-01",
  teal: "bg-teal-10 border-teal-20",
  warning: "bg-warning-10 border-warning-20",
  danger: "bg-danger-10 border-danger-20",
  primary: "bg-primary-10 border-primary-20",
};
const TONE_ICON: Record<Tone, string> = {
  neutral: "text-03",
  teal: "text-teal-600",
  warning: "text-warning-600",
  danger: "text-danger-600",
  primary: "text-primary-600",
};
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-02",
  teal: "text-02",
  warning: "text-warning-700",
  danger: "text-danger-700",
  primary: "text-primary-700",
};

/**
 * The designs' Note shape — 15px icon,
 * 13px paragraph, `$radius-lg`, 1px border, padding 14.
 *
 * A local copy rather than `@/features/g30/ui`'s `NoteBox`: that one has no
 * `danger` tone, and a blocked egress address is the one outcome on this
 * screen that has to read as a refusal rather than a caution.
 */
export function Outcome({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex w-full items-start gap-2.5 rounded-lg border p-3.5", TONE_SURFACE[tone])}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-[15px] shrink-0 items-center justify-center [&_svg]:size-[15px]",
          TONE_ICON[tone],
        )}
      >
        {icon}
      </span>
      <div className={cn("min-w-0 flex-1 text-body-13", TONE_TEXT[tone])}>{children}</div>
    </div>
  );
}
