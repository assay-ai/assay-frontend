import Decimal from "decimal.js";

import { DASH, stampUtc } from "@/features/g34a/stats";
import { claimTypeLabel } from "@/features/provider-disputes/claim-types";
import type { SlashArithmeticRow } from "@/interfaces/provider-slash-cases";
import { formatMoney } from "@/utils/money";

/**
 * Words for what the slash case's API sends as field names, minor units and
 * codes.
 *
 * The server's rows are a frozen record (`sla_strikes.computation` is written
 * once, when the window closes) and its history sentences are stored as they
 * were written, so both arrive in the server's own vocabulary: `window_calls`,
 * `109500000 × 13.0000% × 2`, `Slash proposed: 28470000 against <binding id>`.
 * Nothing here recomputes a figure — every number is the one that arrived, and
 * only its name, its unit and its ids are rewritten. Anything this file does
 * not recognise is shown as it arrived rather than hidden.
 */

/** What the amounts on a case are denominated in — taken from the proposal's own penalty. */
export interface CaseMoney {
  asset: string;
  decimals: number;
}

const minor = (amount: string, money: CaseMoney): string =>
  formatMoney({ amount, asset: money.asset, decimals: money.decimals });

/* ------------------------------------------------------------ measurement */

const ARITHMETIC_LABEL: Record<string, string> = {
  window_calls: "Calls in this window",
  verified_calls: "Calls we checked",
  excluded_calls: "Calls not counted",
  failed_verified_calls: "Checked calls that failed",
  observed_rate: "Measured failure rate",
  declared_sla: "Failure rate you declared",
  tolerance: "Allowance for sample size",
  effective_threshold: "Breach threshold",
  penalty: "Proposed penalty",
  per_window_cap: "Cap per window",
};

export function arithmeticLabel(key: string): string {
  return ARITHMETIC_LABEL[key] ?? key;
}

/** `109500000 × 13.0000% × 2 (= estimated_bad × average_price × multiplier)`. */
const PENALTY_EXPRESSION = /^(\d+) × ([\d.]+)% × ([\d.]+)(?: \(=.*\))?$/;

/** A plain decimal amount in major units, e.g. the server's `28.470000`. */
const PLAIN_AMOUNT = /^\d+(\.\d+)?$/;

/** A major-unit decimal string as money, through the same formatter as every minor-unit amount. */
function major(value: string, money: CaseMoney): string {
  return minor(new Decimal(value).mul(new Decimal(10).pow(money.decimals)).toFixed(0), money);
}

function penaltyExpression(expression: string, money: CaseMoney): string {
  const match = PENALTY_EXPRESSION.exec(expression);
  if (!match) return expression;
  const [, total, excess, multiplier] = match;
  return `${minor(total, money)} total price of this window's calls × ${excess}% over your declared rate × ${multiplier} (penalty multiplier)`;
}

function note(key: string, text: string | null): string | undefined {
  if (!text) return undefined;
  if (key === "verified_calls") {
    const match = /^≥ (\d+) minimum sample/.exec(text);
    if (match) return `at least ${match[1]} checked calls are needed before a penalty can apply`;
  }
  if (key === "excluded_calls") {
    const match = /^excluded agent: (\S+)$/.exec(text);
    if (match) return `all from one agent · id ${match[1]}`;
  }
  if (key === "effective_threshold") return text.replace(/^observed /, "measured ");
  return text;
}

export interface PresentedArithmeticRow {
  label: string;
  expression?: string;
  value: string;
  note?: string;
}

/** One measurement row in words. The figures are the server's; only names and units change. */
export function presentArithmeticRow(
  row: SlashArithmeticRow,
  money: CaseMoney,
): PresentedArithmeticRow {
  const label = arithmeticLabel(row.key);
  const expression = row.expression ?? undefined;

  if (row.key === "penalty") {
    return {
      label,
      expression: expression ? penaltyExpression(expression, money) : undefined,
      value: PLAIN_AMOUNT.test(row.value) ? major(row.value, money) : row.value,
      note: note(row.key, row.note),
    };
  }

  if (row.key === "per_window_cap") {
    // The server sends a sentence where a figure would go. Since assay-evm
    // 9f036a3 the window never cuts a payment: a penalty that does not fit
    // waits, and is then paid in full.
    return {
      label,
      value: DASH,
      note:
        row.note ??
        "A daily penalty limit applies on chain. A penalty never pays less because of it: when the limit has no room, the penalty waits until it has, and is then paid in full.",
    };
  }

  return { label, expression, value: row.value, note: note(row.key, row.note) };
}

/* ---------------------------------------------------------------- history */

