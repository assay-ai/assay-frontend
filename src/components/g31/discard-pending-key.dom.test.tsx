// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ discardPendingDelegate: vi.fn() }));
const discard = service.discardPendingDelegate;
vi.mock("@/services/account.service", () => service);
vi.mock("@/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ApiError } from "@/libs/ApiClient";

import { DISCARD_PENDING_STRINGS, DiscardPendingKey } from "./discard-pending-key";

function mount(onDiscarded: () => void) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DiscardPendingKey agentId="agt-1" credentialId="cred-1" onDiscarded={onDiscarded} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  discard.mockReset();
});
afterEach(cleanup);

describe("DiscardPendingKey", () => {
  it("asks once, then discards the waiting key and reads the list again", async () => {
    discard.mockResolvedValue(undefined);
    const onDiscarded = vi.fn();
    mount(onDiscarded);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByTestId("discard-pending-confirm").textContent).toContain(DISCARD_PENDING_STRINGS.confirm);
    expect(discard).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard key" }));
    });
    expect(discard).toHaveBeenCalledWith("agt-1", "cred-1");
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("discard-pending-confirm")).toBeNull();
  });

  it("Keep it discards nothing", () => {
    const onDiscarded = vi.fn();
    mount(onDiscarded);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(discard).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("a refusal reads in plain words and keeps the list as it is", async () => {
    discard.mockImplementation(async () => {
      throw new ApiError("ACCOUNT_CREDENTIAL_NOT_FOUND", "not found", 404);
    });
    const onDiscarded = vi.fn();
    mount(onDiscarded);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard key" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This key is no longer on this agent. Reload the page.");
    expect(onDiscarded).not.toHaveBeenCalled();
  });
});
