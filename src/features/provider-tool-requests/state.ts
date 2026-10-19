import type { ToolRequest } from "@/interfaces/provider-tool-requests";

/** Whether this ticket has left `OPEN`/`ACKNOWLEDGED` — no further movement, ever. */
export function isToolRequestTerminal(status: ToolRequest["status"]): boolean {
  return status === "ACCEPTED" || status === "DECLINED";
}
