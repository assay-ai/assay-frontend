import type { CursorPage, ListQuery, Money, WireVerdict } from "@/interfaces";

import { api } from "./api";

export interface ToolCall {
  intentId: string;
  toolId: string;
  providerId: string | null;
  status: string;
  price: Money;
  charged: Money;
  /** Wider than the OpenAPI enum, and nullable. See @/utils/verdict. */
  verdict: WireVerdict;
  createdAt: string;
}

export interface ListToolCallsQuery extends ListQuery {
  status?: string[];
  toolId?: string;
  providerId?: string;
  verdict?: string[];
  from?: string;
  to?: string;
  search?: string;
}

/** GET /tool-calls — the recent-calls list on the Overview and the spine of the Spend explorer. */
export function listToolCalls(query: ListToolCallsQuery = {}): Promise<CursorPage<ToolCall>> {
  return api.get<CursorPage<ToolCall>>("/tool-calls", query as Record<string, unknown>);
}

export function getToolCall(intentId: string): Promise<ToolCall> {
  return api.get<ToolCall>(`/tool-calls/${intentId}`);
}