const EVENT_LABEL: Record<string, string> = {
  PROPOSED: "Penalty proposed",
  WAIVED: "Penalty waived",
  NOTIFIED: "Notice delivered",
  ACKNOWLEDGED: "Acknowledged",
  DISPUTE_FILED: "Dispute filed",
  AUTO_CLOSED: "Closed without a dispute",
  CANCELLED: "Cancelled",
  CHAIN_PROPOSED: "Stake reserved",
  CHAIN_PROPOSAL_ADOPTED: "Stake reserved",
  CHAIN_CANCEL_REQUESTED: "Cancel requested — arbiter/admin to sign",
  CHAIN_DISPUTED: "Disputed on chain — awaiting arbiter",
  CHAIN_UPHELD: "Upheld on chain by the arbiter",
  CHAIN_CANCELLED: "Reservation released",
  CHAIN_VOIDED: "Reservation released",
  CHAIN_PART_READOPTED: "Late record adopted",
  CHAIN_SUPERSEDED_RECORD: "Earlier record landed late — the arbiter is asked to cancel it",
  EXECUTED: "Penalty taken",
  EXECUTED_AFTER_CLOSURE: "Penalty taken after closure",
  REVERSED: "Stake restored",
};

/** "REPROPOSAL_REQUESTED" → "Reproposal requested", for a kind the table above does not name. */
function sentenceCase(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The entry's label. `AUTO_CLOSED` is written by three paths, told apart by
 * its `detail` (review R3-5): the undisputed sweep (`arbiterUpheld: false`),
 * the same sweep after the arbiter upheld a disputed record on chain
 * (`arbiterUpheld: true`), and a record standing undisputed while a dispute
 * was open (`from`, the status it left).
 */
export function eventLabel(kind: string, detail?: Record<string, unknown>): string {
  if (kind === "AUTO_CLOSED" && detail) {
    if (detail.arbiterUpheld === true) return EVENT_LABEL.CHAIN_UPHELD;
    if (typeof detail.from === "string") return "Upheld — an undisputed record stands";
  }
  return EVENT_LABEL[kind] ?? sentenceCase(kind);
}

export interface EventSummaryContext extends CaseMoney {
  toolName: string;
  bindingId: string;
}

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/**
 * A stored history sentence, with its minor units written as money, its
 * binding id as the tool's name and its timestamps in the screen's own format.
 */
export function eventSummary(summary: string, context: EventSummaryContext): string {
  const money = (amount: string) => minor(amount, context);

  return summary
    .replace(
      /^Slash proposed: (\d+) against (\S+)$/,
      (_, amount: string, binding: string) =>
        `Penalty of ${money(amount)} proposed against ${
          binding === context.bindingId ? context.toolName : "your binding"
        }`,
    )
    // Newer backends write the amount in dollars and no binding id (BUG-OPS-CASES-03).
    .replace(/^Penalty of (\$\S+) proposed$/, (_, amount: string) => `Penalty of ${amount} proposed against ${context.toolName}`)
    .replace(
      /^Penalty of (\$\S+) is below the de-minimis floor; recorded, not levied$/,
      (_, amount: string) => `Penalty of ${amount} is below the minimum penalty; it is recorded but not charged`,
    )
    .replace(
      /^Penalty of (\d+) is below the de-minimis floor; recorded, not levied$/,
      (_, amount: string) =>
        `Penalty of ${money(amount)} is below the minimum penalty; it is recorded but not charged`,
    )
    .replace(/^Penalty of (\d+) taken from stake$/, (_, amount: string) => {
      return `Penalty of ${money(amount)} taken from stake`;
    })
    .replace(
      /^(\d+) (of stake is reserved|deposited back into stake|was taken from stake)/,
      (_, amount: string, rest: string) => `${money(amount)} ${rest}`,
    )
    .replace(/^Objection filed: (\S+)$/, (_, claim: string) => {
      return `Dispute filed: ${claimTypeLabel(claim)}`;
    })
    .replace(/^Provider opened the case$/, "You opened the case")
    .replace(/^Assigned to \S+$/, "Assigned to a reviewer")
    .replace(/^Delivered; the provider has until (\S+) to object$/, "Delivered. You have until $1 to dispute")
    .replace(/^No objection was filed by /, "No dispute was filed by ")
    .replace(ISO_INSTANT, (iso) => `${stampUtc(iso)} UTC`);
}

/* ------------------------------------------------------------ restoration */

/** A restoration row's value: a bare decimal amount as money, and the one internal note in user words. */
export function restorationValue(value: string, money: CaseMoney): string {
  if (PLAIN_AMOUNT.test(value)) return major(value, money);
  if (value.startsWith("not tracked")) return "not tracked yet";
  return value;
}
