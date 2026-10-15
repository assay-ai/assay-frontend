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
