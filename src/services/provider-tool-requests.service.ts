import type { CursorPage } from "@/interfaces/api";
import type {
  CreateToolRequestBody,
  ListToolRequestsQuery,
  ToolRequest,
} from "@/interfaces/provider-tool-requests";

import { api } from "./api";

/**
 * `GET /tool-requests` — this organization's own filed tickets, oldest first
 * by default (the resource's default sort is `createdAt`; no resource-
 * specific filters exist). Cursor-paginated like every other list on this
 * API — pass `cursor` back verbatim, do not construct or parse it.
 */
export function listToolRequests(
  query: ListToolRequestsQuery = {}
): Promise<CursorPage<ToolRequest>> {
  return api.get<CursorPage<ToolRequest>>("/tool-requests", query as Record<string, unknown>);
}

/**
 * `GET /tool-requests/{id}` — one ticket. A cross-tenant id and a
 * non-existent one both 404 `PROVIDER_TOOL_REQUEST_NOT_FOUND` (verified on
 * the running API) — "not found" and "not yours" render identically.
 */
export function getToolRequest(id: string): Promise<ToolRequest> {
  return api.get<ToolRequest>(`/tool-requests/${encodeURIComponent(id)}`);
}

/**
 * `POST /tool-requests` — files a new ticket. `status` starts `OPEN`,
 * `ownerOperatorId` starts `null`, and `firstResponseDueAt` is computed
 * server-side at insert; none of the three is settable here.
 */
export function createToolRequest(body: CreateToolRequestBody): Promise<ToolRequest> {
  return api.post<ToolRequest>("/tool-requests", body);
}
