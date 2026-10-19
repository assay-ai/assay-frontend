"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { CAP_PRESETS, capsToForm, keyGroups, parseCaps } from "@/features/buyer-money/caps";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import { DEFAULT_DELEGATION_DAYS, parseDelegationForm, serverNowSeconds } from "@/features/delegation/delegation-form";
import { planSignatures, type AtomicCapPair } from "@/features/delegation/enable-paid";
import { submitRelayedDelegation } from "@/features/delegation/relayed-delegation";
import {
  hasTightenDelay,
  loweredDelayNote,
  loweredFullyAt,
  LOWERING_UNREAD_NOTE,
  lowersCaps,
} from "@/features/delegation/unsettled";
import { applyLimitsSubmitted } from "@/features/escrow/after-set-limits";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { createDelegateIntent, getEscrowUnsettled, submitDelegate } from "@/services/delegation.service";
import { createEscrowLimitsIntent } from "@/services/escrow.service";
import { cn } from "@/utils";
import { addressOfAccount } from "@/utils/chain";

import { CapsFields, type CapsValue } from "./caps-fields";
import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * "Let your agent pay": the agent's own spending limit (its on-chain
 * permission) in one drawer, raising the account ceiling first when it is
 * lower — at most two free signatures. One set of numbers applies to both, so
 * nobody has to understand two limit systems to get a first paid call through.
 * The ceiling step is skipped when the escrow already allows at least as much.
 * It opens on the Standard preset (or the ceiling, when that is lower), never
 * on the ceiling itself: an agent's limit is meant to sit under it.
 *
 * The key check is by eye: the key is shown in 4-character groups next to
 * what the agent's app showed, and a tick confirms they match. It keeps the
 * point of the old "type the last 4 characters" (you only authorise a key you
 * actually ran) without switching to a terminal to copy them.
 *
 * The two wallet steps are {@link agentPaySteps}, shared with the
 * `/agents/enable-paid` page.
 */
export interface LetAgentPaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  /** CAIP-10 of the agent's payment key (bound by the agent's app). */
  delegateAccount: string | null;
  /**
   * Renewing a permission that ends soon: the drawer opens on its current
   * limits (major units) and grants them again for the full period.
   */
  renew?: { perCall: string; perDay: string } | null;
}

export function KeyMatch({ account }: { account: string }) {
  const groups = keyGroups(account);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label-13 text-01">The agent&apos;s payment key</span>
      <div
        className="flex flex-wrap gap-1.5 rounded-lg border border-01 bg-02 p-3"
        aria-label={`Key ${groups.join(" ")}`}
        data-testid="key-groups"
      >
        {groups.map((group, i) => (
          <span
            key={i}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-mono-sm font-semibold",
              i % 2 === 0 ? "bg-primary-10 text-primary-700" : "bg-teal-10 text-teal-600",
            )}
          >
            {group}
          </span>
        ))}
      </div>
      <span className="text-body-xs text-03">Compare it with the payment key the agent&apos;s app showed.</span>
      <span className="text-body-xs text-03" data-testid="key-mismatch-help">
        They don&apos;t match? Don&apos;t sign. Someone else may hold this agent&apos;s credential: revoke it under
        Controls and connect the app again.
      </span>
    </div>
  );
}

/** Standard, unless the account ceiling is lower: then the ceiling. */
export function agentDefault(ceiling: { perCall: string; perDay: string } | null): { perCall: string; perDay: string } {
  const standard = CAP_PRESETS.find((p) => p.id === "standard")!;
  if (!ceiling) return { perCall: standard.perCall, perDay: standard.perDay };
  const lower = (a: string, b: string) => (Number(a) < Number(b) ? a : b);
  return { perCall: lower(ceiling.perCall, standard.perCall), perDay: lower(ceiling.perDay, standard.perDay) };
}

