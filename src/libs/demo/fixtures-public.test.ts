import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notChargedSplit } from "@/features/explorer/explorer-text";
import type { CatalogueTool } from "@/services/catalogue.service";
import type { PublicNotCharged, PublicProviderDetail, PublicTool } from "@/services/public-explorer.service";

import { demoResponse } from "./demo-api";

/*
  The demo's public catalogue and the demo provider console describe one
  market (review 2026-10-17 sync 2): "How buyers see it / you" must open real
  rows, and the not-charged feed must agree with the provider pages.
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

describe("demo: the provider console's public links resolve", () => {
  it("opens the signed-in provider's public page, with every live listing on it", () => {
    const { registration } = get<{ registration: { id: string; legalName: string } }>("/providers/me/registration");
    const detail = get<PublicProviderDetail | undefined>(`/public/catalogue/providers/${registration.id}`);
    expect(detail?.name).toBe(registration.legalName);

    const { items } = get<{ items: { toolId: string; status: string }[] }>("/providers/me/tool-bindings");
    const live = items.filter((b) => b.status === "ACTIVE").map((b) => b.toolId);
    expect(live.length).toBeGreaterThan(0);
    expect([...(detail?.toolIds ?? [])].sort()).toEqual([...live].sort());
  });

  it("finds every live listing's tool on the public catalogue, and no draft", () => {
    const { tools } = get<{ tools: PublicTool[] }>("/public/catalogue/tools");
    const ids = new Set(tools.map((t) => t.id));
    const { items } = get<{ items: { toolId: string; status: string }[] }>("/providers/me/tool-bindings");
    for (const binding of items) {
      expect(ids.has(binding.toolId)).toBe(binding.status === "ACTIVE");
    }
  });
});

describe("demo: the public not-charged record", () => {
  const feed = () => get<PublicNotCharged>("/public/not-charged");

  it("prices each row at the provider that served it, as the backend DTO does", () => {
    const { providers } = get<{ providers: { providerId: string; name: string }[] }>("/public/catalogue/providers");
    const rows = feed().recent;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const provider = providers.find((p) => p.name === row.providerName);
      const detail = get<PublicProviderDetail>(`/public/catalogue/providers/${provider!.providerId}`);
      const listing = detail.tools.find((t) => t.toolId === row.toolId);
      expect(listing, `${row.toolName} by ${row.providerName}`).toBeDefined();
      expect(row.price).toEqual(listing!.price);
    }
    const helios = rows.find((r) => r.toolName === "search_web" && r.providerName === "Helios Data Labs");
    expect(helios?.price.amount).toBe("11000"); // $0.011, Helios's own price — not the $0.012 held
  });

  it("uses the signed-in catalogue's tool ids, and gives most paid tools rows of their own", () => {
    const { tools } = get<{ tools: CatalogueTool[] }>("/catalogue/tools");
    const ids = new Set(tools.map((t) => t.id));
    const rows = feed().recent;
    for (const row of rows) expect(ids.has(row.toolId)).toBe(true);
    const paid = tools.filter((t) => t.routable && t.pricingMode !== "FREE" && t.pricingMode !== "FREEMIUM");
    const covered = paid.filter((t) => rows.some((r) => r.toolId === t.id));
    expect(covered.length / paid.length).toBeGreaterThanOrEqual(0.8);
  });

  it("adds up: named reasons are rounded down to tens and the rest holds the remainders", () => {
    const { totals } = feed();
    for (const r of totals.notChargedByReason ?? []) expect(r.calls % 10).toBe(0);
    const lines = notChargedSplit(totals);
    expect(lines.reduce((sum, l) => sum + l.calls, 0)).toBe(totals.callsNotCharged);
    expect(lines.at(-1)?.label).toMatch(/remainders/);
  });
});
