import type { ToolRequest } from "@/interfaces/provider-tool-requests";

/** Whether this ticket has left `OPEN`/`ACKNOWLEDGED` — no further movement, ever. */
export function isToolRequestTerminal(status: ToolRequest["status"]): boolean {
  return status === "ACCEPTED" || status === "DECLINED";
}

/**
 * "Calls a month" as typed: digits, with optional thousands commas. `null` for
 * anything else, so "1e3", "0x10" or "12.0" are refused rather than read as a number.
 */
export function parseMonthlyCalls(raw: string): number | null {
  const digits = raw.trim().replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