export function LetAgentPaySheet({ open, onOpenChange, agentName, delegateAccount, renew = null }: LetAgentPaySheetProps) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const escrow = money.escrow;
  const [value, setValue] = React.useState<CapsValue>({ perCall: "", perDay: "" });
  const [seeded, setSeeded] = React.useState(false);
  // The escrow caps as they were when the drawer opened. Frozen so the step
  // list cannot change under a running flow (a retry resumes by index).
  const [openingCaps, setOpeningCaps] = React.useState<{ perCall: string; perWindow: string } | null>(null);
  if (open && !seeded && !money.escrowQuery.isPending) {
    setSeeded(true);
    setValue(renew ?? agentDefault(capsToForm(escrow)));
    setOpeningCaps(
      escrow?.maxVoucherAmount && escrow.maxPerWindow
        ? { perCall: escrow.maxVoucherAmount.amount || "0", perWindow: escrow.maxPerWindow.amount || "0" }
        : null,
    );
  }
  if (!open && seeded) setSeeded(false);

  const parsed = parseCaps(value.perCall, value.perDay, money.decimals);
  const chosen =
    parsed.ok && parsed.perCall.atomic && parsed.perDay.atomic
      ? { maxVoucherAmount: parsed.perCall.atomic, maxPerWindow: parsed.perDay.atomic }
      : null;
  // The escrow caps cover the choice already: no first signature needed.
  const capsCover = Boolean(chosen && planSignatures(openingCaps, chosen).length === 1);
  // Read on every render on purpose: the expiry is "N days from when you sign" (BUG-D1-05).
  // eslint-disable-next-line react-hooks/purity
  const nowSeconds = serverNowSeconds(escrow?.serverTime, money.escrowQuery.dataUpdatedAt, Date.now());
  const until = new Date((nowSeconds + DEFAULT_DELEGATION_DAYS * 86_400) * 1000).toISOString();

  /*
    Renewing with lower numbers tightens the agent's grant. On an escrow with
    the tighten delay (assay-evm D-21) new payments get the lower limits at
    once and payments it already signed keep the old ones for that delay: say
    so, with the moment it is fully in effect. Without the delay, a lowering
    pauses the agent's payments for about 30 seconds while it settles.
  */
  const unsettled = useQuery({
    queryKey: ["escrow-unsettled", null],
    enabled: open && Boolean(renew) && Boolean(escrow?.exists),
    retry: 0,
    staleTime: 0,
    queryFn: () => getEscrowUnsettled(Date.now()),
  });
  const tightenDelay = unsettled.data?.tightenDelaySeconds;
  const renewParsed = renew ? parseCaps(renew.perCall, renew.perDay, money.decimals) : null;
  const currentGrant =
    renewParsed?.ok && renewParsed.perCall.atomic && renewParsed.perDay.atomic
      ? { maxVoucherAmount: renewParsed.perCall.atomic, maxPerWindow: renewParsed.perDay.atomic }
      : null;
  // Only once the delay is known: an unread delay must not promise a pause or a time.
  const lowering = unsettled.isSuccess && Boolean(currentGrant && chosen && lowersCaps(currentGrant, chosen));
  // The read failed: still say what a lowering can do, honestly (P2-11).
  const loweringUnread = unsettled.isError && Boolean(currentGrant && chosen && lowersCaps(currentGrant, chosen));
  const delayNote = loweredDelayNote(tightenDelay, currentGrant, chosen);
  const fullyAt = lowering ? loweredFullyAt(nowSeconds * 1000, tightenDelay) : null;

  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  const disabledReason = readOnly
    ? "Your account is blocked, so no agent can be allowed to pay now."
    : money.chainId && !servesPaidCalls(money.chainId)
      ? `${money.chainName ?? "This chain"} currently serves free calls only, so this agent makes free calls there and pays for none.`
      : !delegateAccount
        ? "The agent has no payment key yet. Paid calls are by invitation during testnet."
        : !escrow?.exists
        ? "Add funds first: your first deposit opens your escrow."
        : !chosen
          ? (parsed.perCall.error ?? parsed.perDay.error ?? "Choose its limits.")
          : walletBlocker;

  const steps = agentPaySteps({
    money,
    queryClient,
    agentName,
    delegateAccount,
    chosen,
    form: { perCall: value.perCall, perDay: value.perDay, days: DEFAULT_DELEGATION_DAYS },
    openingCaps,
    nowSeconds,
  });

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      chain={money.chain}
      title={renew ? `Renew ${agentName}'s permission to pay` : `Let ${agentName} pay`}
      description={
        renew
          ? `The same spending limits, valid for another ${DEFAULT_DELEGATION_DAYS} days from now. It still cannot withdraw, change your limits or let anyone else pay. Free, no gas.`
          : "Your agent pays for calls from your escrow, within these spending limits. It cannot withdraw, change your limits or let anyone else pay. Free, no gas."
      }
      steps={steps}
      label={capsCover ? "Sign to allow (free)" : "Sign to apply (free)"}
      resetKey={`${value.perCall}|${value.perDay}|${delegateAccount ?? ""}`}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={delegateAccount ? "These characters match the key the agent's app showed." : undefined}
      successTitle={`${agentName} can pay now`}
      successDescription={
        lowering && delayNote ? (
          <>
            Within these limits until <UtcTime value={until} dateOnly />. {delayNote}
          </>
        ) : lowering && !hasTightenDelay(tightenDelay) ? (
          <>
            Within these limits until <UtcTime value={until} dateOnly />. Its payments pause for about 30 seconds while
            the lower limits settle, then go on.
          </>
        ) : (
          <>
            Within these limits until <UtcTime value={until} dateOnly />. Next: its next paid call goes through; you
            can watch it under Activity.
          </>
        )
      }
      doneAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {delegateAccount ? <KeyMatch account={delegateAccount} /> : null}
      <CapsFields
        unit={money.symbol}
        value={value}
        onChange={setValue}
        parsed={parsed}
        idPrefix="agent-pay"
        label={`Spending limits for ${agentName}`}
        who="this agent"
      />
      <p className="text-body-xs text-03">
        Valid for {DEFAULT_DELEGATION_DAYS} days, until <UtcTime value={until} dateOnly />.{" "}
        {capsCover
          ? "One signature."
          : "Two signatures: your account ceiling is raised to fit, then the agent's spending limits."}
      </p>
      {lowering ? (
        <p className="rounded-lg bg-02 px-3 py-2 text-body-13 text-02" data-testid="agent-pay-lower-delay">
          {delayNote && fullyAt ? (
            <>
              Lower than now. {delayNote} Fully in effect at <UtcTime value={fullyAt} midSentence />.
            </>
          ) : (
            "Lower than now. Its payments pause for about 30 seconds while the lower limits settle."
          )}
        </p>
      ) : loweringUnread ? (
        <p className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="agent-pay-lower-unread">
          {LOWERING_UNREAD_NOTE}
        </p>
      ) : null}
    </WalletActionSheet>
  );
}

