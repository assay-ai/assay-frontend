import type { MetadataRoute } from "next";

/** Built once into the static export. */
export const dynamic = "force-static";

/** `/robots.txt`: everything but the API, and the sitemap when this build knows its own address. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return {
    rules: { userAgent: "*", disallow: "/api/" },
    ...(base ? { sitemap: new URL("/sitemap.xml", base).toString() } : {}),
  };
}
