import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { AFTER_BLOCK_LIFT, AFTER_CONTRACT_WRITE, refreshAfter } from "./refresh-after";

/** A cache holding one entry per key, all fresh. */
function cacheWith(keys: QueryKey[]): QueryClient {
  const queryClient = new QueryClient();
  for (const key of keys) queryClient.setQueryData(key, "data");
  return queryClient;
}

const invalidated = (queryClient: QueryClient, key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated === true;

// Keys the operator shell and the two screens read (layout, contract editor, blocks page, Home).
const SHELL: QueryKey[] = [
  ["operator", "me", "token"],
  ["operator", "operators", "directory"],
  ["operator", "arbiter", "disputes"],
  ["operator", "arbiter", "superseded"],
  ["operator", "health"],
  ["operator", "cutoffs", "TOOL", "pending"],
  ["operator", "cases", "cancels-due"],
  ["operator", "tool-requests"],
];
const PENDING_COUNT: QueryKey = ["operator", "approvals", "pending-count"];

describe("refreshAfter", () => {
  it("a contract write refreshes the tool, the tools list, the approvals and the override log, not the shell", () => {
    const tool: QueryKey = ["operator", "tools", "tool-1"];
    const list: QueryKey = ["operator", "tools", "list"];
    const log: QueryKey = ["operator", "override-log", { kind: "", q: "", targetId: "" }];
    const queryClient = cacheWith([tool, list, PENDING_COUNT, log, ...SHELL]);

    refreshAfter(queryClient, AFTER_CONTRACT_WRITE);

    for (const key of [tool, list, PENDING_COUNT, log]) expect(invalidated(queryClient, key)).toBe(true);
    for (const key of SHELL) expect(invalidated(queryClient, key)).toBe(false);
  });

  it("lifting a block refreshes the blocks (list, counts, lookup), the approvals and the override log, not the shell", () => {
    const blocks: QueryKey[] = [
      ["operator", "blocks", "list", { active: true }],
      ["operator", "blocks", "list", { active: false }, "count"],
      ["operator", "blocks", "active-count"],
      ["operator", "blocks", "lookup"],
    ];
    const queryClient = cacheWith([...blocks, PENDING_COUNT, ...SHELL]);

    refreshAfter(queryClient, AFTER_BLOCK_LIFT);

    for (const key of [...blocks, PENDING_COUNT]) expect(invalidated(queryClient, key)).toBe(true);
    for (const key of SHELL) expect(invalidated(queryClient, key)).toBe(false);
  });
});
