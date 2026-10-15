import type { ToolRequest } from "@/interfaces/provider-tool-requests";

/**
 * "Reply due in 2d" / "Overdue 9h" for a request still waiting on Assay's first
 * reply. Null once Assay has replied or the request is closed (its status
 * says enough then).
 */
export interface ReplyBadge {
  label: string;
  tone: "neutral" | "warning" | "danger";
}

export function compactDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function replyBadge(
  request: Pick<ToolRequest, "status" | "firstResponseDueAt" | "firstRespondedAt">,
  nowMs: number,
): ReplyBadge | null {
  if (request.firstRespondedAt || request.status === "ACCEPTED" || request.status === "DECLINED") return null;
  const due = Date.parse(request.firstResponseDueAt);
  if (Number.isNaN(due)) return null;
  const left = due - nowMs;
  if (left <= 0) return { label: `Overdue ${compactDuration(-left)}`, tone: "danger" };
  return { label: `Reply due in ${compactDuration(left)}`, tone: left < 12 * 3_600_000 ? "warning" : "neutral" };
}

export const TOOL_REQUEST_STATUS_LABEL: Record<ToolRequest["status"], string> = {
  OPEN: "Waiting for Assay",
  ACKNOWLEDGED: "Being reviewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};
