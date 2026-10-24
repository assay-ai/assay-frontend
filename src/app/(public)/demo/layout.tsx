import type { Metadata } from "next";

import { pageMetadata } from "@/libs/page-metadata";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Two real tool calls side by side, one to a deliberately broken provider: watch the bad result not get charged.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Live demo", description: DESC, url: "/demo" }),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
