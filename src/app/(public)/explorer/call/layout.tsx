import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PublicCallGate } from "./public-call-gate";

/**
 * One call on the public explorer, `/explorer/call/<id>`. Never indexed, and the address
 * (which carries the id) is never sent on as a referrer.
 */
export const metadata: Metadata = {
  title: "Call",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  alternates: { canonical: null },
  // Bot replies on X link here. A small card, the same for every call (the page is static and
  // never puts call data into metadata), instead of the site's large image card.
  openGraph: {
    type: "website",
    siteName: "Assay",
    title: "A tool call on Assay",
    description: "What one paid tool call cost, whether it was charged, and its checks.",
    images: [{ url: "/images/apple-touch-icon.png", width: 180, height: 180, alt: "Assay" }],
  },
  twitter: {
    card: "summary",
    title: "A tool call on Assay",
    description: "What one paid tool call cost, whether it was charged, and its checks.",
    images: ["/images/apple-touch-icon.png"],
  },
};

/** No id → "no call selected" instead of a lookup for nothing. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <PublicCallGate>{children}</PublicCallGate>
  );
}
