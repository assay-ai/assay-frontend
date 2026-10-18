"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no report selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="report" backHref="/spend/disputes" backLabel="Back to reports">
      {children}
    </RecordGate>
  );
}
