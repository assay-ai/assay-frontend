import type { Metadata } from "next";

/** This route's own title and description; the page itself is a client component. */
export const metadata: Metadata = {
  title: "Live demo",
  description: "Two real tool calls side by side, one to a deliberately broken provider: watch the bad result not get charged.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
