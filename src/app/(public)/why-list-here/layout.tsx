import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Get paid per call by AI agents, on chain. See what you would earn, the stake a paid listing needs, and the terms.";

export const metadata: Metadata = {
  title: "List your API",
  description: DESC,
  openGraph: {
    type: "website",
    siteName: "Assay",
    title: "List your API — Assay",
    description: DESC,
    url: "/why-list-here",
    images: [{ url: "/thumbnail.png", width: 1200, height: 630, alt: "List your API — Assay" }],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
