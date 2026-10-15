"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?binding=` → "no tool selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="binding" record="tool" backHref="/provider/bindings" backLabel="See your tools">
      {children}
    </RecordGate>
  );
}
