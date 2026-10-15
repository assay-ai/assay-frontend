import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Assay with an email code or a wallet. No password, no card.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
