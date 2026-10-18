import { describe, expect, it } from "vitest";
import { REQUIREMENT_SENTENCE } from "./live-stage";

describe("REQUIREMENT_SENTENCE", () => {
  it("says what to do when API key headers are missing for the address", () => {
    expect(REQUIREMENT_SENTENCE.API_KEY_CREDENTIALS).toBe(
      "Add your API key headers for this address under Authentication.",
    );
  });
});
