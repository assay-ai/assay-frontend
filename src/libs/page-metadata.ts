import type { Metadata } from "next";

/**
 * A public page's metadata with its own share tags. A page's `openGraph` and
 * `twitter` replace the site-wide ones whole, so the shared parts (site name,
 * type, image) are repeated here, in one place.
 */
export function pageMetadata({ title, description, url }: { title: string; description: string; url: string }): Metadata {
  const shared = `${title} — Assay`;
  const images = [{ url: "/thumbnail.png", width: 1200, height: 630, alt: shared }];
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "Assay", title: shared, description, url, images },
    twitter: { card: "summary_large_image", title: shared, description, images: ["/thumbnail.png"] },
  };
}
