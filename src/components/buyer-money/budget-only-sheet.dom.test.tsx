// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* Task 1.16 fix round 1 (I5): the consent page's "Save and approve" checks before it saves. */
const draft = vi.hoisted(() => ({
  validate: vi.fn(() => true),
  dirty: true,
  creatable: true,
  save: vi.fn(() => Promise.resolve()),
}));
vi.mock("./budget-fields", () => ({
  useBudgetDraft: () => draft,
  BudgetFields: () => <div>fields</div>,
}));

import { BudgetOnlySheet } from "./agent-limits";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(props: Partial<React.ComponentProps<typeof BudgetOnlySheet>>) {
  render(
    <BudgetOnlySheet
      open
      onOpenChange={() => undefined}
      agentName="ops-bot"
      policy={null}
      bootstrap={null}
      saveLabel="Save and approve"
      {...props}
    />,
  );
}

describe("BudgetOnlySheet beforeSave", () => {
  it("a reason from beforeSave is shown and nothing is saved", async () => {
    const onSaved = vi.fn();
    mount({ beforeSave: () => Promise.resolve("This request expired."), onSaved });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    });
    expect(draft.save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("This request expired.")).toBeTruthy();
  });

  it("no reason: saves, then onSaved once", async () => {
    const onSaved = vi.fn();
    mount({ beforeSave: () => Promise.resolve(null), onSaved, intro: "These limits apply to everything ops-bot does." });
    expect(screen.getByText("These limits apply to everything ops-bot does.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    });
    expect(draft.save).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("a failed save does not call onSaved", async () => {
    draft.save.mockRejectedValueOnce(new Error("boom"));
    const onSaved = vi.fn();
    mount({ beforeSave: () => Promise.resolve(null), onSaved });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
