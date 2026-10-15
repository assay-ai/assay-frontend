"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?tool=` → "no tool selected" instead of a lookup for nothing. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="tool" record="tool" backHref="/catalogue" backLabel="See all tools">
      {children}
    </RecordGate>
  );
}
