import { describe, expect, it, vi } from "vitest";

let pathname = "";
let query = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => query,
}));

import { usePublicCallId } from "./usePublicCallId";

describe("usePublicCallId", () => {
  it("reads the id from /explorer/call/<id>, ignoring anything after it", () => {
    pathname = "/explorer/call/3f6e0c1a-7b44-4f19-a3e8-0c9d6b2f4a71/extra";
    query = new URLSearchParams({ id: "other" });
    expect(usePublicCallId()).toBe("3f6e0c1a-7b44-4f19-a3e8-0c9d6b2f4a71");
  });

  it("falls back to ?id= on the bare page (next dev)", () => {
    pathname = "/explorer/call";
    query = new URLSearchParams({ id: "abc" });
    expect(usePublicCallId()).toBe("abc");
  });

  it("is empty with no id, and with a malformed escape", () => {
    pathname = "/explorer/call/";
    query = new URLSearchParams();
    expect(usePublicCallId()).toBe("");
    pathname = "/explorer/call/%E0%A4%A";
    expect(usePublicCallId()).toBe("");
  });
});
