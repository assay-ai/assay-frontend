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
