"use client";

import { useSearchParam } from "@/hooks/useSearchParam";

import { PublishChecklistView } from "./_components/publish-checklist-view";

/** Publish checklist. The binding id rides in `?binding=` (see `libs/routes.ts`). */
export default function PublishChecklistPage() {
  const bindingId = useSearchParam("binding");
  return <PublishChecklistView bindingId={bindingId} />;
}
