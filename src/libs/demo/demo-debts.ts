/**
 * DEMO ONLY: which buyer-debt picture `GET /escrow/debts` paints, so every
 * state of the debt banner and the settle sheet can be looked at without a
 * backend. Open any buyer page with `?debt=<variant>`; the choice is kept for
 * the browser tab (sessionStorage) like `?fresh=`, and `?debt=open` goes back
 * to the default.
 *
 *   open         — one open debt (the default)
 *   written-off  — the same debt, past its write-off date
 *   many         — two of your own debts to sign, plus one another wallet owes
 *   other-wallet — the debt is owed by another wallet of the organization
 *   collecting   — signed, being collected
 *   short        — written off, and the escrow cannot pay it: its balance is
 *                  below the debt and the debt is over the per-call ceiling,
 *                  so the settle sheet shows "Add $Y" and "Raise the ceiling"
 *   unread       — one open debt, and the escrow cannot be read from the
 *                  chain, so the settle sheet says its checks were skipped
 *   none         — nothing owed
 *
 * Settling in the demo runs the simulated wallet steps (`sheetSigning`); on
 * success the signed debts read as "being collected" until the page is
 * reloaded. That is kept in memory only, like `advanceFreshStage`: it is a
 * stage direction, not a ledger.
 */
export type DemoDebtVariant =
  | "open"
  | "written-off"
  | "many"
  | "other-wallet"
  | "collecting"
  | "short"
  | "unread"
  | "none";

const VARIANTS: readonly DemoDebtVariant[] = [
  "open",
  "written-off",
  "many",
  "other-wallet",
  "collecting",
  "short",
  "unread",
  "none",
];
const KEY = "assay.demo.debt";

export function parseDebtVariant(value: string | null | undefined): DemoDebtVariant | null {
  return value && (VARIANTS as readonly string[]).includes(value) ? (value as DemoDebtVariant) : null;
}

export function demoDebtVariant(): DemoDebtVariant {
  if (typeof window === "undefined") return "open";
  try {
    const asked = parseDebtVariant(new URLSearchParams(window.location.search).get("debt"));
    if (asked) {
      if (asked === "open") window.sessionStorage.removeItem(KEY);
      else window.sessionStorage.setItem(KEY, asked);
      return asked;
    }
    return parseDebtVariant(window.sessionStorage.getItem(KEY)) ?? "open";
  } catch {
    return "open";
  }
}

/** Whether the variant shows the owed call as written off (`short` is a written-off debt too). */
export function writtenOffVariant(variant: DemoDebtVariant): boolean {
  return variant === "written-off" || variant === "short";
}

const signed = new Set<string>();

/** The demo's simulated signature went through: show these debts as being collected. */
export function markDemoDebtsSigned(intentIds: readonly string[]): void {
  for (const id of intentIds) signed.add(id);
}

export function demoDebtSigned(intentId: string): boolean {
  return signed.has(intentId);
}
