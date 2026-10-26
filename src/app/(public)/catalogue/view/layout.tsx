import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/**
 * One tool, named by `?tool=`: not the catalogue, so not its canonical address
 * either (a static export has no per-tool one to give).
 */
export const metadata: Metadata = { alternates: { canonical: null } };

/** No `?tool=` → "no tool selected" instead of a lookup for nothing. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="tool" record="tool" backHref="/catalogue" backLabel="See all tools">
      {children}
    </RecordGate>
  );
}