export interface AgentPayStepsInput {
  money: ReturnType<typeof useBuyerMoney>;
  queryClient: QueryClient;
  agentName: string;
  /** CAIP-10 of the key to authorise. */
  delegateAccount: string | null;
  /** The caps, atomic; null while the form is invalid (no step can run). */
  chosen: { maxVoucherAmount: string; maxPerWindow: string } | null;
  /** The same caps as typed (major units) and the grant's length in days. */
  form: { perCall: string; perDay: string; days: number };
  /** The escrow ceiling (atomic) when the flow opened, frozen so a retry resumes the same steps. */
  openingCaps: { perCall: string; perWindow: string } | null;
  nowSeconds: number;
  /**
   * The exact account ceiling (atomic) `SetLimits` signs, as the page shows it.
   * Left out (the sheet): each cap is raised to fit, never lowered.
   */
  ceiling?: { maxVoucherAmount: string; maxPerWindow: string };
  /**
   * The exact `validUntil` (unix seconds) the page shows, signed as it is. The
   * grant step refuses it when it is more than `maxDays` from this device's
   * clock. Left out (the sheet): `form.days` from `nowSeconds`.
   */
  expiry?: { validUntil: number; maxDays: number };
}

/**
 * "Let your agent pay" as wallet steps: `SetLimits` when the escrow ceiling is
 * below the caps (raised to fit, never lowered), then `AuthorizeDelegate`.
 * Both are relayed, and each is signed only if the request carries exactly
 * these values; the signer always shows Privy's confirmation (R-WEB-5).
 */
