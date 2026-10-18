import { describe, expect, it } from "vitest";

import { previewRequest } from "./request-preview";

const MAPPING = {
  method: "GET",
  query: { ids: { $path: "$.ids" }, vsCurrency: { $path: "$.vsCurrency", $optional: true } },
};

describe("previewRequest", () => {
  it("joins the address and query with no trailing slash, leaving out an empty optional input (B15 acceptance)", () => {
    expect(previewRequest("https://httpbin.org/anything", MAPPING, { ids: "bitcoin", vsCurrency: "" })).toBe(
      "GET https://httpbin.org/anything?ids=bitcoin",
    );
    expect(previewRequest("https://httpbin.org/anything/", MAPPING, { ids: "bitcoin", vsCurrency: "usd" })).toBe(
      "GET https://httpbin.org/anything?ids=bitcoin&vsCurrency=usd",
    );
  });

  it("marks a required input that is empty", () => {
    expect(previewRequest("https://x.test/v1", MAPPING, { ids: "" })).toBe("GET https://x.test/v1?ids=(missing)");
  });

  it("fills a path template, constants and defaults", () => {
    expect(
      previewRequest(
        "https://x.test/v1",
        { method: "post", path: "/cities/{$.city}", query: { lang: { $const: "en" }, units: { $path: "$.units", $default: "metric" } } },
        { city: "São Paulo" },
      ),
    ).toBe("POST https://x.test/v1/cities/S%C3%A3o%20Paulo?lang=en&units=metric");
  });

  it("returns null for an address that is not a URL", () => {
    expect(previewRequest("api.example.com", MAPPING, {})).toBeNull();
  });
});
