import type { Metadata } from "next";

import { pageMetadata } from "@/libs/page-metadata";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Is the money really there? What Assay owes buyers and providers, next to the account that holds it.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Proof of reserves", description: DESC, url: "/reserves" }),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
