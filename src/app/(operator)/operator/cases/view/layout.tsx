"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/** No `?id=` → "no penalty selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="penalty" backHref="/operator/cases" backLabel="Go to Penalties">
      {children}
    </RecordGate>
  );
}
