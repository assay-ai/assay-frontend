"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no tool request selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="tool request" backHref="/provider/tool-requests" backLabel="Back to tool requests">
      {children}
    </RecordGate>
  );
}
