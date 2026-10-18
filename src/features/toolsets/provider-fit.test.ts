import { describe, expect, it } from "vitest";

import { chainsText, keptByRule, nothingRunsWarning, servingStatus, type ProviderOffer, type RuleDraft } from "./provider-fit";

const USD = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0xusdg", decimals: 6 });

// The seed shape behind review F-P1: an EVM buyer, E2E Weather on its chain,
// Open-Meteo on Solana devnet only.
const E2E: ProviderOffer = { providerId: "e2e", name: "E2E Weather Ltd", tier: "NEW", price: USD("100000"), chains: ["eip155:46630"], servesYou: true };
const METEO: ProviderOffer = {
  providerId: "meteo",
  name: "Open-Meteo Demo BV",
  tier: "ESTABLISHED",
  price: USD("250000"),
  chains: ["solana:devnet"],
  servesYou: false,
};

const rule = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  providerMode: "BEST",
  providerIds: [],
  verifiedOnly: false,
  maxPriceAtomic: null,
  onEmpty: "FAIL",
  ...over,
});

describe("servingStatus", () => {
  it("words the three states and stays silent when unknown", () => {
    expect(servingStatus({ chains: ["eip155:46630"], servesYou: true }).label).toBe("Serves you");
    expect(servingStatus({ chains: ["solana:devnet"], servesYou: false }).label).toBe("Doesn't take payment on your chain");
    expect(servingStatus({ chains: [], servesYou: false }).label).toBe("Not taking calls now");
    expect(servingStatus({ chains: null, servesYou: null })).toMatchObject({ kind: "unknown", label: "" });
    expect(servingStatus(undefined).kind).toBe("unknown");
  });
});

describe("keptByRule", () => {
  it("applies the mode, verified-only and the max price", () => {
    expect(keptByRule(rule({ providerMode: "ONLY", providerIds: ["meteo"] }), [E2E, METEO])).toEqual([METEO]);
    expect(keptByRule(rule({ providerMode: "EXCLUDE", providerIds: ["meteo"] }), [E2E, METEO])).toEqual([E2E]);
    expect(keptByRule(rule({ verifiedOnly: true }), [E2E, METEO])).toEqual([METEO]);
    expect(keptByRule(rule({ maxPriceAtomic: "200000" }), [E2E, METEO])).toEqual([E2E]);
  });
});

describe("nothingRunsWarning", () => {
  it("flags Only Open-Meteo for an EVM buyer, naming the chain reason", () => {
    const text = nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"], maxPriceAtomic: "300000" }), [E2E, METEO], "get_weather");
    expect(text).toBe(
      "Nothing left can run for you: Open-Meteo Demo BV doesn't take payment on your chain. Every get_weather call from your agents would be refused (not charged).",
    );
  });

  it("says when a provider isn't taking calls at all", () => {
    const paused = { ...E2E, chains: [], servesYou: false };
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["e2e"] }), [paused, METEO], "get_weather")).toContain(
      "E2E Weather Ltd isn't taking calls now",
    );
  });

  it("says when the rule leaves no provider", () => {
    expect(nothingRunsWarning(rule({ verifiedOnly: true, maxPriceAtomic: "1" }), [E2E, METEO], "get_weather")).toMatch(/^No provider is left under this rule/);
  });

  it("is silent when something serves you, or when Assay may fall back to one that does", () => {
    expect(nothingRunsWarning(rule(), [E2E, METEO], "get_weather")).toBeNull();
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"], onEmpty: "FALLBACK_BEST" }), [E2E, METEO], "get_weather")).toBeNull();
  });

  it("never warns on missing data", () => {
    const unknown = { ...METEO, chains: undefined, servesYou: undefined };
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"] }), [E2E, unknown], "get_weather")).toBeNull();
    expect(nothingRunsWarning(rule(), [], "get_weather")).toBeNull();
  });

  it("warns under fallback only when nobody serves you", () => {
    const off = { ...E2E, servesYou: false };
    expect(nothingRunsWarning(rule({ onEmpty: "FALLBACK_BEST" }), [off, METEO], "get_weather")).toContain("Nothing left can run for you");
  });
});

describe("chainsText", () => {
  const name = (id: string) => ({ "solana:devnet": "Solana devnet", "eip155:46630": "Robinhood Chain testnet" })[id] ?? id;
  it("names chains, says when it takes no call, and stays silent when unknown", () => {
    expect(chainsText(["solana:devnet"], name)).toBe("Takes payment on Solana devnet");
    expect(chainsText(["eip155:46630", "solana:devnet"], name)).toBe("Takes payment on Robinhood Chain testnet and Solana devnet");
    expect(chainsText([], name)).toBe("Takes no calls right now");
    expect(chainsText(null, name)).toBeNull();
  });
});
