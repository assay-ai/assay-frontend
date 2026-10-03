import type { BadgeVariant } from "@/components/ui/badge";
import { DASH, stampUtc } from "@/features/g34a/stats";
import type { Dispute, DisputeState } from "@/interfaces/provider-disputes";

/**
 * `disputes.state` → `Badge` variant.
 *
 * The polarity trap ("UPHELD means the opposite in two
 * tables"): `disputes.state` describes what happened to the **objection**,
 * so `UPHELD` here is a WIN for whoever filed it — success tone — and
 * `REJECTED` is a loss — danger tone. This is the opposite of what the same
 * words mean on a `slash_proposals` row, which this screen never renders
 * directly; only the general `Dispute` shape reaches this file.
 */
export function disputeBadgeVariant(state: DisputeState): BadgeVariant {
  switch (state) {
    case "OPEN":
      return "dispute-open";
    case "UNDER_REVIEW":
      return "dispute-under-review";
    case "UPHELD":
      return "dispute-upheld";
    case "PARTIALLY_UPHELD":
      return "dispute-partially-upheld";
    case "REJECTED":
      return "dispute-rejected";
    case "WITHDRAWN":
      return "dispute-withdrawn";
  }
}

/**
 * One sentence stating which way a resolved dispute cut, unambiguous about
 * direction on purpose — getting this backwards would be the worst defect
 * available here. `OPEN`/`UNDER_REVIEW` have no direction yet, so
 * this states only what is actually known.
 */
export function disputeOutcomeLine(dispute: Dispute): string {
  switch (dispute.state) {
    case "OPEN":
      return "Open — not yet reviewed.";
    case "UNDER_REVIEW":
      return "Under review — no decision yet.";
    case "UPHELD":
      return "Your objection was upheld: the original decision does not stand.";
    case "PARTIALLY_UPHELD":
      return "Your objection was partially upheld: part of the original decision was recalculated, not cancelled.";
    case "REJECTED":
      return "Your objection was rejected: the original decision stands.";
    case "WITHDRAWN":
      return "You withdrew this dispute.";
  }
}

/** The provider's own deadline line — the only clock every dispute can honestly show (see file header on the interface). */
export function providerDeadlineLine(dispute: Dispute): string {
  if (!dispute.acknowledgedAt) {
    return "Not yet acknowledged — the response clock has not started.";
  }
  if (!dispute.deadlineAt) return DASH;
  return `Response due ${stampUtc(dispute.deadlineAt)} UTC`;
}
