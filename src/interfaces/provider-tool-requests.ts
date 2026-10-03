/**
 * Tool requests, the MVP slice.
 *
 * Source: assay-backend `src/modules/tool-request/dto/tool-request.dto.ts`,
 * confirmed against a running response from `GET /tool-requests` and
 * `GET /tool-requests/:id` on a local API.
 *
 * This is deliberately a ticket queue, not a proposal workflow: a proposal
 * workflow should not ship before reviewers exist. There is no submitted schema, no review
 * rounds and no revision history anywhere in this shape — four states only,
 * and the only fields a requester ever supplies are `title`, `description`
 * and two optional context fields.
 */

import type { ListQuery } from "./api";

export type ToolRequestStatus = "OPEN" | "ACKNOWLEDGED" | "ACCEPTED" | "DECLINED";

/** `GET /tool-requests` — the caller's own, cursor-paginated. No resource-specific filters. */
export type ListToolRequestsQuery = ListQuery;

/**
 * The requester's own view of a filed ticket.
 *
 * `ownerOperatorId` is a bare operator id, not a name — the DTO's own
 * docstring: "The operator who owns this ticket. Null until the first
 * response assigns one." There is no operator-name endpoint a provider
 * session can read, so a screen rendering this has an id or nothing, never a
 * human name.
 *
 * `firstResponseDueAt` is computed and stored server-side at insert
 * (`computeFirstResponseDueAt`, two working days, weekend rollover only, no
 * holiday calendar) — render it, never recompute it client-side.
 */
export interface ToolRequest {
  id: string;
  title: string;
  description: string;
  upstreamUrl: string | null;
  expectedMonthlyCalls: number | null;
  status: ToolRequestStatus;
  ownerOperatorId: string | null;
  /** ISO-8601. The two-working-day promise, computed at filing. */
  firstResponseDueAt: string;
  /** ISO-8601, or `null` before the first response of any of the three outcomes. */
  firstRespondedAt: string | null;
  /** Set only when `status` is `ACCEPTED` or `DECLINED`. */
  resolutionNote: string | null;
  /** ISO-8601, or `null` while the ticket is still open/acknowledged. */
  closedAt: string | null;
  createdAt: string;
}

/**
 * `POST /tool-requests`'s body.
 *
 * Deliberately two required fields and two optional ones — no schema field.
 * The design draws a third text prompt ("Why a per-call price
 * is truthful for it"); the wire has nowhere to put it but `description`. See
 * the screen for how the two prompts are folded into that one field.
 */
export interface CreateToolRequestBody {
  title: string;
  description: string;
  upstreamUrl?: string;
  expectedMonthlyCalls?: number;
}
