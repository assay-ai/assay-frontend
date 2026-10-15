"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no case selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="case" backHref="/provider/capital/penalties" backLabel="Back to penalties">
      {children}
    </RecordGate>
  );
}
