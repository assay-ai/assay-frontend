import type { Money } from "@/interfaces";
import { toDecimal } from "@/utils/money";

import { sharePercent } from "./period";
import type { WithheldForAsset } from "./wire";

/**
 * "Not charged", one definition on every screen (UX review 2026-10-18, P0-3):
 *
 *   Not charged = Failed our checks + No usable result + Not collected
 *               = listed − charged − owed − in progress
 *
 * The three lines are `GET /withheld`'s buckets, and their total is
 * `GET /receipts/summary`'s `notChargedTotal` for the same window. Overview,
 * Not charged, Spend and Statements all render these lines from here, so a
 * line cannot be named or counted differently on two screens.
 */
export interface NotChargedLineCopy {
  /** The API bucket. */
  bucket: string;
  /** The line's name. */
  label: string;
  /** One clause on what the line means. */
  note: string;
  /** The label inside a sentence: "4 failed our checks (incl. wrong format)". */
  phrase: string;
}

export const NOT_CHARGED_LINE_COPY: readonly NotChargedLineCopy[] = [
  {
    bucket: "FAILED_VERIFICATION",
    label: "Failed our checks (incl. wrong format)",
    note: "the guarantee",
    phrase: "failed our checks (incl. wrong format)",
  },
  {
    bucket: "PROVIDER_OR_PLATFORM_ERROR",
    label: "No usable result",
    note: "a provider or platform error, never charged",
    phrase: "had no usable result",
  },
  {
    bucket: "NOT_COLLECTED",
    label: "Not collected (the provider could not be paid)",
    note: "served, but the payment was not taken",
    phrase: "not collected",
  },
];

export interface NotChargedLine extends NotChargedLineCopy {
  calls: number;
  amount: Money | null;
}

/**
 * The bucket a NOT-CHARGED call falls in, from its status (the API's own rule).
 * Only for a call already known to be not charged: a `SETTLED` call is
 * "not collected" only when it was never collected and is not owed, and a
 * charged one is in no bucket at all.
 */
export function bucketOfStatus(status: string): string | null {
  if (status === "REFUNDED") return "FAILED_VERIFICATION";
  if (status === "VOIDED" || status === "EXPIRED")
    return "PROVIDER_OR_PLATFORM_ERROR";
  if (status === "SETTLED") return "NOT_COLLECTED";
  return null;
}

/**
 * Every line, in a fixed order and zero-filled, so two months always show the
 * same rows. A bucket the API adds later is kept, under the API's own label.
 */
export function notChargedLines(
  withheld: WithheldForAsset | null | undefined,
): NotChargedLine[] {
  const buckets = withheld?.withheld.buckets ?? [];
  const byBucket = new Map(buckets.map((b) => [b.bucket, b]));
  const known = NOT_CHARGED_LINE_COPY.map((copy) => {
    const found = byBucket.get(copy.bucket);
    return { ...copy, calls: found?.calls ?? 0, amount: found?.amount ?? null };
  });
  const extra = buckets
    .filter(
      (b) => !NOT_CHARGED_LINE_COPY.some((copy) => copy.bucket === b.bucket),
    )
    .map((b) => ({
      bucket: b.bucket,
      label: upperFirst(b.label),
      note: "",
      phrase: b.label,
      calls: b.calls,
      amount: b.amount,
    }));
  return [...known, ...extra];
}

/** "4 failed our checks (incl. wrong format), 10 had no usable result, 5 not collected". Empty lines are left out. */
export function notChargedSplitText(
  lines: readonly NotChargedLine[],
): string | null {
  const parts = lines
    .filter((line) => line.calls > 0)
    .map((line) => `${line.calls.toLocaleString("en-US")} ${line.phrase}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface ListedSplitInput {
  listed: Money | null;
  charged: Money | null;
  notCharged: Money | null;
  owed?: Money | null;
  inProgress?: Money | null;
}

export interface ListedSplitSegment {
  key: "charged" | "not-charged" | "owed" | "in-progress";
  label: string;
  value: number;
  amount: Money;
  /** Against listed, one decimal: the same precision as every other share on the screen. */
  percent: string | null;
}

/**
 * Listed, split into the summary's four buckets. They add up to listed by
 * construction (the API derives not charged by subtraction), so a bar drawn
 * from them is a share of listed, never of its own segments. Owed and in
 * progress appear only when non-zero.
 */
export function listedSplit(input: ListedSplitInput): ListedSplitSegment[] {
  const { listed } = input;
  const rows: {
    key: ListedSplitSegment["key"];
    label: string;
    amount: Money | null | undefined;
    always: boolean;
  }[] = [
    { key: "charged", label: "Charged", amount: input.charged, always: true },
    {
      key: "not-charged",
      label: "Not charged",
      amount: input.notCharged,
      always: true,
    },
    { key: "owed", label: "Owed", amount: input.owed, always: false },
    {
      key: "in-progress",
      label: "In progress",
      amount: input.inProgress,
      always: false,
    },
  ];
  return rows
    .filter((row): row is typeof row & { amount: Money } => Boolean(row.amount))
    .filter((row) => row.always || !toDecimal(row.amount).isZero())
    .map((row) => ({
      key: row.key,
      label: row.label,
      value: toDecimal(row.amount).toNumber(),
      amount: row.amount,
      percent: sharePercent(row.amount, listed),
    }));
}

function upperFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
