import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Two real tool calls side by side, one to a deliberately broken provider: watch the bad result not get charged.";

export const metadata: Metadata = {
  title: "Live demo",
  description: DESC,
  openGraph: {
    type: "website",
    siteName: "Assay",
    title: "Live demo — Assay",
    description: DESC,
    url: "/demo",
    images: [{ url: "/thumbnail.png", width: 1200, height: 630, alt: "Live demo — Assay" }],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
