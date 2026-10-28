import type { Metadata } from "next";

import { ProtocolAnalytics } from "@/features/protocol-analytics/protocol-analytics";

export const metadata: Metadata = {
  title: "Protocol analytics",
  description:
    "Preview Assay protocol analytics with fictional sample data for revenue, tool activity and agent adoption.",
  robots: { index: false, follow: true },
};

export default function AnalyticsPage() {
  return <ProtocolAnalytics />;
}
