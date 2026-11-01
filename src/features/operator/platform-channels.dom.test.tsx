// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const service = vi.hoisted(() => ({
  drainChannels: vi.fn(),
  claimUnpaidChannelPayouts: vi.fn(),
  clearChannelReconcileStop: vi.fn(),
}));
vi.mock("@/services/operator.service", async (original) => ({ ...(await original<object>()), ...service }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/utils/toast", () => ({ toast }));

import { channelActionCopy, channelActionErrors, channelActionErrorSentence, clearBody } from "./channel-actions";
import { operatorNavFor } from "./nav";
import { PlatformChannelsCard } from "./platform-channels";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROW = "3f2b8c1e-5d4a-4f6b-9a7c-0e1d2c3b4a59";
const NOTE = "Found the foreign settle tx, chain agrees again (OPS-91).";
const input = { assetId: "", address: "", channelRowId: ROW, reasonCode: "INVESTIGATED", note: NOTE, ticketRef: "" };

describe("platform channel overrides (BUG-R2-OPS-01)", () => {
  it("the clear needs a UUID row id and a 20-character note", () => {
    expect(channelActionErrors("clear", input)).toEqual({});
    expect(channelActionErrors("clear", { ...input, channelRowId: "0xabc" }).channelRowId).toBe("Enter the channel's row id (a UUID).");
    expect(channelActionErrors("clear", { ...input, note: "short note" }).note).toMatch(/at least 20 characters/);
    expect(clearBody({ ...input, channelRowId: ` ${ROW} `, ticketRef: " OPS-91 " })).toEqual({
      channelRowId: ROW,
      reasonCode: "INVESTIGATED",
      note: NOTE,
      ticketRef: "OPS-91",
    });
  });

  it("the platform drain does not speak of 'this provider'", () => {
    const copy = channelActionCopy("drain", "platform");
    expect(copy.button).toBe("Settle all providers' channels");
    expect([copy.title, ...copy.lines, copy.confirm].join(" ")).not.toContain("this provider");
  });

  it("a refused clear says the backend's reason", () => {
    const error = new ApiError("OPERATOR_CHANNEL_CLEAR_REFUSED", "x", 409, undefined, {
      detail: "the channel is OPEN/-, not DESYNC/RECONCILE",
    });
    expect(channelActionErrorSentence(error)).toBe("The stop was not cleared: the channel is OPEN/-, not DESYNC/RECONCILE.");
  });

  it("Contracts is in the nav of SRE and TRE, not of other non-admin roles", () => {
    expect(operatorNavFor(["SRE"]).some((item) => item.id === "contracts")).toBe(true);
    expect(operatorNavFor(["TRE"]).some((item) => item.id === "contracts")).toBe(true);
    expect(operatorNavFor(["ADJ"]).some((item) => item.id === "contracts")).toBe(false);
  });
});

describe("PlatformChannelsCard", () => {
  it("shows no buttons to a role without the overrides, only who can", () => {
    render(<PlatformChannelsCard roles={["OPS_ADMIN"]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/need the Support \/ on-call or Treasury role/)).toBeTruthy();
  });

  it("drains every asset from the platform card, after the confirmation and a long enough note", async () => {
    service.drainChannels.mockResolvedValue({ assetId: null, channels: 4 });
    render(<PlatformChannelsCard roles={["SRE"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Settle all providers' channels" }));
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: "too short" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Settle channels" }));
    await waitFor(() => expect(screen.getByText(/at least 20 characters/)).toBeTruthy());
    expect(service.drainChannels).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Settle channels" }));
    await waitFor(() => expect(service.drainChannels).toHaveBeenCalledWith({ reasonCode: "INCIDENT", note: NOTE }));
    expect(toast.success.mock.calls[0]![1]).toEqual({ description: "4 channels are settled on the scheduler's next tick." });
  });

  it("keeps the clear disabled until a row id is entered, then sends it", async () => {
    service.clearChannelReconcileStop.mockResolvedValue({ channelRowId: ROW, status: "ROTATED" });
    render(<PlatformChannelsCard roles={["TRE"]} />);
    const clear = screen.getByRole("button", { name: "Clear reconcile stop" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"), { target: { value: "not-a-uuid" } });
    expect(clear.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"), { target: { value: ROW } });
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    const sheet = screen.getByTestId("channel-action-clear");
    expect((sheet.querySelector(`input[value="${ROW}"]`) as HTMLInputElement | null)?.value).toBe(ROW);
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Clear the stop" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(service.clearChannelReconcileStop).toHaveBeenCalledWith({ channelRowId: ROW, reasonCode: "INVESTIGATED", note: NOTE });
  });
});
