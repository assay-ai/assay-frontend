import type { Metadata } from "next";

/**
 * One provider, named in the query: not the catalogue, so not its canonical
 * address either (a static export has no per-provider one to give).
 */
export const metadata: Metadata = { alternates: { canonical: null } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
