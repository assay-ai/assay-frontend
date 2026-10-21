import { refundableOnly, statusesFor, type CallsFilter } from "@/features/buyer/call-outcome";
import type { CursorPage } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listFreeToolCalls, listToolCalls, type FreeToolCall, type ToolCall } from "@/services/tool-calls.service";

/*
  An older backend refuses `include=free` (400): the Free chip then keeps
  today's list (paid rows with a zero price), for the rest of the session.
*/
let freeListRefused = false;

/** Tests only: forget that the backend refused `include=free`. */
export function resetFreeListSupport(): void {
  freeListRefused = false;
}

/** One page of the Calls list for a chip: the Free chip asks for served free calls. */
export async function listCalls(
  filter: CallsFilter,
  query: { limit: number; toolId?: string; cursor?: string },
): Promise<CursorPage<ToolCall | FreeToolCall>> {
  if (filter === "free" && !freeListRefused) {
    try {
      // The served free calls themselves (lot 1 B5, BUG-AGT-01), not only zero-price intents.
      return await listFreeToolCalls(query);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400)) throw error;
      freeListRefused = true;
    }
  }
  return listToolCalls({ ...query, status: statusesFor(filter), refundable: refundableOnly(filter) });
}
