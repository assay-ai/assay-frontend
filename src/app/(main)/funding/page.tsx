"use client";

import * as React from "react";

import { FundingView } from "@/components/buyer-money/funding-view";

/** Money › Funding. `useSearchParams` (the `?action=` deep link) needs a Suspense boundary in a static export. */
export default function FundingPage() {
  return (
    <React.Suspense fallback={null}>
      <FundingView />
    </React.Suspense>
  );
}
