/**
 * DEMO ONLY: what a demo action changed, so the screen shows the result of
 * Pause all or of a saved spending limit instead of snapping back on the next
 * fetch (Chrome regression 2026-10-17 P3-2). The same kind of stage direction
 * as a signed debt in `demo-debts.ts`: nothing is a ledger.
 *
 * The spend-policy change (Pause all / Resume, a removed older rule) is also
 * kept for the browser tab (sessionStorage), like `?debt=` and `?rails=`, so
 * a paused demo stays paused after a reload (final regression 2026-10-17
 * P3-d). The caps below stay in memory until reload.
 */

const POLICY_KEY = "assay.demo.policy";

let policyChange: Record<string, unknown> | null = null;
const delegateCaps = new Map<string, { maxVoucherAmount: string; maxPerWindow: string; validUntil?: string }>();

/** The policy change the tab kept, read once; `{}` without a window or storage. */
function keptPolicyChange(): Record<string, unknown> {
  if (policyChange) return policyChange;
  policyChange = {};
  if (typeof window === "undefined") return policyChange;
  try {
    const raw = window.sessionStorage.getItem(POLICY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) policyChange = parsed as Record<string, unknown>;
  } catch {
    // Storage blocked or a malformed value: start from the stage set's policy.
  }
  return policyChange;
}

/** The demo's PATCH /spend-policy: remember the fields that changed, for this tab. */
export function rememberDemoPolicy(change: Record<string, unknown>): void {
  policyChange = { ...keptPolicyChange(), ...change };
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(POLICY_KEY, JSON.stringify(policyChange));
  } catch {
    // Storage blocked: the change still shows until reload.
  }
}

/** GET /spend-policy as the demo's own actions left it. */
export function withDemoPolicy<T extends Record<string, unknown>>(policy: T): T {
  return { ...policy, ...keptPolicyChange() };
}

/** A demo "Sign and save": the delegate's new caps, in atomic units. */
export function rememberDemoDelegateCaps(
  delegate: string,
  caps: { maxVoucherAmount: string; maxPerWindow: string; validUntil?: string },
): void {
  delegateCaps.set(delegate.toLowerCase(), caps);
}

export function demoDelegateCaps(delegate: string) {
  return delegateCaps.get(delegate.toLowerCase()) ?? null;
}

let escrowCaps: { maxVoucherAmount: string; maxPerWindow: string } | null = null;

/** A demo account ceiling change, in atomic units. */
export function rememberDemoEscrowCaps(caps: { maxVoucherAmount: string; maxPerWindow: string }): void {
  escrowCaps = caps;
}

export function demoEscrowCaps() {
  return escrowCaps;
}

/** Tests only. */
export function resetDemoStage(): void {
  policyChange = null;
  escrowCaps = null;
  delegateCaps.clear();
}
