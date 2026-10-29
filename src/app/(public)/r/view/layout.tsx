import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";

/**
 * One call's public receipt, named by `?id=`. Never indexed, and the address
 * (which carries the id) is never sent on as a referrer.
 */
export const metadata: Metadata = {
  title: "Receipt",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  alternates: { canonical: null },
};

/** No `?id=` → "no receipt selected" instead of a lookup for nothing. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RecordGate param="id" record="receipt" backHref="/catalogue" backLabel="See all tools">
      {children}
    </RecordGate>
  );
}
