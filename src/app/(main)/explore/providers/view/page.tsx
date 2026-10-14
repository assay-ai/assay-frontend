"use client";

import { useSearchParam } from "@/hooks/useSearchParam";
import { ProviderDetailView } from "@/components/g31/provider-detail-view";

/** Provider detail. */
export default function ProviderDetailPage() {
  return <ProviderDetailView providerId={useSearchParam("id")} />;
}
