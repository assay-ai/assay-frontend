import type { MetadataRoute } from "next";

/** Built once into the static export. */
export const dynamic = "force-static";

/** The public pages anyone may read without signing in, as listed for search engines. */
const PUBLIC_PATHS = ["/how-it-works", "/why-list-here", "/catalogue"] as const;

/**
 * `/sitemap.xml`. A sitemap takes absolute URLs, so it is built from
 * `NEXT_PUBLIC_BASE_URL`; without one it lists nothing rather than paths that
 * resolve nowhere.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!base) return [];
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, base).toString() }));
}
