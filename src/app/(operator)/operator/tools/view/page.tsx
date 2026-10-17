"use client";

import * as React from "react";

import { ContractEditorScreen } from "@/features/operator/contract-editor-view";
import { useSearchParam } from "@/hooks/useSearchParam";

/** One standard tool, route `/operator/tools/view?id=`: its versions, bindings per version and the draft editor. */
function ToolView() {
  const id = useSearchParam("id");
  return <ContractEditorScreen toolId={id} />;
}

export default function OperatorToolPage() {
  return (
    <React.Suspense fallback={null}>
      <ToolView />
    </React.Suspense>
  );
}
