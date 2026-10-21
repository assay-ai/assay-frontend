import type { Metadata } from "next";

import { pageMetadata } from "@/libs/page-metadata";

/** This route's own title and description; the page itself is a client component. */
const DESC =
  "Tools your agent can pay for, only when they work: the price per call, what is checked, who serves it and what our checks refused to charge.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Tools and prices", description: DESC, url: "/catalogue" }),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
