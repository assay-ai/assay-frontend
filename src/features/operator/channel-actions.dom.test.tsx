// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const service = vi.hoisted(() => ({
  drainChannels: vi.fn(),
  claimUnpaidChannelPayouts: vi.fn(),
}));
vi.mock("@/services/operator.service", async (original) => ({ ...(await original<object>()), ...service }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/utils/toast", () => ({ toast }));

import {
  channelActionCopy,
  channelActionDone,
  channelActionErrors,
  ChannelActions,
  claimBody,
  drainBody,
  mayRunChannelActions,
} from "./channel-actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ASSET = "eip155:4663/erc20:0x1111111111111111111111111111111111111111";
const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const NOTE = "Issuer confirmed the freeze lifted, ticket OPS-77.";
const input = { assetId: ASSET, address: ADDRESS, reasonCode: "OTHER", note: NOTE, ticketRef: "" };

describe("channel overrides: rules (round-2 M-2, M-3)", () => {
  it("are for SRE and TRE only", () => {
    expect(mayRunChannelActions(["SRE"])).toBe(true);
    expect(mayRunChannelActions(["TRE"])).toBe(true);
    expect(mayRunChannelActions(["ADJL", "BD"])).toBe(false);
  });

  it("claim needs the asset and a 0x payout address; drain takes every asset when empty", () => {
    expect(channelActionErrors("claim", { ...input, assetId: " ", address: "0x12" })).toEqual({
      assetId: "Name the asset (CAIP-19).",
      address: "Enter the payout address: 0x and 40 hex characters.",
    });
    expect(channelActionErrors("drain", { ...input, assetId: "", address: "" })).toEqual({});
    expect(channelActionErrors("drain", { ...input, note: "too short" }).note).toMatch(/at least 20 characters/);
    expect(drainBody({ ...input, assetId: "  " })).toEqual({ reasonCode: "OTHER", note: NOTE });
    expect(claimBody({ ...input, ticketRef: " OPS-77 " })).toEqual({
      assetId: ASSET,
      address: ADDRESS,
      reasonCode: "OTHER",
      note: NOTE,
      ticketRef: "OPS-77",
    });
  });

  it("say what the scheduler does next", () => {
    expect(channelActionDone("drain", { assetId: null, channels: 3 })).toBe("3 channels are settled on the scheduler's next tick.");
    expect(channelActionDone("claim", { assetId: ASSET, address: ADDRESS.toLowerCase(), payouts: 0 })).toBe(
      "Nothing to claim for this address: no unpaid payout is recorded.",
    );
  });
});

describe("ChannelActions", () => {
  it("draws nothing for a role without the overrides", () => {
    const { container } = render(<ChannelActions roles={["ADJL"]} assetId={ASSET} />);
    expect(container.innerHTML).toBe("");
  });

  it("sends the claim only after the confirmation, once, with the reason and note", async () => {
    service.claimUnpaidChannelPayouts.mockResolvedValue({ assetId: ASSET, address: ADDRESS.toLowerCase(), payouts: 2 });
    render(<ChannelActions roles={["SRE"]} assetId={ASSET} />);
    expect(screen.getByRole("button", { name: "Settle all providers' channels" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim unpaid payouts" }));
    const submit = screen.getByRole("button", { name: "Claim payouts" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // The asset is prefilled from the provider's pending asset.
    expect((screen.getByDisplayValue(ASSET) as HTMLInputElement).value).toBe(ASSET);
    fireEvent.change(screen.getByPlaceholderText("0x…"), { target: { value: ADDRESS } });
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(service.claimUnpaidChannelPayouts).toHaveBeenCalledTimes(1);
    expect(service.claimUnpaidChannelPayouts).toHaveBeenCalledWith({
      assetId: ASSET,
      address: ADDRESS,
      reasonCode: "ISSUER_FREEZE_LIFTED",
      note: NOTE,
    });
    expect(toast.success.mock.calls[0]![1]).toEqual({ description: "2 unpaid payouts are claimed on the scheduler's next tick." });
  });

  it("L-5: the drain says it is every provider's, not this one's; the claim prefills this provider's payout address", () => {
    const copy = channelActionCopy("drain");
    expect(copy.button).toBe("Settle all providers' channels");
    expect(copy.title).toContain("every provider");
    expect(copy.lines[0]).toContain("not limited to this provider");
    expect(copy.confirm).toContain("not only this provider's");
    render(<ChannelActions roles={["SRE"]} assetId={ASSET} payoutAddress={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Claim unpaid payouts" }));
    expect((screen.getByPlaceholderText("0x…") as HTMLInputElement).value).toBe(ADDRESS);
  });

  it("drains with the same pattern and shows the backend's refusal in words", async () => {
    service.drainChannels.mockRejectedValue(new ApiError("OPERATOR_ROLE_REQUIRED", "x", 403));
    render(<ChannelActions roles={["TRE"]} assetId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Settle all providers' channels" }));
    fireEvent.change(screen.getByPlaceholderText(/Why now/), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Settle channels" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Your roles do not allow this action."));
    expect(service.drainChannels).toHaveBeenCalledWith({ reasonCode: "INCIDENT", note: NOTE });
  });
});
