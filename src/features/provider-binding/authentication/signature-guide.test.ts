import { describe, expect, it } from "vitest";

import { requestKeysUrl, signatureSnippet } from "./signature-guide";

describe("signature guide", () => {
  it("finds the key set on the API host, not under the versioned prefix", () => {
    expect(requestKeysUrl("https://api.example.com/api/v1")).toBe("https://api.example.com/.well-known/assay-request-keys.json");
    expect(requestKeysUrl("http://localhost:3000/api/v1")).toBe("http://localhost:3000/.well-known/assay-request-keys.json");
  });

  it("gives no URL for a relative or missing base", () => {
    expect(requestKeysUrl("")).toBeNull();
    expect(requestKeysUrl(undefined)).toBeNull();
    expect(requestKeysUrl("/api/v1")).toBeNull();
  });

  it("puts this deployment's key set in the snippet", () => {
    expect(signatureSnippet("https://api.example.com/.well-known/assay-request-keys.json")).toContain(
      'assayVerify({ jwksUrl: "https://api.example.com/.well-known/assay-request-keys.json" })',
    );
    expect(signatureSnippet(null)).toContain("app.use(assayVerify());");
  });
});
