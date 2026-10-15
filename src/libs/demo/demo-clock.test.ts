import { afterEach, describe, expect, it, vi } from "vitest";

/*
  Provider review 2026-10-16b: a demo penalty deadline read 21:00, then 22:00
  after a reload across an hour boundary, and window dates moved with each
  load. Every demo fixture now counts from one session clock.
*/
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

async function reload() {
  vi.resetModules();
  const clock = await import("./demo-clock");
  const penalties = await import("./demo-penalties");
  const fixtures = await import("./fixtures");
  return { clock, penalties, fixtures };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the demo clock", () => {
  it("keeps every demo date still across reloads and hour boundaries", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
    vi.useFakeTimers({ now: Date.parse("2026-10-16T17:59:30Z") });
    const first = await reload();
    const deadline = first.penalties.demoPenaltyTime(3120);
    const windowDate = first.fixtures.minutesAgo(5000);

    // Twenty minutes on, across 18:00: a reload reads the same instants.
    vi.setSystemTime(Date.parse("2026-10-16T18:19:30Z"));
    const later = await reload();
    expect(later.clock.DEMO_NOW_MS).toBe(first.clock.DEMO_NOW_MS);
    expect(later.penalties.demoPenaltyTime(3120)).toBe(deadline);
    expect(later.fixtures.minutesAgo(5000)).toBe(windowDate);
  });

  it("is the penalty anchor, so chain rows and cases agree", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
    const { clock, penalties } = await reload();
    expect(penalties.DEMO_PENALTY_ANCHOR_SECONDS * 1000).toBe(clock.DEMO_NOW_MS);
  });

  it("starts over once a session is older than six hours", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
    vi.useFakeTimers({ now: Date.parse("2026-10-16T10:00:00Z") });
    const first = await reload();
    vi.setSystemTime(first.clock.DEMO_NOW_MS + first.clock.DEMO_CLOCK_MAX_AGE_MS + 60_000);
    const later = await reload();
    expect(later.clock.DEMO_NOW_MS).toBeGreaterThan(first.clock.DEMO_NOW_MS);
  });

  it("works without storage (build, tests)", () => {
    return reload().then(({ clock }) => {
      expect(clock.readDemoClock(Date.parse("2026-10-16T10:00:42Z"))).toBe(Date.parse("2026-10-16T10:00:00Z"));
    });
  });

  it("gives a click its real time", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-16T12:34:56Z") });
    const { fixtures } = await reload();
    expect(fixtures.justNow()).toBe("2026-10-16T12:34:56.000Z");
  });
});
