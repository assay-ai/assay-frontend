import type { Metadata } from "next";

import { pageMetadata } from "@/libs/page-metadata";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Get paid per call by AI agents, on chain. See what you would earn, the stake a paid listing needs, and the terms.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "List your API", description: DESC, url: "/why-list-here" }),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
