import { PublishChecklistView } from "./_components/publish-checklist-view";

/** Publish checklist. */
export default async function PublishChecklistPage({
  params,
}: {
  params: Promise<{ bindingId: string }>;
}) {
  const { bindingId } = await params;
  return <PublishChecklistView bindingId={bindingId} />;
}
