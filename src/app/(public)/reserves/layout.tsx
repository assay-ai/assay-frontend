import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
export const metadata: Metadata = {
  title: "Proof of reserves",
  description: "Is the money really there? What Assay owes buyers and providers, next to the account that holds it.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
