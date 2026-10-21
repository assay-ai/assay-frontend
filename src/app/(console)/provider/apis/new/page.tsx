"use client";

import * as React from "react";

import { PublishApiFlow } from "@/features/provider-tools/publish-flow";

/** `/provider/apis/new` — step 1 of "Publish your own API"; saving it moves to `/provider/apis/view?id=`. */
export default function NewProviderApiPage() {
  return (
    <React.Suspense fallback={null}>
      <PublishApiFlow toolId={null} />
    </React.Suspense>
  );
}
