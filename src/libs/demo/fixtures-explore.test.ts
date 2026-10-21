import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueProvider, CatalogueProviderDetail } from "@/services/catalogue.service";

import { demoResponse } from "./demo-api";
import { DEMO_CHAIN_ID } from "./fixtures";

/*
  B16: the providers list and the tool-set provider picker read `chains` and
  `servesYou`. The demo has one chain, and the demo buyer's agent pays on it.
*/

const prevFlag = process.env.NEXT_PUBLIC_DEMO_CHAINS;
const tab = { location: { search: "" }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
  vi.stubGlobal("window", tab);
});
afterEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = prevFlag;
  vi.unstubAllGlobals();
});

const get = <T,>(path: string) => demoResponse("GET", path) as T;

describe("demo: which provider serves you", () => {
  it("every listed provider and listing takes payment on the demo chain and serves the demo buyer", () => {
    const { providers } = get<{ providers: CatalogueProvider[] }>("/catalogue/providers");
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(provider.chains).toEqual(provider.toolIds.length > 0 ? [DEMO_CHAIN_ID] : []);
      expect(provider.servesYou).toBe(provider.toolIds.length > 0);

      const detail = get<CatalogueProviderDetail>(`/catalogue/providers/${provider.providerId}`);
      expect(detail.servesYou).toBe(provider.servesYou);
      for (const tool of detail.tools) expect(tool).toMatchObject({ chains: [DEMO_CHAIN_ID], servesYou: true });
    }
  });
});
