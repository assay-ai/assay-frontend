// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* V1-13: a signed-in visit to /login goes where `next` says, if it is a safe in-app path. */
const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, login: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/patterns/testnet-chip", () => ({ TestnetChip: () => null }));

import LoginPage from "./page";

function visit(query: string, hookQuery = query) {
  window.history.replaceState(null, "", `/login${query ? `?${query}` : ""}`);
  search.value = hookQuery;
  render(<LoginPage />);
}

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe("signed in at /login", () => {
  it("goes to next", () => {
    visit("next=%2Fprovider");
    expect(replace).toHaveBeenCalledWith("/provider");
  });

  it("goes to next even before the hook has read the query string", () => {
    visit("next=%2Fprovider", "");
    expect(replace).toHaveBeenLastCalledWith("/provider");
    expect(replace).not.toHaveBeenCalledWith("/");
  });

  it.each([
    "next=https%3A%2F%2Fevil.example",
    "next=%2F%2Fevil.example",
    "next=%2F%5Cevil.example",
    "next=%2F%252F%252Fevil.example",
    "next=%2Foperator%2Fcases",
  ])("goes to Overview for an unsafe next (%s)", (query) => {
    visit(query);
    expect(replace).toHaveBeenCalled();
    for (const [target] of replace.mock.calls) expect(target).toBe("/");
  });

  it("goes to Overview with no next", () => {
    visit("");
    expect(replace).toHaveBeenCalledWith("/");
  });
});
