import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const getBalances = vi.fn();
vi.mock("./api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("./balances.service", () => ({ getBalances: () => getBalances() }));

const SOL = "solana:EtWT/token:4zMM";
const EVM = "eip155:46630/erc20:0xDbbC";
const window_ = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

async function load() {
  vi.resetModules();
  return import("./receipts.service");
}

describe("getReceiptsSummary — the asset of a multi-asset buyer", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({});
    getBalances.mockReset();
  });

  it("names the first asset held when the buyer holds two (BUG-R2-B1-01)", async () => {
    getBalances.mockResolvedValue({ balances: [{ asset: SOL }, { asset: EVM }] });
    const { getReceiptsSummary } = await load();

    await getReceiptsSummary({ ...window_, groupBy: "tool" });

    expect(get).toHaveBeenCalledWith("/receipts/summary", {
      ...window_,
      groupBy: "tool",
      asset: SOL,
    });
  });

  it("names none for a one-asset buyer, and never overrides the caller's own", async () => {
    getBalances.mockResolvedValue({ balances: [{ asset: SOL }] });
    const { getReceiptsSummary } = await load();

    await getReceiptsSummary(window_);
    expect(get).toHaveBeenLastCalledWith("/receipts/summary", window_);

    await getReceiptsSummary({ ...window_, asset: EVM });
    expect(get).toHaveBeenLastCalledWith("/receipts/summary", { ...window_, asset: EVM });
  });
});
