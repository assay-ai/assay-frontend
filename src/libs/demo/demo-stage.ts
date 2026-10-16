/**
 * DEMO ONLY: what a demo action changed, kept in memory until the page is
 * reloaded, so the screen shows the result of Pause all or of a saved
 * spending limit instead of snapping back on the next fetch (Chrome
 * regression 2026-10-17 P3-2). The same kind of stage direction as a signed
 * debt in `demo-debts.ts`: nothing is persisted, nothing is a ledger.
 */

let policyChange: Record<string, unknown> = {};
const delegateCaps = new Map<string, { maxVoucherAmount: string; maxPerWindow: string; validUntil?: string }>();

/** The demo's PATCH /spend-policy: remember the fields that changed. */
export function rememberDemoPolicy(change: Record<string, unknown>): void {
  policyChange = { ...policyChange, ...change };
}

/** GET /spend-policy as the demo's own actions left it. */
export function withDemoPolicy<T extends Record<string, unknown>>(policy: T): T {
  return { ...policy, ...policyChange };
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
  policyChange = {};
  escrowCaps = null;
  delegateCaps.clear();
}
