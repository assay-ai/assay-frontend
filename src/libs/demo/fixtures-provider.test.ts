import { afterEach, describe, expect, it, vi } from "vitest";

type Fixtures = typeof import("./fixtures-provider");

/** A Storage stand-in: what a browser tab's sessionStorage does, in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

async function load(): Promise<Fixtures> {
  vi.resetModules();
  // `fixtures.ts` owns the constants the provider fixtures read; load it first, as the app does.
  await import("./fixtures");
  return import("./fixtures-provider");
}

function call(fixtures: Fixtures, method: string, path: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  const found = fixtures.PROVIDER_FIXTURES.find(
    (f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  if (!found) throw new Error(`no fixture for ${method} ${path}`);
  return found.body(path, {}, data) as Record<string, unknown>;
}

const FX = "/providers/me/tool-bindings/c3a91e57-64b2-4f8d-9c15-7e0a3b6d2f49";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo listing Settings: free calls per day", () => {
  it("echoes a saved freeDailyBudget and keeps it for the tab, so the box does not snap back", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage, localStorage: memoryStorage(), location: { search: "" } });
    let fixtures = await load();
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBe(5000);

    expect(call(fixtures, "PATCH", FX, { freeDailyBudget: 50 }).freeDailyBudget).toBe(50);
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBe(50);

    // A reload in the same tab still reads it.
    fixtures = await load();
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBe(50);

    // Emptied: back to the platform default.
    expect(call(fixtures, "PATCH", FX, { freeDailyBudget: null }).freeDailyBudget).toBeNull();
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBeNull();
  });

  it("leaves it alone when the save does not send it", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage(), location: { search: "" } });
    const fixtures = await load();
    expect(call(fixtures, "PATCH", FX, { slaFailureRate: 0.03 }).freeDailyBudget).toBe(5000);
  });
});

describe("demo listing Settings: free calls per agent", () => {
  it("keeps a saved freeQuotaPerAgent for the tab next to the all-agents value", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage(), location: { search: "" } });
    let fixtures = await load();
    expect(call(fixtures, "GET", FX).freeQuotaPerAgent).toBe(50);

    const saved = call(fixtures, "PATCH", FX, { freeQuotaPerAgent: 30, freeDailyBudget: 400 });
    expect(saved.freeQuotaPerAgent).toBe(30);
    expect(saved.freeDailyBudget).toBe(400);

    // A reload in the same tab still reads both.
    fixtures = await load();
    expect(call(fixtures, "GET", FX).freeQuotaPerAgent).toBe(30);
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBe(400);

    // Saving only the all-agents value later leaves the per-agent one as saved.
    call(fixtures, "PATCH", FX, { freeDailyBudget: 600 });
    fixtures = await load();
    expect(call(fixtures, "GET", FX).freeQuotaPerAgent).toBe(30);
    expect(call(fixtures, "GET", FX).freeDailyBudget).toBe(600);
  });
});

describe("demo listing Settings: pricing mode and price", () => {
  // final3 Chrome check: the mode went back to Paid after a save and a reload.
  it("keeps a saved pricing mode and price for the tab", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage(), location: { search: "" } });
    let fixtures = await load();
    expect(call(fixtures, "GET", FX).pricingMode).toBe("FREEMIUM");

    call(fixtures, "PATCH", FX, { pricingMode: "PAID", priceAmount: "150000" });
    fixtures = await load();
    const after = call(fixtures, "GET", FX);
    expect(after.pricingMode).toBe("PAID");
    expect((after.price as { amount: string }).amount).toBe("150000");
  });
});

describe("demo contract versions (T3)", () => {
  const WEATHER = "/providers/me/tool-bindings/f2c84d19-3b6e-4a07-9d51-8e2f0a7c4b63";
  const stub = () => vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage(), location: { search: "" } });

  it("gives every catalogue tool its versions, and the weather tool 1.x deprecated with 2.0.0 current", async () => {
    stub();
    const fixtures = await load();
    const { tools } = call(fixtures, "GET", "/providers/me/tool-bindings/catalogue") as {
      tools: { id: string; currentVersion: string | null; versions: { semver: string; status: string; major: number }[] }[];
    };
    for (const tool of tools) expect(tool.versions.length).toBeGreaterThan(0);
    const weather = tools.find((t) => t.id === "weather-now")!;
    expect(weather.currentVersion).toBe("2.0.0");
    expect(weather.versions.filter((v) => v.major === 1).every((v) => v.status === "DEPRECATED")).toBe(true);
  });

  it("serves the weather draft on ^1 only, with its extra fields", async () => {
    stub();
    const fixtures = await load();
    expect(call(fixtures, "GET", WEATHER)).toMatchObject({
      toolVersionRange: "^1",
      providesOutputFields: ["uv_index"],
      supportsInputFields: ["units"],
    });
    expect(call(fixtures, "GET", `${WEATHER}/publish-check`).publishable).toBe(true);
  });

  it("asks for API key headers when the mode needs them and none are stored", async () => {
    stub();
    const fixtures = await load();
    call(fixtures, "PATCH", WEATHER, { authMode: "API_KEY" });
    const check = call(fixtures, "GET", `${WEATHER}/publish-check`) as {
      publishable: boolean;
      requirements: { requirement: string; met: boolean; code: string | null }[];
    };
    expect(check.publishable).toBe(false);
    expect(check.requirements.find((r) => r.requirement === "API_KEY_CREDENTIALS")).toMatchObject({
      met: false,
      code: "credentials_missing_for_origin",
    });
  });

  it("asks for a test of v2 once it is added, and passes after one", async () => {
    stub();
    const fixtures = await load();
    expect(call(fixtures, "PATCH", WEATHER, { toolVersionRange: "^1 || ^2" }).toolVersionRange).toBe("^1 || ^2");
    let check = call(fixtures, "GET", `${WEATHER}/publish-check`) as { publishable: boolean; requirements: { met: boolean; detail: string }[] };
    expect(check.publishable).toBe(false);
    expect(check.requirements.filter((r) => !r.met).map((r) => r.detail.slice(0, 13))).toEqual(["Contract v1: ", "Contract v2: ", "Contract v1: ", "Contract v2: "]);

    expect(call(fixtures, "POST", `${WEATHER}/test`, { input: {}, toolVersion: 3 })).toMatchObject({ toolVersion: 3, toolVersionSemver: "2.0.0" });
    expect(call(fixtures, "POST", `${WEATHER}/test`, { input: {}, toolVersion: 2 })).toMatchObject({ toolVersionSemver: "1.1.0" });
    check = call(fixtures, "GET", `${WEATHER}/publish-check`) as typeof check;
    expect(check.publishable).toBe(true);
  });

  it("refuses a range or a field the contract does not have, as the backend does", async () => {
    stub();
    const fixtures = await load();
    const thrown = (data: Record<string, unknown>) => {
      try {
        call(fixtures, "PATCH", WEATHER, data);
      } catch (error) {
        return error as { code: string; context: unknown };
      }
      return null;
    };
    expect(thrown({ toolVersionRange: "^3" })).toMatchObject({
      code: "PROVIDER_BINDING_CONTRACT_MISMATCH",
      context: { problems: expect.arrayContaining(["contract v3 has no published version to serve"]) },
    });
    expect(thrown({ providesOutputFields: ["pm10"] })?.context).toEqual({ problems: ['"pm10" is not an optional output of the contract in ^1'] });
  });
});
