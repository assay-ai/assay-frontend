import { describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ state: "OK" }),
}));
vi.mock("./public-api", () => ({ publicApi: { get } }));
import { getProtocolAnalytics } from "./protocol-analytics.service";

describe("public protocol analytics service", () => {
  it("uses the unauthenticated public client and sends only the selected range and asset", async () => {
    await getProtocolAnalytics("7d");
    expect(get).toHaveBeenLastCalledWith("/public/analytics", { range: "7d" });
    await getProtocolAnalytics("all", "eip155:46630/erc20:token");
    expect(get).toHaveBeenLastCalledWith("/public/analytics", {
      range: "all",
      asset: "eip155:46630/erc20:token",
    });
  });
});
