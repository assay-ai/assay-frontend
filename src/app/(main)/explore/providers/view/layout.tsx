"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no provider selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="provider" backHref="/explore/providers" backLabel="Back to providers">
      {children}
    </RecordGate>
  );
}
