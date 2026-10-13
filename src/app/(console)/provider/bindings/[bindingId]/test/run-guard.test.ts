import { describe, expect, it } from "vitest";

import { createRunGuard } from "./run-guard";

describe("createRunGuard — one run at a time (BUG-R3-V2-01)", () => {
  it("lets the first press in and refuses the rest until the run settles", () => {
    const guard = createRunGuard();
    // Five Enter presses inside one render: no state update has landed yet.
    const started = [1, 2, 3, 4, 5].filter(() => guard.enter());
    expect(started).toEqual([1]);

    guard.leave();
    expect(guard.enter()).toBe(true);
  });
});
