/**
 * The shared services every screen may rely on.
 *
 * Some screen-specific buyer services are deliberately NOT
 * re-exported here, and `export *` must not be added until the collisions below
 * are resolved — two pairs of them export the same name with different
 * behaviour and different row types:
 *
 *   listVerdicts            guarantee.service.ts  and  verdicts.service.ts
 *   getProviderVerification providers.service.ts  and  explore.service.ts
 *
 * `guarantee.service.ts`'s copy also still comma-joins `verdictStatus`, which
 * was a workaround for axios serialising arrays as `key[]=value`. That is fixed
 * at the client now, so the workaround is redundant rather than wrong.
 *
 * Consolidating them means agreeing one verdict row type across the guarantee
 * panel and the verdict feed, which is a real decision and not a merge-pass
 * afterthought. Until then, import those services by path — which is what their
 * screens already do.
 */
export * from "./api";
export * from "./balances.service";
export * from "./tool-calls.service";
export * from "./receipts.service";
export * from "./account.service";

// The buyer's escrow.
export * from "./escrow.service";

/**
 * The provider console's service layer.
 *
 * Re-exported here — unlike the screen-specific buyer services above — because
 * none of them collides: every symbol is a function named for its endpoint,
 * and every type they touch lives in `@/interfaces` rather than beside the
 * function, per the frontend conventions.
 *
 * `getProviderVerification` is deliberately absent. It already exists twice
 * (`providers.service.ts` and `explore.service.ts`) with two different return
 * shapes; a third copy would make the collision worse rather than resolve it.
 * Import it by path until those two are reconciled.
 */
export * from "./provider-profile.service";
export * from "./provider-registration.service";
export * from "./provider-reports.service";
export * from "./provider-payout-address.service";
export * from "./provider-payouts.service";
export * from "./provider-stake.service";
export * from "./provider-stake-authority.service";
export * from "./provider-sla-windows.service";
export * from "./provider-tool-bindings.service";

// The nine deferred provider screens. Provider-scoped names
// throughout: `listVerdicts` and `getProviderVerification` are the two symbols
// this barrel already had to leave out over collisions, and the verdict feed
// would have been a third.
export * from "./provider-verdicts.service";
export * from "./provider-evidence.service";
export * from "./provider-disputes.service";
export * from "./provider-policy-changes.service";
export * from "./provider-tool-requests.service";
export * from "./provider-slash-cases.service";

// The operator console. None of its eleven names collides
// with anything already exported here; they are all operator-scoped verbs
// (`claimCase`, `decideCase`, `secondCase`, …) reached through a second
// client. `operator-api.ts` itself stays out of this barrel on purpose: the
// operator bearer token is a separate authentication path, and exporting the
// client beside the shared `api` is how one gets picked by accident.
export * from "./operator.service";

// Proof of reserves. The one anonymous read on this surface: it
// carries no tenant, and `getPublicReserves` returns null rather than throwing
// on a 404, which is the deployment saying it publishes no reserves page.
export * from "./reserves.service";

// The public live demo. Anonymous like the reserves read, but this
// one SPENDS: `runDemo` returns null on 404 (no demo configured here), and
// money is known only after `pollDemoVerdict`, never from the run itself.
export * from "./demo.service";

// Which chains this deployment offers. Read at runtime, never
// baked into the bundle; every money screen's chain list starts here.
export * from "./chains.service";
