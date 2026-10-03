import { ProviderDetailView } from "@/components/g31/provider-detail-view";

/** Provider detail. */
export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProviderDetailView providerId={id} />;
}
