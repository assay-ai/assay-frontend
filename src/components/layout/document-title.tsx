"use client";

import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/** Names the tab for a page whose route cannot set metadata itself (the 404). */
export function DocumentTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}
