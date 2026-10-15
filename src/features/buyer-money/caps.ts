import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatDecimal, parseAmountInput, toDecimal } from "@/utils/money";

/**
 * The account ceiling: the two on-chain limits a buyer signs for their whole
 * escrow (and the same two numbers an agent's own spending limit is given). Presets so a new
 * buyer never has to invent numbers; Custom for anyone who wants to.
 */
export interface CapsPreset {
  id: "light" | "standard";
  label: string;
  perCall: string;
  perDay: string;
}

export const CAP_PRESETS: readonly CapsPreset[] = [
  { id: "light", label: "Light", perCall: "0.50", perDay: "5" },
  { id: "standard", label: "Standard", perCall: "1", perDay: "20" },
];

export type CapsChoice = CapsPreset["id"] | "custom";

/** "$0.50 a call · $5 a day", the chip's second line. */
export function presetDescription(preset: Pick<CapsPreset, "perCall" | "perDay">): string {
  return `${short(preset.perCall)} a call · ${short(preset.perDay)} per 24 h`;
}

/** The preset these two numbers are, or "custom". Numeric: "1.00" is "1". */
export function presetFor(perCall: string, perDay: string): CapsChoice {
  for (const preset of CAP_PRESETS) {
    if (sameNumber(perCall, preset.perCall) && sameNumber(perDay, preset.perDay)) return preset.id;
  }
  return "custom";
}

/** The plain sentence under the choice: what the caps mean for a call. */
export function capsSentence(perCall: string, perDay: string, who = "your agents together"): string | null {
  const call = safeDecimal(perCall);
  const day = safeDecimal(perDay);
  if (!call || !day) return null;
  return `Any one call can cost at most ${formatDecimal(call)}, and ${who} can spend at most ${formatDecimal(day)} in any 24 hours.`;
}

export interface ParsedCaps {
  perCall: { atomic: string | null; error: string | null };
  perDay: { atomic: string | null; error: string | null };
  ok: boolean;
}

/** Both fields through `parseAmountInput`, plus "a call cannot exceed the day". */
export function parseCaps(perCall: string, perDay: string, decimals: number): ParsedCaps {
  const call = parseAmountInput(perCall, { decimals });
  const day = parseAmountInput(perDay, { decimals });
  let callError = call.error;
  if (!callError && !day.error && call.value && day.value && call.value.gt(day.value)) {
    callError = "One call cannot cost more than a whole day allows.";
  }
  return {
    perCall: { atomic: callError ? null : call.atomic, error: callError },
    perDay: { atomic: day.error ? null : day.atomic, error: day.error },
    ok: !callError && !day.error,
  };
}

/** Whether escrow caps are set to something that lets a call through. */
export function capsAreSet(caps: { maxVoucherAmount: Money | null; maxPerWindow: Money | null } | null | undefined): boolean {
  if (!caps?.maxVoucherAmount || !caps.maxPerWindow) return false;
  return BigInt(caps.maxVoucherAmount.amount || "0") > 0n && BigInt(caps.maxPerWindow.amount || "0") > 0n;
}

/** The caps a Money pair stands for, as form strings ("1", "20"). */
export function capsToForm(caps: { maxVoucherAmount: Money | null; maxPerWindow: Money | null } | null | undefined): {
  perCall: string;
  perDay: string;
} | null {
  if (!capsAreSet(caps)) return null;
  return {
    perCall: toDecimal(caps!.maxVoucherAmount!).toString(),
    perDay: toDecimal(caps!.maxPerWindow!).toString(),
  };
}

function short(value: string): string {
  const d = safeDecimal(value);
  if (!d) return value;
  return d.isInteger() ? `$${d.toFixed(0)}` : formatDecimal(d);
}

function safeDecimal(value: string): Decimal | null {
  const text = value.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return null;
  try {
    return new Decimal(text);
  } catch {
    return null;
  }
}

function sameNumber(a: string, b: string): boolean {
  const x = safeDecimal(a);
  const y = safeDecimal(b);
  return Boolean(x && y && x.eq(y));
}

/**
 * A key as 4-character groups, for checking it by eye against what
 * `agent-cli` printed: "0x18ab cd34 …". The `0x` stays on the first group.
 */
export function keyGroups(address: string): string[] {
  const raw = address.includes(":") ? address.slice(address.lastIndexOf(":") + 1) : address;
  const body = raw.startsWith("0x") ? raw.slice(2) : raw;
  const groups = body.match(/.{1,4}/g) ?? [];
  return raw.startsWith("0x") && groups.length > 0 ? [`0x${groups[0]}`, ...groups.slice(1)] : groups;
}
