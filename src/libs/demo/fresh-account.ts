/**
 * DEMO ONLY. A brand-new account, so reviewers can see Get started's
 * not-done states without signing up: open any buyer page with
 * `?fresh=<stage>` and the buyer fixtures answer as that account would.
 * The choice is kept for the browser tab (sessionStorage), so moving between
 * pages keeps it; `?fresh=0` goes back to the full demo account.
 *
 *   new   — no key yet                       (step 1 current)
 *   call  — a key, never used                (step 2 current)
 *   funds — first call made, no escrow       (step 3 current)
 *   bind  — escrow with a ceiling, no payment key bound (step 4: run npx -y @goassay-ai/mcp@<V> enable-paid)
 *   pay   — payment key bound, not allowed to pay yet   (step 4: Let it pay)
 *
 * Read only in the browser; a server render (static export) sees no stage.
 */
export type FreshStage = "new" | "call" | "funds" | "bind" | "pay";

const STAGES: readonly FreshStage[] = ["new", "call", "funds", "bind", "pay"];
const KEY = "assay.demo.fresh";

export function parseFreshStage(value: string | null | undefined): FreshStage | null | "clear" {
  if (value === null || value === undefined) return null;
  if (value === "0" || value === "") return "clear";
  if (value === "1") return "new";
  return (STAGES as readonly string[]).includes(value) ? (value as FreshStage) : null;
}

/**
 * A stage the demo moved to by itself (e.g. "Create key" on a `new` account
 * makes it a `call` account), so the screens update without a reload. Kept in
 * memory only: a full reload of `?fresh=new` starts the walkthrough again.
 */
let advanced: FreshStage | null = null;

function readStage(): FreshStage | null | "clear" {
  const asked = parseFreshStage(new URLSearchParams(window.location.search).get("fresh"));
  if (asked === "clear") {
    window.sessionStorage.removeItem(KEY);
    return "clear";
  }
  if (asked) {
    window.sessionStorage.setItem(KEY, asked);
    return asked;
  }
  const kept = parseFreshStage(window.sessionStorage.getItem(KEY));
  return kept && kept !== "clear" ? kept : null;
}

export function freshStage(): FreshStage | null {
  if (typeof window === "undefined") return null;
  try {
    const stage = readStage();
    if (stage === "clear" || stage === null) {
      if (stage === "clear") advanced = null;
      return null;
    }
    return advanced && freshAtLeast(advanced, stage) ? advanced : stage;
  } catch {
    return null;
  }
}

/** Move a fresh demo account on to `to`, when it is currently at `from`. */
export function advanceFreshStage(from: FreshStage, to: FreshStage): void {
  if (freshStage() === from) advanced = to;
}

/** At or past `stage` in the order above. */
export function freshAtLeast(current: FreshStage, stage: FreshStage): boolean {
  return STAGES.indexOf(current) >= STAGES.indexOf(stage);
}
