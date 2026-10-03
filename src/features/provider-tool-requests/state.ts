import { DASH, stampUtc } from "@/features/g34a/stats";
import type { ToolRequest } from "@/interfaces/provider-tool-requests";

/**
 * The "State" column text — the tool requests screen, the design's "The queue" panel.
 *
 * The design's three example rows read (export has an overlap artefact, read
 * carefully): `first response due 2026-08-13` for an open ticket, `in schema
 * review` for one an operator has looked at, and `declined — overlaps
 * query_blockchain` for a closed one.
 *
 * `ACKNOWLEDGED`'s copy is deliberately **not** "in schema review" — see the
 * report. There is no schema anywhere in this MVP (`CreateToolRequestBodyDto`
 * accepts no schema field and the doc is explicit: "Do not ship a proposal
 * workflow before the reviewers exist"), so a phrase implying one is under
 * review would assert a review process that does not exist. This says only
 * what `ToolRequestStatus`'s own transitions say: acknowledged is "looked at,
 * not yet decided."
 */
export function toolRequestStateLine(request: ToolRequest): string {
  switch (request.status) {
    case "OPEN":
      return `first response due ${stampUtc(request.firstResponseDueAt)} UTC`;
    case "ACKNOWLEDGED":
      return "acknowledged — not yet decided";
    case "ACCEPTED":
      return request.resolutionNote ? `accepted — ${request.resolutionNote}` : "accepted";
    case "DECLINED":
      return request.resolutionNote ? `declined — ${request.resolutionNote}` : "declined";
    default:
      return DASH;
  }
}

/**
 * The "Owner" column. `ownerOperatorId` is a bare uuid and is `null` until
 * the first response assigns one — there is no name anywhere on the wire (no
 * operator-name endpoint a provider session can read), so this renders the
 * id itself, shortened, or an honest "unassigned" rather than inventing a
 * display name the API does not supply.
 */
export function toolRequestOwnerLabel(request: ToolRequest): string {
  if (!request.ownerOperatorId) return "unassigned";
  const id = request.ownerOperatorId;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Whether this ticket has left `OPEN`/`ACKNOWLEDGED` — no further movement, ever. */
export function isToolRequestTerminal(status: ToolRequest["status"]): boolean {
  return status === "ACCEPTED" || status === "DECLINED";
}
