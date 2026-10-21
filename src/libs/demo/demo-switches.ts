/**
 * DEMO ONLY: two switches for states the demo account never reaches by itself.
 * Open any page with the query below; the choice is kept for the browser tab
 * (sessionStorage) like `?debt=` and `?fresh=`, and the reset value clears it.
 *
 *   ?rails=free-only — the demo account's chain serves free calls only (as
 *                      Solana does today): `servesPaidCalls` is false for it.
 *                      `?rails=paid` (or `?rails=all`) goes back.
 *                      (Not `?chain=`: that already picks the escrow's chain
 *                      in the Funding escrow drawer.)
 *   ?tighten=1h      — the demo escrow delays a tightening (assay-evm D-21):
 *                      `tightenDelaySeconds` is 3600. Also `30m`, `90s` or a
 *                      plain number of seconds; `?tighten=0` goes back to an
 *                      escrow where a tightening binds at once.
 *
 * Dead code outside a demo build: every read is behind the same env flag as
 * `demoEnabled()` (not imported from `demo-api.ts`, which pulls in every
 * fixture; `paid-rails.ts` imports this file).
 */

/** The demo account's chain — the same id as `DEMO_CHAIN_ID` in `fixtures.ts`. */
export const DEMO_SWITCH_CHAIN_ID = "eip155:46630";

const RAILS_KEY = "assay.demo.rails";
const TIGHTEN_KEY = "assay.demo.tighten";

function demoBuild(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_CHAINS === "robinhood";
}

export type DemoRails = "free-only" | "paid";

/** `free-only`, or `paid` (also spelt `all`) to go back. */
export function parseRailsSwitch(value: string | null | undefined): DemoRails | null {
  if (value === "free-only") return "free-only";
  return value === "paid" || value === "all" ? "paid" : null;
}

/** Seconds, or 0 for "binds at once"; null when the value is not a duration. */
export function parseTightenSwitch(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === "0" || v === "off") return 0;
  const match = /^(\d+)(h|m|s)?$/.exec(v);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2] === "h" ? 3_600 : match[2] === "m" ? 60 : 1;
  return n * unit;
}

/**
 * Read the query switch, keep it for the tab, or fall back to what the tab
 * kept. `reset` is the parsed value that clears the stored choice.
 */
function readSwitch<T>(param: string, key: string, parse: (v: string | null) => T | null, reset: T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const asked = parse(new URLSearchParams(window.location.search).get(param));
    if (asked !== null) {
      if (asked === reset) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, String(asked));
      return asked;
    }
    return parse(window.sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Whether the demo makes `chainId` a free-calls-only chain. Always false outside a demo build. */
export function demoFreeOnlyChain(chainId: string): boolean {
  if (!demoBuild() || chainId !== DEMO_SWITCH_CHAIN_ID) return false;
  return readSwitch("rails", RAILS_KEY, parseRailsSwitch, "paid") === "free-only";
}

/** The demo escrow's tighten delay in seconds: 0 unless `?tighten=` asked for one. */
export function demoTightenDelaySeconds(): number {
  if (!demoBuild()) return 0;
  return readSwitch("tighten", TIGHTEN_KEY, parseTightenSwitch, 0) ?? 0;
}

/*
  ?contracts=retired — get_weather's major 1 has passed its sunset and is
                       retired (T3), instead of deprecated with 120 days left.
                       `?contracts=mismatch` keeps it deprecated but makes the
                       weather listing's v2 test fail (its API has no
                       temperature_c) and a save with the input "units"
                       refused (the mapping never reads it).
                       `?contracts=deprecated` goes back.
*/
const CONTRACTS_KEY = "assay.demo.contracts";

export type DemoContracts = "retired" | "deprecated" | "mismatch";

export function parseContractsSwitch(value: string | null | undefined): DemoContracts | null {
  return value === "retired" || value === "deprecated" || value === "mismatch" ? value : null;
}

/** Whether the demo makes the weather listing fail its v2 test and refuse "units". Always false outside a demo build. */
export function demoContractMismatch(): boolean {
  if (!demoBuild()) return false;
  return readSwitch("contracts", CONTRACTS_KEY, parseContractsSwitch, "deprecated") === "mismatch";
}

/** Whether the demo retires get_weather v1. Always false outside a demo build. */
export function demoRetiredMajor(): boolean {
  if (!demoBuild()) return false;
  return readSwitch("contracts", CONTRACTS_KEY, parseContractsSwitch, "deprecated") === "retired";
}
