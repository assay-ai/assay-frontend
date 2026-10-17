import { describe, expect, it } from "vitest";
import {
  credentialHeaderProblems,
  credentialQueryKeys,
  isCredentialQueryKey,
  isSecretConstantHeader,
  originOf,
  splitHeaderLine,
} from "./rules";
import { rowProblem } from "../mapping-editor";

describe("credential query keys", () => {
  it("finds credential-like keys case-insensitively", () => {
    expect(credentialQueryKeys("https://x.test/v1?API_KEY=1&max_tokens=5")).toEqual(["API_KEY"]);
    expect(credentialQueryKeys("https://x.test/v1?Api-Key=1")).toEqual(["Api-Key"]);
    expect(credentialQueryKeys("https://x.test/v1?max_tokens=5")).toEqual([]);
    expect(credentialQueryKeys("not a url")).toEqual([]);
  });
  it("matches exactly", () => {
    expect(isCredentialQueryKey("token")).toBe(true);
    expect(isCredentialQueryKey("tokens")).toBe(false);
  });
});

describe("isSecretConstantHeader", () => {
  it("flags secret headers only", () => {
    expect(isSecretConstantHeader("Authorization")).toBe(true);
    expect(isSecretConstantHeader("x-sort-key")).toBe(false);
    expect(isSecretConstantHeader("idempotency-key")).toBe(false);
  });
});

describe("credentialHeaderProblems", () => {
  const h = (name: string, value = "v") => ({ name, value });
  it("accepts valid headers", () => {
    expect(credentialHeaderProblems([h("X-Key"), h("X-Other")]).size).toBe(0);
  });
  it("flags more than 10 rows", () => {
    const rows = Array.from({ length: 11 }, (_, i) => h(`X-H${i}`));
    expect(credentialHeaderProblems(rows).size).toBeGreaterThan(0);
  });
  it("flags reserved, colon, newline and duplicate rows by index", () => {
    const p = credentialHeaderProblems([
      h("Host"),
      h("X-Assay-Foo"),
      h("Authorization: Bearer x"),
      h("X-A", "a\nb"),
      h("X-Key"),
      h("x-key"),
    ]);
    expect([...p.keys()]).toEqual([0, 1, 2, 3, 5]);
  });
  it("flags long names and values by bytes", () => {
    expect(credentialHeaderProblems([h("a".repeat(65))]).has(0)).toBe(true);
    expect(credentialHeaderProblems([h("X-A", "a".repeat(4097))]).has(0)).toBe(true);
    expect(credentialHeaderProblems([h("X-A", "a".repeat(4096))]).has(0)).toBe(false);
  });
  it("allows printable ASCII with space and tab, and rejects the rest", () => {
    expect(credentialHeaderProblems([h("X-A", "Bearer a b\tc~")]).size).toBe(0);
    expect(credentialHeaderProblems([h("X-A", "caf\u00e9")]).get(0)).toBe("Use plain ASCII characters only.");
    expect(credentialHeaderProblems([h("X-A", "a\u0000b")]).get(0)).toBe("Use plain ASCII characters only.");
    expect(credentialHeaderProblems([h("X-A", "a\u007fb")]).get(0)).toBe("Use plain ASCII characters only.");
  });
});

describe("splitHeaderLine", () => {
  it("splits on the first colon", () => {
    expect(splitHeaderLine("Authorization: Bearer sk-1")).toEqual({ name: "Authorization", value: "Bearer sk-1" });
    expect(splitHeaderLine("nocolon")).toBeNull();
  });
  it("does not split a pasted URL or a non-token name", () => {
    expect(splitHeaderLine("https://api.example.com/v1")).toBeNull();
    expect(splitHeaderLine("see this: value")).toBeNull();
  });
});

describe("originOf", () => {
  it("normalises origin", () => {
    expect(originOf("https://API.x.test:443/a?b")).toBe("https://api.x.test");
    expect(originOf("nope")).toBeNull();
  });
});

describe("rowProblem for credentials", () => {
  const base = {
    id: "1", required: false, fromSchema: false, transforms: [], optional: false,
    hasDefault: false, defaultText: "", onNull: "keep",
  } as never;
  const row = (over: Record<string, unknown>) => ({ ...(base as object), ...over }) as never;
  it("blocks constant credentials, not selectors", () => {
    expect(rowProblem(row({ target: "token", section: "query", kind: "constant", text: '"x"' }))).toMatch(/Don't put keys in the URL/);
    expect(rowProblem(row({ target: "Authorization", section: "headers", kind: "constant", text: '"x"' }))).toMatch(/looks like a secret/);
    expect(rowProblem(row({ target: "token", section: "query", kind: "selector", text: "$.args.t" }))).toBeNull();
  });
});
