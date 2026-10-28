import type { Metadata } from "next";

import { ProtocolAnalytics } from "@/features/protocol-analytics/protocol-analytics";

export const metadata: Metadata = {
  title: "Protocol analytics",
  description:
    "Assay protocol revenue, tool activity, agent adoption and escrow payment analytics.",
  robots: { index: false, follow: true },
};

export default function AnalyticsPage() {
  return <ProtocolAnalytics />;
}
