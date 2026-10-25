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

  it("pins this provider's id and this deployment's key set in the snippet", () => {
    const id = "8f14e45f-ceea-467e-a2b0-6f2c3a1d9b7e";
    expect(signatureSnippet("https://api.example.com/.well-known/assay-request-keys.json", id)).toContain(
      `assayVerify({ provider: "${id}", jwksUrl: "https://api.example.com/.well-known/assay-request-keys.json" })`,
    );
    expect(signatureSnippet(null, id)).toContain(`app.use(assayVerify({ provider: "${id}" }));`);
  });

  it("never leaves the provider out: a placeholder stands in until the id loads", () => {
    expect(signatureSnippet(null, null)).toContain('app.use(assayVerify({ provider: "YOUR_PROVIDER_ID" }));');
  });

  it("imports the package from the @goassay-ai npm scope, which is ours", () => {
    expect(signatureSnippet(null, null)).toContain('from "@goassay-ai/provider-verify/express"');
  });
});
