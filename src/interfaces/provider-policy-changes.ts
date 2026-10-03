/**
 * `GET /providers/me/policy-changes` (the policy change notice).
 *
 * Source: assay-backend `src/modules/provider/dto/provider-policy-changes.dto.ts`
 * and assay-backend `src/modules/provider/services/provider-policy-changes.service.ts`.
 *
 * This is the MVP notice slice only. Everything past it is a later phase and
 * none of it has a producer here:
 * divergence computed against this provider's own traffic ("14 of your last
 * 1,000 verified calls change verdict"), the objection form, running the
 * golden set, auto-pause on version change. Do not build UI for any of those
 * against this response — there is nothing on the wire to back it.
 *
 * The response is a bare array, not cursor-paginated: it is bounded by how
 * many distinct tools this provider has bound (small by construction), the
 * same shape `GET /operator/policies` uses.
 */

/** One row: one tool this provider has bound, with a `SHADOW` version pending on it. */
export interface PolicyChange {
  /** The catalogue tool id this provider's binding(s) implement. */
  toolId: string;
  /** The pending (SHADOW) version's own `policy_id`. */
  policyId: string;
  /** The pending version number. */
  pendingVersion: number;
  /** Always `SHADOW` at this MVP slice. */
  pendingLifecycle: "DRAFT" | "SHADOW" | "ACTIVE" | "WITHDRAWN" | "ARCHIVED";
  /** `policy_id` of the version currently `ACTIVE` for this tool, or `null` if none has ever been promoted. */
  inForcePolicyId: string | null;
  /** The version number currently `ACTIVE` (enforcing, economic) for this tool, or `null`. */
  inForceVersion: number | null;
  /**
   * Always `null`. `verification_policies` has no column recording when a
   * `SHADOW` version is scheduled to take effect — promotion is an immediate
   * operator action, not a scheduled one. Render the absence; never derive a
   * date from another field (e.g. the policy's `createdAt`).
   */
  effectiveDate: string | null;
  /** This provider's own bindings on this tool — every status, not only `ACTIVE`. */
  bindings: PolicyChangeBinding[];
  /**
   * Structural diff of `decision_document` only (`verification_document` is
   * not diffed by this endpoint — a real gap, not an oversight), in-force →
   * pending. When there is no in-force version, every path reports `"added"`.
   * The server computes this; render it, do not recompute it client-side.
   */
  diff: PolicyDiffEntry[];
}

export interface PolicyChangeBinding {
  /** This provider's own binding id for the affected tool. */
  bindingId: string;
  /** `BindingStatus` at read time — `DRAFT | ACTIVE | PAUSED | SUSPENDED`. */
  status: string;
}

export type PolicyDiffChangeType = "added" | "removed" | "changed";

export interface PolicyDiffEntry {
  /** `$`-rooted locator within `decision_document`, e.g. `$.verifiers[0].verifierId`. */
  path: string;
  changeType: PolicyDiffChangeType;
  /** The in-force value at this path. `undefined` when `changeType` is `"added"`. */
  before?: unknown;
  /** The pending value at this path. `undefined` when `changeType` is `"removed"`. */
  after?: unknown;
}
