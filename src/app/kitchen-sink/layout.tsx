import { notFound } from "next/navigation";

/**
 * The kitchen sink (a gallery of every component) is a development aid, not a
 * product page: production builds leave it out unless
 * `NEXT_PUBLIC_SHOW_KITCHEN_SINK=1` was set at build time.
 */
const KITCHEN_SINK_ENABLED =
  process.env.NEXT_PUBLIC_SHOW_KITCHEN_SINK === "1" || process.env.NODE_ENV !== "production";

export default function KitchenSinkLayout({ children }: { children: React.ReactNode }) {
  if (!KITCHEN_SINK_ENABLED) notFound();
  return children;
}
