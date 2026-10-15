"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?binding=` → "no binding selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="binding" record="binding" backHref="/provider/bindings" backLabel="Back to bindings">
      {children}
    </RecordGate>
  );
}
