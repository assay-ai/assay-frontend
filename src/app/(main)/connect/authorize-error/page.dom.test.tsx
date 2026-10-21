// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* `/connect/authorize-error?reason=…`: the sentence per reason, the way out, and a full page load to leave. */
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
const nav = vi.hoisted(() => ({ loadPage: vi.fn() }));
vi.mock("@/features/oauth/strict-pages", async (original) => {
  const actual = await original<typeof import("@/features/oauth/strict-pages")>();
  return {
    ...actual,
    loadPage: nav.loadPage,
    useFullLoadLinks: () => actual.useFullLoadLinks(nav.loadPage),
  };
});

import { AUTHORIZE_ERROR_COPY, AUTHORIZE_ERROR_FALLBACK } from "@/features/oauth/authorize-error";

import AuthorizeErrorPage from "./page";

function mount(query: string) {
  search.value = query;
  return render(<AuthorizeErrorPage />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("authorize-error page", () => {
  it.each(Object.entries(AUTHORIZE_ERROR_COPY))("reason=%s → its own sentence", (reason, text) => {
    mount(`reason=${reason}`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This app could not connect");
    expect(screen.getByRole("status").textContent).toBe(text);
  });

  it.each(["", "reason=", "reason=toString", "reason=__proto__", "reason=nope"])(
    "%s → the general sentence",
    (query) => {
      mount(query);
      expect(screen.getByRole("status").textContent).toBe(AUTHORIZE_ERROR_FALLBACK);
    },
  );

  it("offers another way to connect, left as a full page load", () => {
    mount("reason=client_unknown");
    const link = screen.getByRole("link", { name: "Connect your agent another way" });
    expect(link.getAttribute("href")).toBe("/connect");
    fireEvent.click(link);
    expect(nav.loadPage).toHaveBeenCalledWith("/connect");
  });
});
