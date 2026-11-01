// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const service = vi.hoisted(() => ({
  drainChannels: vi.fn(),
  claimUnpaidChannelPayouts: vi.fn(),
  clearChannelReconcileStop: vi.fn(),
  listStoppedChannels: vi.fn(),
}));
vi.mock("@/services/operator.service", async (original) => ({ ...(await original<object>()), ...service }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/utils/toast", () => ({ toast }));

import { channelActionCopy, channelActionErrors, channelActionErrorSentence, clearBody } from "./channel-actions";
import { operatorNavFor } from "./nav";
import { PlatformChannelsCard, stoppedChannelPayer } from "./platform-channels";

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  service.listStoppedChannels.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROW = "3f2b8c1e-5d4a-4f6b-9a7c-0e1d2c3b4a59";
const NOTE = "Found the foreign settle tx, chain agrees again (OPS-91).";
const STOPPED = {
  channelRowId: ROW,
  channelKey: `0x${"0c".repeat(32)}`,
  chainId: "eip155:46630",
  assetId: "eip155:46630/erc20:0x7E99000000000000000000000000000000021ac0",
  providerId: "28e57af8-0000-4000-8000-2b9a5f0f7a11",
  payer: "eip155:46630:0x1111111111111111111111111111111111111111",
  stoppedAt: "2026-11-01T14:10:00.000Z",
  reason: "RECONCILE",
  accepted: "500",
  settled: "300",
};
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
  it("shows no buttons to a role without the overrides, only who can", async () => {
    service.listStoppedChannels.mockResolvedValue([STOPPED]);
    render(<PlatformChannelsCard roles={["OPS_ADMIN"]} />);
    // OPS_ADMIN may read the list, not clear.
    await waitFor(() => expect(screen.getAllByTestId("stopped-channel")).toHaveLength(1));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/need the Support \/ on-call or Treasury role/)).toBeTruthy();
  });

  it("asks nothing for a role that may not read the list", () => {
    render(<PlatformChannelsCard roles={["ADJ"]} />);
    expect(service.listStoppedChannels).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stopped-channels")).toBeNull();
  });

  it("says 'No stopped channels' when the list is empty, with no row-id input", async () => {
    service.listStoppedChannels.mockResolvedValue([]);
    render(<PlatformChannelsCard roles={["SRE"]} />);
    await waitFor(() => expect(screen.getByText("No stopped channels.")).toBeTruthy());
    expect(screen.queryByPlaceholderText("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear reconcile stop" })).toBeNull();
  });

  it("lists each stopped lane with its own clear, which sends that row id and reads the list again", async () => {
    service.listStoppedChannels.mockResolvedValue([STOPPED]);
    service.clearChannelReconcileStop.mockResolvedValue({ channelRowId: ROW, status: "ROTATED" });
    render(<PlatformChannelsCard roles={["SRE"]} />);
    const row = await screen.findByTestId("stopped-channel");
    expect(row.textContent).toContain("Channel 0x0c0c0c0c…0c0c");
    expect(row.textContent).toContain("Provider 28e57af8…7a11");
    expect(row.textContent).toContain(`payer ${stoppedChannelPayer(STOPPED)}`);
    expect(row.textContent).toMatch(/stopped .*14:10 UTC · RECONCILE/);
    expect(screen.queryByPlaceholderText("00000000-0000-0000-0000-000000000000")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear reconcile stop" }));
    const sheet = screen.getByTestId("channel-action-clear");
    expect((sheet.querySelector(`input[value="${ROW}"]`) as HTMLInputElement | null)?.value).toBe(ROW);
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Clear the stop" }));
    await waitFor(() => expect(service.clearChannelReconcileStop).toHaveBeenCalledWith({ channelRowId: ROW, reasonCode: "INVESTIGATED", note: NOTE }));
    await waitFor(() => expect(service.listStoppedChannels).toHaveBeenCalledTimes(2));
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

  it("only when the list cannot be read: keeps the clear disabled until a row id is entered, then sends it", async () => {
    service.listStoppedChannels.mockRejectedValue(new ApiError("INTERNAL", "x", 503));
    service.clearChannelReconcileStop.mockResolvedValue({ channelRowId: ROW, status: "ROTATED" });
    render(<PlatformChannelsCard roles={["TRE"]} />);
    await waitFor(() => expect(screen.getByText(/The list of stopped channels could not be read/)).toBeTruthy());
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
