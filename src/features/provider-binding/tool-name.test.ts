import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bindingLabelOf } from "./tool-name";

describe("a listing's name", () => {
  it("is the tool's name", () => {
    expect(bindingLabelOf("Market quote", false)).toBe("Market quote");
  });

  it("is never the endpoint: … while loading, then Unknown tool", () => {
    expect(bindingLabelOf(null, true)).toBe("…");
    expect(bindingLabelOf(null, false)).toBe("Unknown tool");
  });

  it("says a draft's tool was removed when the catalogue no longer has it (V1-9)", () => {
    expect(bindingLabelOf(null, false, "DRAFT", true)).toBe("Removed tool (draft)");
    // A failed catalogue read proves nothing was removed (review I2).
    expect(bindingLabelOf(null, false, "DRAFT", false)).toBe("Unknown tool");
    expect(bindingLabelOf(null, false, "DRAFT")).toBe("Unknown tool");
    expect(bindingLabelOf(null, true, "DRAFT")).toBe("…");
    expect(bindingLabelOf(null, false, "PAUSED", true)).toBe("Unknown tool");
    expect(bindingLabelOf("get_weather", false, "DRAFT")).toBe("get_weather");
  });
});

describe("no address on a listing outside Settings → Connection", () => {
  const SRC = join(__dirname, "../..");
  it.each([
    "app/(console)/provider/bindings/page.tsx",
    "features/provider-binding/binding-header.tsx",
    "features/provider-binding/tool-name.tsx",
    "app/(console)/provider/policy-changes/page.tsx",
    "app/(console)/provider/page.tsx",
    "app/(console)/layout.tsx",
  ])("%s renders no endpoint", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).not.toMatch(/\.endpoint\b|labelForEndpoint|new URL\(/);
  });
});
