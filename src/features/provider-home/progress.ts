import type { BindingStatus, PricingMode } from "@/interfaces";
import { routes } from "@/libs/routes";

/**
 * "Get listed": the six steps from a new account to a live tool, each derived
 * from data the console already reads — never ticked by a click.
 *
 *   Account   GET /providers/me/registration (404 = not yet)
 *   Wallet    registration.payoutAccounts has an ACTIVE one
 *   First tool  any binding exists
 *   Test      a binding went live before, or the draft's publish check says the test passed
 *   Stake     only when a listing charges: the stake covers what paid listings need
 *   Live      any binding is ACTIVE
 */

export type ListingStepId = "account" | "wallet" | "tool" | "test" | "stake" | "live";
export type ListingStepState = "done" | "current" | "todo" | "blocked";

export interface ListingStep {
  id: ListingStepId;
  title: string;
  description: string;
  state: ListingStepState;
  optional?: boolean;
  blockedReason?: string;
  /** Where to do it. Absent for the stake step, which opens the Stake sheet in place. */
  href?: string;
  actionLabel: string;
}

export interface ListingProgressInput {
  /** null = no registration (404); undefined = still loading. */
  registration: { termsAccepted: boolean; payoutWallet: boolean; endpoint: string | null } | null | undefined;
  bindings: { id: string; status: BindingStatus; pricingMode: PricingMode }[] | undefined;
  /** The publish check of the newest draft: did its test pass? undefined = unknown. */
  draftTestPassed: boolean | undefined;
  /** From useStakeStatus: null when it cannot tell. */
  stakeEnough: boolean | null;
}

export interface ListingProgress {
  loading: boolean;
  steps: ListingStep[];
  /** True once a tool is live: the checklist leaves Home and the header. */
  live: boolean;
  /** The draft the wizard should resume, if any. */
  draftId: string | null;
}

export function listingProgress(input: ListingProgressInput): ListingProgress {
  const loading = input.registration === undefined || input.bindings === undefined;
  const registration = input.registration ?? null;
  const bindings = input.bindings ?? [];
  const draft = [...bindings].reverse().find((binding) => binding.status === "DRAFT") ?? null;
  const live = bindings.some((binding) => binding.status === "ACTIVE");
  const everPublished = bindings.some((binding) => binding.status !== "DRAFT");
  const charges = bindings.some((binding) => binding.pricingMode !== "FREE");

  const accountDone = registration !== null && registration.termsAccepted;
  const walletDone = registration !== null && registration.payoutWallet;
  const toolDone = bindings.length > 0;
  const testDone = everPublished || input.draftTestPassed === true;
  const stakeDone = charges ? input.stakeEnough === true : false;

  const done: Record<ListingStepId, boolean> = {
    account: accountDone,
    wallet: walletDone,
    tool: toolDone,
    test: testDone,
    stake: stakeDone,
    live,
  };

  const wizardForDraft = draft ? routes.bindingWizard(draft.id, "connect") : routes.bindingWizard();
  const base: Omit<ListingStep, "state">[] = [
    {
      id: "account",
      title: "Create your provider account",
      description: "Your name, a contact email and the terms. About a minute.",
      href: "/provider/setup",
      actionLabel: registration ? "Finish account" : "Start",
    },
    {
      id: "wallet",
      title: "Add the wallet you get paid in",
      description: "Connect it and sign a message (free). Buyers' payments land there.",
      href: "/provider/setup?step=wallet",
      actionLabel: "Add wallet",
    },
    {
      id: "tool",
      title: "List your first tool",
      description: "Pick the tool your API answers and give us your API's URL.",
      href: routes.bindingWizard(),
      actionLabel: "List a tool",
    },
    {
      id: "test",
      title: "Run a test call",
      description: "We call your API once and check the answer, so buyers never see a broken tool.",
      href: wizardForDraft,
      actionLabel: "Run the test",
    },
    {
      id: "stake",
      title: "Add stake (paid tools only)",
      description: charges
        ? "A paid tool needs stake: it backs your promised failure rate. You get it back when you leave."
        : "Only needed if you charge per call. Free tools go live without it.",
      optional: !charges,
      actionLabel: "Add stake",
    },
    {
      id: "live",
      title: "Go live",
      description: "Publish, and buyers' agents can call your tool.",
      href: draft ? routes.bindingWizard(draft.id, "live") : routes.bindingWizard(),
      actionLabel: "Go live",
    },
  ];

  // Prerequisites: a step cannot start before these are done.
  const needs: Partial<Record<ListingStepId, { step: ListingStepId; reason: string }[]>> = {
    wallet: [{ step: "account", reason: "Create your account first." }],
    tool: [{ step: "account", reason: "Create your account first." }],
    test: [{ step: "tool", reason: "List a tool first." }],
    stake: [{ step: "wallet", reason: "Add your wallet first." }],
    live: [
      { step: "test", reason: "Pass a test call first." },
      { step: "wallet", reason: "Add your wallet first." },
    ],
  };

  let currentGiven = false;
  const steps: ListingStep[] = base.map((step) => {
    if (done[step.id]) return { ...step, state: "done" as const };
    const missing = (needs[step.id] ?? []).find((need) => !done[need.step]);
    if (step.id === "live" && charges && !stakeDone) {
      return { ...step, state: "blocked" as const, blockedReason: "Add stake first: your tool charges per call." };
    }
    if (missing) return { ...step, state: "blocked" as const, blockedReason: missing.reason };
    if (step.optional) return { ...step, state: "todo" as const };
    if (!currentGiven) {
      currentGiven = true;
      return { ...step, state: "current" as const };
    }
    return { ...step, state: "todo" as const };
  });

  return { loading, steps, live, draftId: draft?.id ?? null };
}
