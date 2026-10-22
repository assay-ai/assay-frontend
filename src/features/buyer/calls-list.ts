import { refundableOnly, statusesFor, type CallsFilter } from "@/features/buyer/call-outcome";
import type { CursorPage } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listFreeToolCalls, listToolCalls, type FreeToolCall, type ToolCall } from "@/services/tool-calls.service";

/** Which list a page came from, so its next page is asked of the same list (a cursor fits only its own). */
export type CallsSource = "free" | "plain";

export type CallsPage = CursorPage<ToolCall | FreeToolCall> & { source: CallsSource };

/**
 * One page of the Calls list for a chip. The Free chip asks for the served
 * free calls (lot 1 B5, BUG-AGT-01). An older backend refuses `include=free`
 * with 400: then that first page, and the pages after it, come from the
 * plain list (paid rows with a zero price), as before. Decided per request,
 * never remembered for the session (review M3): a later 400 on a free page
 * is shown as an error, not hidden.
 */
export async function listCalls(
  filter: CallsFilter,
  query: { limit: number; toolId?: string; cursor?: string },
  source?: CallsSource,
): Promise<CallsPage> {
  const plain = async (): Promise<CallsPage> => ({
    ...(await listToolCalls({ ...query, status: statusesFor(filter), refundable: refundableOnly(filter) })),
    source: "plain",
  });
  if (filter !== "free" || source === "plain") return plain();
  try {
    return { ...(await listFreeToolCalls(query)), source: "free" };
  } catch (error) {
    // Only the first page may fall back: a later page's cursor belongs to the free list.
    if (source === "free" || query.cursor || !(error instanceof ApiError && error.status === 400)) throw error;
    return plain();
  }
}
