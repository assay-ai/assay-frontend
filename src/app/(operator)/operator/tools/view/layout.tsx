"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no tool selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="tool" backHref="/operator/tools" backLabel="Back to tools">
      {children}
    </RecordGate>
  );
}
