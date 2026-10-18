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
  minTier: null,
  maxPriceAtomic: null,
  maxPriceAsset: USD("0").asset,
  onEmpty: "FAIL",
  ...over,
});

describe("servingStatus", () => {
  it("words the three states and stays silent when unknown", () => {
    expect(servingStatus({ chains: ["eip155:46630"], servesYou: true }).label).toBe("Serves you");
    expect(servingStatus({ chains: ["solana:devnet"], servesYou: false }).label).toBe("Doesn't take payment on your chain");
    expect(servingStatus({ chains: [], servesYou: false }).label).toBe("Not taking calls now");
    expect(servingStatus({ chains: null, servesYou: null })).toMatchObject({ kind: "unknown", label: "Can't check right now", tone: "neutral" });
    expect(servingStatus(undefined)).toMatchObject({ kind: "not-loaded", label: "" });
  });

  it("an unchecked provider (servesYou null) is never 'Not taking calls', even with no known chain", () => {
    expect(servingStatus({ chains: [], servesYou: null })).toMatchObject({ kind: "unknown", label: "Can't check right now" });
    expect(servingStatus({ chains: null, servesYou: false }).kind).toBe("other-chain");
  });
});

describe("keptByRule", () => {
  it("applies the mode, verified-only and the max price", () => {
    expect(keptByRule(rule({ providerMode: "ONLY", providerIds: ["meteo"] }), [E2E, METEO])).toEqual([METEO]);
    expect(keptByRule(rule({ providerMode: "EXCLUDE", providerIds: ["meteo"] }), [E2E, METEO])).toEqual([E2E]);
    expect(keptByRule(rule({ minTier: "ESTABLISHED" }), [E2E, METEO])).toEqual([METEO]);
    expect(keptByRule(rule({ minTier: "TRUSTED" }), [E2E, METEO])).toEqual([]);
    expect(keptByRule(rule({ maxPriceAtomic: "200000" }), [E2E, METEO])).toEqual([E2E]);
  });

  it("never compares a max price across assets", () => {
    const solanaPriced = { ...METEO, price: { amount: "250000", asset: "solana:devnet/token:usdc", decimals: 6 } };
    expect(keptByRule(rule({ maxPriceAtomic: "200000" }), [E2E, solanaPriced])).toEqual([E2E, solanaPriced]);
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
    expect(nothingRunsWarning(rule({ minTier: "ESTABLISHED", maxPriceAtomic: "1" }), [E2E, METEO], "get_weather")).toMatch(/^No provider is left under this rule/);
  });

  it("is silent when something serves you, or when Assay may fall back to one that does", () => {
    expect(nothingRunsWarning(rule(), [E2E, METEO], "get_weather")).toBeNull();
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"], onEmpty: "FALLBACK_BEST" }), [E2E, METEO], "get_weather")).toBeNull();
  });

  it("never warns on missing data", () => {
    const unloaded = { ...METEO, chains: undefined, servesYou: undefined };
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"] }), [E2E, unloaded], "get_weather")).toBeNull();
    const unchecked = { ...METEO, chains: null, servesYou: null };
    expect(nothingRunsWarning(rule({ providerMode: "ONLY", providerIds: ["meteo"] }), [E2E, unchecked], "get_weather")).toBeNull();
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
    expect(chainsText({ chains: ["solana:devnet"], servesYou: false }, name)).toBe("Takes payment on Solana devnet");
    expect(chainsText({ chains: ["eip155:46630", "solana:devnet"], servesYou: true }, name)).toBe("Takes payment on Robinhood Chain testnet and Solana devnet");
    expect(chainsText({ chains: [], servesYou: false }, name)).toBe("Takes no calls right now");
    expect(chainsText({ chains: null, servesYou: null }, name)).toBeNull();
    // Unchecked: no "takes no calls" claim.
    expect(chainsText({ chains: [], servesYou: null }, name)).toBeNull();
  });
});

describe("every agent withdrawing (n4)", () => {
  const off = (offer: ProviderOffer): ProviderOffer => ({ ...offer, servesYou: false, notServedReason: "WITHDRAWING" });
  it("names the withdrawal, not the chain, on the chip and in the warning", () => {
    expect(servingStatus(off(E2E))).toMatchObject({ kind: "withdrawing", label: "Not while you're withdrawing" });
    const text = nothingRunsWarning(rule(), [off(E2E), off(METEO)], "get_weather");
    expect(text).toContain("withdrawal pending");
    expect(text).not.toContain("your chain");
  });
});
