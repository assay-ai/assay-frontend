// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorApproval } from "@/interfaces/operator";

const service = vi.hoisted(() => ({
  closeNothingStanding: vi.fn(),
  recordStuckExecution: vi.fn(),
  reproposeCase: vi.fn(),
}));
vi.mock("@/services/operator.service", async (original) => ({ ...(await original<object>()), ...service }));
vi.mock("@/features/operator/use-operator-lookups", () => ({
  useOperatorDirectory: () => ({ isPending: true, operators: [], nameOf: (id: string) => id }),
}));

import { ManualActionSheet } from "./manual-action-sheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NOTE = "Read the record on the explorer: it is cancelled.";

function open(kind: "close" | "record" | "repropose", options: { waiting?: OperatorApproval | null } = {}) {
  const onDone = vi.fn();
  render(
    <ManualActionSheet
      kind={kind}
      open
      onOpenChange={() => undefined}
      proposalId="34ccdb62-b12c-45b7-bec6-74d0412526c1"
      penaltyText="$28.47"
      appliedText="$4.00"
      me={{ id: "op-1", roles: ["ADJL"] }}
      waiting={options.waiting ?? null}
      onDone={onDone}
    />,
  );
  return onDone;
}

const submitButton = (name: RegExp) => screen.getByRole("button", { name });

/**
 * B18: each stuck-cancel action says what happens first, and is sent only
 * after the operator ticks the confirmation; a double click sends it once.
 */
describe("ManualActionSheet", () => {
  it("says what happens: money, chain, approver, undo", () => {
    open("record");
    const box = within(screen.getByText("What happens").parentElement as HTMLElement);
    expect(box.getByText(/\$4\.00 was already taken/)).toBeTruthy();
    expect(box.getByText(/Nothing is sent on chain/)).toBeTruthy();
    expect(box.getByText(/Needs a second approver/)).toBeTruthy();
    expect(box.getByText(/It can't be undone/)).toBeTruthy();
  });

  it("is not sent until the confirmation is ticked", async () => {
    service.closeNothingStanding.mockResolvedValue({ proposalId: "x", status: "CANCELLED", chainStatus: "CANCELLED", chainEpoch: 0 });
    const onDone = open("close");
    const button = submitButton(/Close the cancel/) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(service.closeNothingStanding).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/What you checked on chain/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
    // A double click sends it once.
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(service.closeNothingStanding).toHaveBeenCalledTimes(1);
    expect(service.closeNothingStanding).toHaveBeenCalledWith("34ccdb62-b12c-45b7-bec6-74d0412526c1", {
      reasonCode: "CHAIN_CANCELLED",
      note: NOTE,
      ticketRef: undefined,
    });
  });

  it("a request already waiting is not sent again", () => {
    open("repropose", {
      waiting: { id: "apr-1", action: "slash.repropose" } as OperatorApproval,
    });
    expect(screen.getByText(/already waiting for approval/)).toBeTruthy();
    const button = submitButton(/Send for approval/) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(service.reproposeCase).not.toHaveBeenCalled();
  });
});
