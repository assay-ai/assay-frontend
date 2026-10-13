import { count, percent } from "@/features/g34a/stats";
import type { SlaWindowPosition } from "@/interfaces";

type StandingInput = Pick<
  SlaWindowPosition,
  | "state"
  | "slashable"
  | "projectedBreach"
  | "verifiedCalls"
  | "minVerifiedCalls"
  | "projectedFailureRate"
  | "toleranceAtClose"
  | "effectiveThresholdAtClose"
  | "projectedSampleAtClose"
  | "declaredFailureRate"
>;

export interface WindowStanding {
  label: string;
  tone: "primary" | "success" | "danger";
  sentence: string;
  projection: string;
}

/**
 * What an OPEN window's banner says. `state` and `slashable` are independent
 * on the wire (a thin window can project a breach), so the banner reads both:
 * below the sample gate it is never "slashable" and never red, whatever the
 * rate of a handful of calls looks like (BUG-R3-J-05).
 */
export function openWindowStanding(position: StandingInput): WindowStanding {
  const threshold = `effective threshold ${percent(position.effectiveThresholdAtClose, 1)} at ${count(
    position.projectedSampleAtClose
  )} calls (declared ${percent(position.declaredFailureRate, 1)} + ${percent(
    position.toleranceAtClose,
    1
  )} tolerance)`;
  const rate = `current rate ${percent(position.projectedFailureRate, 1)}, held to close`;

  if (!position.slashable) {
    return {
      label: "NOT YET SLASHABLE",
      tone: "primary",
      sentence: `${count(position.verifiedCalls)} of ${count(
        position.minVerifiedCalls
      )} verified calls carry a quality verdict. Below the gate, this window cannot be slashed at all — whatever the observed rate looks like.${
        position.projectedBreach
          ? " The rate so far is above the threshold, but it is too few calls to judge."
          : ""
      }`,
      projection: `${rate} · ${threshold} → too few calls to judge`,
    };
  }

  const breach = position.state === "PROJECTED_BREACH";
  return {
    label: breach ? "SLASHABLE · PROJECTED BREACH" : "SLASHABLE · WITHIN SLA",
    tone: breach ? "danger" : "success",
    sentence: breach
      ? "This window has reached the sample gate and, held to close, the current rate would breach the effective threshold."
      : "This window has reached the sample gate and is within its effective threshold.",
    projection: `${rate} · ${threshold} → breach ${position.projectedBreach ? "likely" : "unlikely"}`,
  };
}
