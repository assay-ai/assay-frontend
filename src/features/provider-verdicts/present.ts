import type { StageStatus, VerdictStatus, VerificationStage } from "@/interfaces";

/**
 * A checked call's verdict as a chip a provider reads at a glance: passed,
 * failed, degraded — and grey "Not checked" for every not-applicable or
 * skipped case, which is never the provider's fault and never red.
 */

export type VerdictFilter = "all" | "failed" | "passed";

export function verdictFilterStatuses(filter: VerdictFilter): VerdictStatus[] | undefined {
  if (filter === "failed") return ["FAIL", "MISAPPLIED"];
  if (filter === "passed") return ["PASS", "EMPTY_CONFIRMED"];
  return undefined;
}

export interface VerdictChip {
  label: string;
  className: string;
  /** One line when there is no failing rule to show. */
  note: string;
}

export function verdictChip(status: VerdictStatus | null | undefined): VerdictChip {
  switch (status) {
    case "PASS":
      return { label: "Passed", className: "bg-success-10 text-success-700", note: "Passed every check." };
    case "EMPTY_CONFIRMED":
      return { label: "Passed", className: "bg-success-10 text-success-700", note: "Empty, and confirmed empty." };
    case "FAIL":
      return { label: "Failed", className: "bg-danger-10 text-danger-700", note: "Did not pass the check." };
    case "MISAPPLIED":
      return { label: "Check misapplied", className: "bg-03 text-02", note: "The check did not fit this call; not counted against you." };
    case "DEGRADED":
      return { label: "Degraded", className: "bg-warning-10 text-warning-700", note: "Partly checked." };
    case "EMPTY_UNVERIFIED":
      return { label: "Not checked", className: "bg-03 text-02", note: "Empty result that could not be confirmed." };
    default:
      return { label: "Not checked", className: "bg-03 text-02", note: "Not checked." };
  }
}


const STAGE_LABEL: Record<VerificationStage, string> = {
  SCHEMA: "Result has the right shape",
  DETERMINISTIC_RULES: "Result follows the tool's rules",
  CROSS_CHECK: "Result matches other sources",
  SEMANTIC: "Result makes sense for the request",
};

export function stageCheckLabel(stage: VerificationStage): string {
  return STAGE_LABEL[stage] ?? String(stage);
}

/** Pass green, fail red, everything not run grey. */
export function stageCheckTone(status: StageStatus): "ok" | "fail" | "warn" | "muted" {
  if (status === "PASSED") return "ok";
  if (status === "FAILED") return "fail";
  if (status === "MISAPPLIED") return "warn";
  return "muted";
}
