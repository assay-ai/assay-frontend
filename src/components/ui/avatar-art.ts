import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";

/**
 * Backgrounds from the landing palette: the lime the Assay mark sits on, its
 * lighter step, and the cream ground. Notionists draws black line art, which
 * reads on all three — and on both app themes.
 */
const BACKGROUNDS = ["ccff02", "e3ff6e", "efede4"];

/**
 * EVM addresses are case-insensitive (checksum casing is presentation), so they
 * seed lowercase: the same wallet must draw the same person however it was
 * spelled. Solana base58 is case-sensitive and seeds as given.
 */
export function normalizeAvatarSeed(seed: string): string {
  const trimmed = seed.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/**
 * A deterministic illustrated avatar for `seed`, as an SVG data URI.
 *
 * Drawn locally by DiceBear rather than requested from api.dicebear.com: no
 * network call means nothing to rate-limit, nothing for a blocker or CSP to
 * stop, and no wallet address sent to a third party.
 */
export function avatarArtUri(seed: string): string {
  return createAvatar(notionists, {
    seed: normalizeAvatarSeed(seed),
    backgroundColor: BACKGROUNDS,
    backgroundType: ["solid"],
  }).toDataUri();
}
