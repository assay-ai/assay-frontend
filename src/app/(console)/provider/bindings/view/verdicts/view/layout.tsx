"use client";

import type { ReactNode } from "react";

import { RecordGate } from "@/components/record/record-gate";
import { useSearchParam } from "@/hooks/useSearchParam";
import { routes } from "@/libs/routes";

/** No `?verdict=` → "no verdict selected" instead of a page that waits forever. */
export default function Layout({ children }: { children: ReactNode }) {
  const bindingId = useSearchParam("binding");
  return (
    <RecordGate
      param="verdict"
      record="verdict"
      backHref={`${routes.binding(bindingId, "quality")}&section=verdicts`}
      backLabel="Back to verdicts"
    >
      {children}
    </RecordGate>
  );
}
