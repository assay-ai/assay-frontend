import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READY_TIMEOUT_MS, startReadyTimeout } from "./ready-timeout";

describe("startReadyTimeout (BUG-R8-L-01)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits between 8 and 10 seconds by default", () => {
    expect(READY_TIMEOUT_MS).toBeGreaterThanOrEqual(8_000);
    expect(READY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("does not fire before the wait is over", () => {
    const onTimeout = vi.fn();
    startReadyTimeout(onTimeout);
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("fires once when the wait is over", () => {
    const onTimeout = vi.fn();
    startReadyTimeout(onTimeout);
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("never fires once cancelled, which is what `ready` arriving does", () => {
    const onTimeout = vi.fn();
    const cancel = startReadyTimeout(onTimeout);
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    cancel();
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 3);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
