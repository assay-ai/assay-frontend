import { describe, expect, it } from "vitest";

import { OPERATOR_TOOLS_LIST_KEY, operatorQueries } from "./queries";

describe("operatorQueries", () => {
  it("reads the arbiter's terms from the chain as they are now: never fresh", () => {
    expect(operatorQueries.arbiterTerms("eip155:46630").staleTime).toBe(0);
    expect(operatorQueries.arbiterTerms("eip155:46630").queryKey).toEqual(["operator", "arbiter", "terms", "eip155:46630"]);
  });

  it("keeps the tools list under the key a tool write invalidates", () => {
    expect(operatorQueries.tools().queryKey).toEqual(OPERATOR_TOOLS_LIST_KEY);
  });
});
