import { describe, expect, it } from "vitest";

import { credentialLabel, KEY_PLACEHOLDER, KEY_PREFIX_VISIBLE_LENGTH, keyMode, keyPlaceholder, keyForHint } from "@/features/buyer-money/mcp-config";

describe("keyMode — read off the key's visible prefix", () => {
  it("names an API key live", () => {
    expect(keyMode("assay_sk_live_ab12")).toBe("live");
  });

  it("says nothing for any other prefix: there is no test key", () => {
    expect(keyMode("assay_live_ab12")).toBeNull();
    expect(keyMode("assay_test_ab12")).toBeNull();
    expect(keyMode("other_sk_live_ab12")).toBeNull();
    expect(keyMode(null)).toBeNull();
    expect(keyMode(undefined)).toBeNull();
  });
});

describe("keyPlaceholder — what stands in for a key not on screen", () => {
  it("names an API key by its prefix", () => {
    expect(keyPlaceholder("assay_sk_live_ab12cd34")).toBe("assay_sk_live_ab12cd34…REST_OF_YOUR_KEY");
    expect(keyPlaceholder("assay_sk_live_ab12cd34…")).toBe("assay_sk_live_ab12cd34…REST_OF_YOUR_KEY");
  });

  it("never echoes a full token: only the visible prefix is kept", () => {
    const token = "assay_sk_live_ab12cd34ef56gh78ij90kl12mn34op56";
    const out = keyPlaceholder(token);
    expect(out).toBe(`${token.slice(0, KEY_PREFIX_VISIBLE_LENGTH)}…REST_OF_YOUR_KEY`);
    expect(out).not.toContain(token);
    expect(KEY_PREFIX_VISIBLE_LENGTH).toBe(22);
  });

  it("is the bare placeholder without a prefix, or with one that is not an API key's", () => {
    expect(keyPlaceholder(null)).toBe(KEY_PLACEHOLDER);
    expect(keyPlaceholder("")).toBe(KEY_PLACEHOLDER);
    expect(keyPlaceholder("assay_live_ab12")).toBe(KEY_PLACEHOLDER);
  });
});

describe("credentialLabel — how a credential row shows its key", () => {
  it("shows an API key's prefix", () => {
    expect(credentialLabel({ prefix: "assay_sk_live_ab12" })).toBe("assay_sk_live_ab12…");
    expect(credentialLabel({ prefix: "assay_sk_live_ab12…" })).toBe("assay_sk_live_ab12…");
  });

  it("names an app sign-in (null prefix) by its client, never 'null…'", () => {
    expect(credentialLabel({ prefix: null })).toBe("App sign-in");
    expect(credentialLabel({ prefix: null, oauthClient: null })).toBe("App sign-in");
    expect(credentialLabel({ prefix: null, oauthClient: { name: "Claude Code" } })).toBe("Signed in with Claude Code");
  });
});

describe("keyForHint — the key an API-key hint names", () => {
  it("skips app sign-ins, which have no prefix to show", () => {
    const grant = { id: "g", prefix: null };
    const key = { id: "k", prefix: "assay_sk_live_ab12" };
    expect(keyForHint([grant, key])).toBe(key);
    expect(keyForHint([grant])).toBeNull();
    expect(keyForHint([])).toBeNull();
  });
});