export function agentPaySteps(input: AgentPayStepsInput): WalletStep[] {
  const { money, queryClient, agentName, delegateAccount, chosen, form, openingCaps, nowSeconds, ceiling, expiry } = input;
  const escrow = money.escrow;
  const domain = () => {
    const contract = escrow?.escrowPda ? addressOfAccount(escrow.escrowPda) : "";
    if (!money.chainId || !contract) {
      throw new Error("The escrow could not be read, so there is nothing to check a signature request against.");
    }
    return { chainId: money.chainId.split(":")[1]!, verifyingContract: contract };
  };
  return [
    {
      id: "caps",
      label: "Raise your account ceiling to fit",
      cost: "free",
      skip: Boolean(chosen && planSignatures(openingCaps, chosen).length === 1),
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        // The page's shown ceiling; else raise the escrow caps to cover the agent, never lowering one set higher.
        const max = (a: string, b: string | undefined) => (b && BigInt(b) > BigInt(a) ? b : a);
        const escrowCaps = ceiling ?? {
          maxVoucherAmount: max(chosen!.maxVoucherAmount, openingCaps?.perCall),
          maxPerWindow: max(chosen!.maxPerWindow, openingCaps?.perWindow),
        };
        const intent = await createEscrowLimitsIntent(escrowCaps);
        report({ stage: "wallet" });
        // Signed only if the payload carries exactly these caps.
        const result = await runEscrowAction(intent, signer, { kind: "SET_LIMITS", ...escrowCaps });
        await applyLimitsSubmitted(queryClient, null, escrowCaps, result.kind === "relayed" ? result.relayed.escrow : null);
        const hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
    {
      id: "grant",
      label: `Let ${agentName} pay`,
      cost: "free",
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        const caps = {
          maxVoucherAmount: { amount: chosen!.maxVoucherAmount, asset: "", decimals: money.decimals },
          maxPerWindow: { amount: chosen!.maxPerWindow, asset: "", decimals: money.decimals },
        };
        if (expiry) {
          const localNow = Math.floor(Date.now() / 1000);
          if (!(expiry.validUntil <= localNow + expiry.maxDays * 86_400)) {
            throw new Error(`The expiry is more than ${expiry.maxDays} days away. Nothing was signed; reload the page.`);
          }
        }
        const parsed = parseDelegationForm(
          {
            maxVoucherAmount: form.perCall,
            maxPerWindow: form.perDay,
            validDays: String(form.days),
            keepExpiry: expiry !== undefined,
          },
          caps,
          addressOfAccount(delegateAccount!),
          expiry ? Math.floor(Date.now() / 1000) : nowSeconds,
          expiry?.validUntil,
        );
        if (!parsed.ok) throw new Error(Object.values(parsed.errors)[0] ?? "These limits cannot be used.");
        const intent = await createDelegateIntent(parsed.body);
        report({ stage: "wallet" });
        const relayed = await submitRelayedDelegation(
          intent,
          signer,
          { ...parsed.body, delegate: delegateAccount!, domain: domain() },
          submitDelegate,
        );
        void queryClient.invalidateQueries({ queryKey: ["escrow-delegates"] });
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, relayed.transactionHash) : undefined };
      },
    },
  ];
}

/** The enable-paid page's input: `ceiling` and `expiry` are required, so leaving one out does not compile. */
export interface EnablePaidStepsInput
  extends Omit<AgentPayStepsInput, "chosen" | "ceiling" | "expiry" | "nowSeconds" | "form"> {
  /** `enablePaidPlan(...).ceiling`: the caps the page shows. */
  ceiling: AtomicCapPair;
  /** `enablePaidPlan(...).expiry`: the `validUntil` the page shows. */
  expiry: { validUntil: number; maxDays: number };
  /** The form as typed (major units), for the request's own checks. */
  form: { perCall: string; perDay: string; days: number };
}

/**
 * The enable-paid page's wallet steps: `SetLimits` with exactly the shown
 * ceiling, then `AuthorizeDelegate` with exactly the shown caps and expiry.
 * The grant's caps are the ceiling's values; nothing comes from the API.
 */
export function enablePaidSteps(input: EnablePaidStepsInput): WalletStep[] {
  return agentPaySteps({
    ...input,
    chosen: input.ceiling,
    ceiling: input.ceiling,
    expiry: input.expiry,
    nowSeconds: input.expiry.validUntil - input.form.days * 86_400,
  });
}
