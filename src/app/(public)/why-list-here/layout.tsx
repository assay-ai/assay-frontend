import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
export const metadata: Metadata = {
  title: "List your API",
  description: "Get paid per call by AI agents, on chain. See what you would earn, the stake a paid listing needs, and the terms.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
