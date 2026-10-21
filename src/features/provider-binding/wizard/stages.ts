import type { StepperStep } from "@/components/patterns/stepper";

export type WizardStage = "tool" | "connect" | "live";

export const WIZARD_STAGES: { id: WizardStage; label: string }[] = [
  { id: "tool", label: "Tool" },
  { id: "connect", label: "Connect & test" },
  { id: "live", label: "Go live" },
];

export function isWizardStage(value: string | null | undefined): value is WizardStage {
  return value === "tool" || value === "connect" || value === "live";
}

/** The shared Stepper's steps: done ones can be revisited, the rest wait. */
export function wizardSteps(current: WizardStage, done: ReadonlySet<WizardStage>): StepperStep[] {
  return WIZARD_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: stage.id === current ? "current" : done.has(stage.id) ? "done" : "upcoming",
  }));
}

/**
 * Account setup (`/provider/setup`: You, Get paid, Your API) and the listing
 * wizard are two steppers on one road. Both say where the provider is on the
 * whole of it in one line: "Account 3/3 · Listing 1/3".
 */
export const ACCOUNT_STEP_COUNT = 3;

/** Setup's three steps done, from the registration's four onboarding steps (terms count with "You"). */
export function accountStepsDone(steps: readonly { key: string; status: string }[]): number {
  const done = (key: string) => steps.some((step) => step.key === key && step.status === "DONE");
  return [done("account") && done("terms"), done("payoutWallet"), done("endpoint")].filter(Boolean).length;
}

/** "Account 3/3 · Listing 1/3". `listing` is the wizard stage on screen, or null before the wizard. */
export function combinedProgress(accountDone: number, listing: WizardStage | null): string {
  const step = listing ? WIZARD_STAGES.findIndex((stage) => stage.id === listing) + 1 : 0;
  return `Account ${accountDone}/${ACCOUNT_STEP_COUNT} · Listing ${step}/${WIZARD_STAGES.length}`;
}

/**
 * The stage to show. An explicit, valid `?stage=` wins, then the draft's state; a stage that needs
 * something it has not got (a draft for Go live, a tool for Connect) falls back to picking a tool.
 * `waitingOnDraft` is true only while a draft named in the URL is still loading.
 */
export function resolveStage(input: {
  stageParam: string | null;
  draft: { status: string } | null;
  testPassed: boolean;
  hasTool: boolean;
  waitingOnDraft: boolean;
}): WizardStage {
  const { stageParam, draft, testPassed, hasTool, waitingOnDraft } = input;
  let stage: WizardStage;
  if (isWizardStage(stageParam)) stage = stageParam;
  else if (draft) stage = draft.status === "DRAFT" && !testPassed ? "connect" : "live";
  else stage = hasTool ? "connect" : "tool";
  if (stage === "live" && !draft) stage = hasTool ? "connect" : "tool";
  if (stage === "connect" && !hasTool && !waitingOnDraft) stage = "tool";
  return stage;
}
