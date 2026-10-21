import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Is the money really there? What Assay owes buyers and providers, next to the account that holds it.";

export const metadata: Metadata = {
  title: "Proof of reserves",
  description: DESC,
  openGraph: {
    type: "website",
    siteName: "Assay",
    title: "Proof of reserves — Assay",
    description: DESC,
    url: "/reserves",
    images: [{ url: "/thumbnail.png", width: 1200, height: 630, alt: "Proof of reserves — Assay" }],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
