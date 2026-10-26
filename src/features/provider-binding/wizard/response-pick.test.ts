import { describe, expect, it } from "vitest";

import { answerNodes, canPickInto, jsonPathFor, pickedPath, pickInto, sampleAnswer } from "./response-pick";

describe("jsonPathFor", () => {
  it("spells members, odd keys and indexes in the backend dialect", () => {
    expect(jsonPathFor(["rates", "EUR"])).toBe("$.rates.EUR");
    expect(jsonPathFor(["items", 0, "name"])).toBe("$.items[0].name");
    expect(jsonPathFor(["a b"])).toBe("$['a b']");
    expect(jsonPathFor(["it's"])).toBe('$["it\'s"]');
    expect(jsonPathFor(["a.b"])).toBe("$['a.b']");
  });

  it("refuses a key the dialect cannot spell", () => {
    expect(jsonPathFor(["x]"])).toBeNull();
  });
});

describe("sampleAnswer", () => {
  const report = (rawBody: string | null, rawBodyTruncated = false) => ({
    upstream: { status: 200, latencyMs: 1, rawBody, rawBodyTruncated, contentType: "application/json", transportError: null },
  });

  it("parses the real answer of the test call", () => {
    expect(sampleAnswer(report('{"rates":{"EUR":0.92}}'))).toEqual({ rates: { EUR: 0.92 } });
  });

  it("shows nothing for a cut-off, non-JSON or missing answer", () => {
    expect(sampleAnswer(report('{"rates":', true))).toBeNull();
    expect(sampleAnswer(report("<html>"))).toBeNull();
    expect(sampleAnswer(report("42"))).toBeNull();
    expect(sampleAnswer(null)).toBeNull();
  });
});

describe("picking a value", () => {
  it("writes a canonical $path leaf and keeps the other fields", () => {
    const next = pickInto({ rate: { $path: "$.rate" }, publishedFor: { $path: "$.publishedFor" } }, "rate", "$.rates.EUR");
    expect(next).toEqual({ rate: { $path: "$.rates.EUR" }, publishedFor: { $path: "$.publishedFor" } });
    expect(pickedPath(next, "rate")).toBe("$.rates.EUR");
  });

  it("keeps a leaf's options and moves only its path", () => {
    expect(pickInto({ rate: { $path: "$.rate", $optional: true } }, "rate", "$.r")).toEqual({ rate: { $path: "$.r", $optional: true } });
  });

  it("does not pick into a $from projection", () => {
    expect(canPickInto({ $from: "$.items", $item: {} })).toBe(false);
    expect(canPickInto({ rate: { $path: "$.rate" } })).toBe(true);
  });
});

describe("answerNodes", () => {
  it("flattens the answer with a path per row", () => {
    const nodes = answerNodes({ base: "USD", rates: { EUR: 0.92 }, list: [1, 2] });
    expect(nodes.map((node) => [node.path, node.preview, node.depth])).toEqual([
      ["$.base", '"USD"', 0],
      ["$.rates", "1 field", 0],
      ["$.rates.EUR", "0.92", 1],
      ["$.list", "list of 2", 0],
      ["$.list[0]", "1", 1],
      ["$.list[1]", "2", 1],
    ]);
  });
});
