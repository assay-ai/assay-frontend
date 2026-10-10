import { looksLikeUuid } from "@/features/provider-traffic/breakdown";

/** The verdict feed's filter sheet, as typed. `from` / `to` are `YYYY-MM-DD` day strings read as UTC days. */
export interface VerdictFilterValues {
  agentId: string;
  reasonCode: string;
  from: string;
  to: string;
}

/** `From` is the first instant of that UTC day. */
export function fromDayToIso(day: string): string | undefined {
  return day ? new Date(`${day}T00:00:00.000Z`).toISOString() : undefined;
}

/** `To` is the last instant of that UTC day, so the range is inclusive and in one timezone. */
export function toDayToIso(day: string): string | undefined {
  return day ? new Date(`${day}T23:59:59.999Z`).toISOString() : undefined;
}

/** The first problem with the filters, or `null`. Mirrors what the API would answer 400 to. */
export function validateVerdictFilters(values: VerdictFilterValues): string | null {
  const agentId = values.agentId.trim();
  if (agentId !== "" && !looksLikeUuid(agentId)) return "Agent id must be a UUID.";
  if (values.from && values.to && values.from > values.to) {
    return "From must be on or before To.";
  }
  return null;
}
