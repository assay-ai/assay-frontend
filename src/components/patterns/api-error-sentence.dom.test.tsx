// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, TOO_MANY_REQUESTS } from "@/libs/ApiClient";

import { ApiErrorSentence } from "./api-error-sentence";

/* BUG-OPT-01 / lot 1 B9: the 429 sentence counts down to the end the Retry-After named. */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ApiErrorSentence", () => {
  it("counts a 429 down once a second and says when the wait is over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-21T00:00:00Z"));
    const error = new ApiError(TOO_MANY_REQUESTS, "x", 429, "/agents", undefined, 3, Date.parse("2026-10-21T00:00:03Z"));
    const { container } = render(<ApiErrorSentence error={error} />);
    expect(container.textContent).toBe("Too many requests. Try again in 3 s.");
    act(() => void vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe("Too many requests. Try again in 2 s.");
    act(() => void vi.advanceTimersByTime(2000));
    expect(container.textContent).toBe("Too many requests earlier. You can try again now.");
  });

  it("keeps any other error's sentence, and a fallback for a non-API failure", () => {
    const { container, rerender } = render(<ApiErrorSentence error={new ApiError("AUTH_INVALID", "nope", 401)} />);
    const sentence = container.textContent;
    expect(sentence).not.toMatch(/Too many/);
    rerender(<ApiErrorSentence error={new Error("boom")} fallback="Could not reach Assay." />);
    expect(container.textContent).toBe("Could not reach Assay.");
  });

  it("a 429 with no wait keeps the plain sentence", () => {
    const { container } = render(<ApiErrorSentence error={new ApiError(TOO_MANY_REQUESTS, "x", 429)} />);
    expect(container.textContent).toBe("Too many requests. Wait a moment and try again.");
  });
});
