"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no dispute selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="dispute" backHref="/provider/disputes" backLabel="Back to disputes">
      {children}
    </RecordGate>
  );
}
