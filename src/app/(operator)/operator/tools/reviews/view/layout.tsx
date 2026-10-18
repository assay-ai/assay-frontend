"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no review selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="review" backHref="/operator/tools/reviews" backLabel="Back to reviews">
      {children}
    </RecordGate>
  );
}
