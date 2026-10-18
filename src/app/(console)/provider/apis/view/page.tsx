"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PublishApiFlow } from "@/features/provider-tools/publish-flow";

/** `/provider/apis/view?id=&step=` — one of your own APIs, on a step of its flow. */
function ProviderApiContent() {
  const id = useSearchParams().get("id") ?? "";
  return <PublishApiFlow key={id} toolId={id || null} />;
}

export default function ProviderApiPage() {
  return (
    <React.Suspense fallback={null}>
      <ProviderApiContent />
    </React.Suspense>
  );
}
