import { describe, expect, it } from "vitest";

import { AGENT_LABEL_MAX, agentLabelError, keyOfAgent, nextKeyName } from "./agent-label";

describe("agentLabelError — the same rule as PATCH /agents/:id", () => {
  it("accepts a plain name, trimmed", () => {
    expect(agentLabelError("  Research bot ")).toBeNull();
    expect(agentLabelError("Mia's agent (laptop) — Zoë")).toBeNull();
    expect(agentLabelError("a".repeat(AGENT_LABEL_MAX))).toBeNull();
    // Counted by code point, like the server: 64 emoji fit.
    expect(agentLabelError("\u{1F916}".repeat(AGENT_LABEL_MAX))).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["too long", "a".repeat(AGENT_LABEL_MAX + 1)],
    ["a newline", "a\nb"],
    ["a tab", "a\tb"],
    ["a bidi override", "agent\u202Etxt"],
    ["a zero-width joiner", "a\u200Db"],
    ["only a Hangul filler", "\u3164"],
    ["only a Braille blank", "\u2800\u2800"],
    ["only combining marks", "\u034F\u0301"],
  ])("refuses %s", (_name, label) => {
    expect(agentLabelError(label)).not.toBeNull();
  });
});

describe("key names", () => {
  it("names a key with its agent", () => {
    expect(keyOfAgent("e2e-agent", "My agent")).toBe("key “e2e-agent” of My agent");
    expect(keyOfAgent("laptop", null)).toBe("key “laptop”");
  });

  it("counts keys for the default name", () => {
    expect(nextKeyName(0)).toBe("Key 1");
    expect(nextKeyName(2)).toBe("Key 3");
  });
});
