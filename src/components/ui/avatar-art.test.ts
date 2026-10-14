import { describe, expect, it } from "vitest";

import { avatarArtUri, normalizeAvatarSeed } from "./avatar-art";

describe("avatar art", () => {
  it("draws the same face for the same address however it is cased", () => {
    const checksum = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(avatarArtUri(checksum)).toBe(avatarArtUri(checksum.toLowerCase()));
  });

  it("draws different faces for different addresses", () => {
    expect(avatarArtUri("0x52908400098527886e0f7030069857d2e4169ee7")).not.toBe(
      avatarArtUri("0x8617e340b3d01fa5f11f306f4090fd50e238070d"),
    );
  });

  it("keeps Solana addresses case-sensitive", () => {
    const solana = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(normalizeAvatarSeed(solana)).toBe(solana);
  });

  it("is an inline SVG, never a network URL", () => {
    expect(avatarArtUri("0x52908400098527886e0f7030069857d2e4169ee7")).toMatch(/^data:image\/svg\+xml/);
  });
});
